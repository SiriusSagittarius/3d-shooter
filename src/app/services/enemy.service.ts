import { Injectable } from '@angular/core';
import * as THREE from 'three';
import { BehaviorSubject, Observable, Subject } from 'rxjs';
import { PlayerService } from './player.service';

/** Die vier prozeduralen Gegnertypen + hochgeladene Bild-Sprites. */
export type EnemyKind = 'jaeger' | 'flitzer' | 'brocken' | 'kamikaze' | 'sprite';

/** Kampf-Ereignis für HUD, Sounds und Partikel (wird im GameComponent verdrahtet). */
export interface EnemyEvent {
  type: 'killed' | 'damaged' | 'exploded';
  kind: EnemyKind;
  position: THREE.Vector3;
  color: THREE.Color;
  /** Basis-Punkte des Gegners (Combo-Multiplikator kommt im WeaponService drauf). */
  points: number;
}

interface Enemy {
  root: THREE.Object3D;
  kind: EnemyKind;
  hp: number;
  speed: number;
  damage: number;
  points: number;
  color: THREE.Color;
  baseY: number;
  bobPhase: number;
  zigzagPhase: number;
  zigzagFreq: number;
  zigzagStrength: number;
  /** Rotierende Deko (Schale/Ring), wird pro Frame gedreht. */
  spin?: THREE.Object3D;
  spinSpeed: number;
  /** Materialien fürs weiße Aufblitzen bei Treffern (nur Mesh-Gegner). */
  flashMats: { mat: THREE.MeshStandardMaterial; emissive: THREE.Color; intensity: number }[];
  flashUntil: number;
}

/**
 * Gegner-System: prozedural gebaute Neon-Monster, die in Wellen spawnen,
 * auf den Spieler zulaufen (mit Zickzack) und bei Nähe Schaden machen.
 * Dazu: Kamikaze-Explosionen, Hit-Flash, Medikit und Bild-Upload-Gegner.
 */
@Injectable({
  providedIn: 'root'
})
export class EnemyService {
  private scene?: THREE.Scene;
  private textureLoader = new THREE.TextureLoader();
  private glowTexture?: THREE.Texture;

  private enemies: Enemy[] = [];
  /** Wurzel-Objekte aller Gegner (gecacht für Raycasts + Minimap). */
  private enemyRoots: THREE.Object3D[] = [];

  private medikit?: THREE.Mesh;
  private medikitRespawnTimer?: ReturnType<typeof setTimeout>;
  private lastDamageTime = 0;

  private readonly damageDistance = 1.6;
  private readonly damageCooldownMs = 800;
  private readonly medikitHeal = 50;
  private readonly medikitRespawnMs = 20000;
  private readonly maxAlive = 30;
  private readonly waveBreakSeconds = 3.5;

  // Balancing pro Gegnertyp.
  private readonly stats: Record<EnemyKind, {
    hp: number; speed: number; damage: number; points: number; baseY: number;
    zigzagFreq: number; zigzagStrength: number;
  }> = {
    jaeger:   { hp: 1, speed: 4.5, damage: 10, points: 50,  baseY: 1.5, zigzagFreq: 3,   zigzagStrength: 1.5 },
    flitzer:  { hp: 1, speed: 8.0, damage: 5,  points: 75,  baseY: 1.1, zigzagFreq: 6,   zigzagStrength: 4.5 },
    brocken:  { hp: 5, speed: 1.8, damage: 20, points: 250, baseY: 2.0, zigzagFreq: 0,   zigzagStrength: 0 },
    kamikaze: { hp: 1, speed: 3.4, damage: 25, points: 100, baseY: 1.4, zigzagFreq: 4,   zigzagStrength: 2 },
    sprite:   { hp: 1, speed: 3.0, damage: 10, points: 60,  baseY: 1.0, zigzagFreq: 2.5, zigzagStrength: 1.2 },
  };

  // --- Wellen-Zustand (delta-getrieben, pausiert also automatisch mit dem Spiel) ---
  private wavesRunning = false;
  private wave = 0;
  private spawnQueue: EnemyKind[] = [];
  private spawnTimer = 0;
  private waveBreakTimer = 0;

  private countSubject = new BehaviorSubject<number>(0);
  /** Anzahl aktiver Gegner (für HUD). */
  public count$: Observable<number> = this.countSubject.asObservable();

  private waveSubject = new BehaviorSubject<number>(0);
  /** Aktuelle Wellen-Nummer (0 = noch nicht gestartet). */
  public wave$: Observable<number> = this.waveSubject.asObservable();

  private eventSubject = new Subject<EnemyEvent>();
  /** Kill/Treffer/Explosions-Ereignisse für Feedback (Partikel, Sound, Popups). */
  public events$: Observable<EnemyEvent> = this.eventSubject.asObservable();

  constructor(private playerService: PlayerService) {}

  public init(scene: THREE.Scene): void {
    this.scene = scene;
    this.glowTexture = this.makeGlowTexture();
    this.createMedikit();
  }

  /** Wurzel-Objekte der Gegner (Trefferliste für Raycasts + Minimap). */
  public getEnemies(): THREE.Object3D[] {
    return this.enemyRoots;
  }

  /** Startet das Wellen-Spawning (idempotent — mehrfacher Aufruf schadet nicht). */
  public startWaves(): void {
    if (this.wavesRunning) return;
    this.wavesRunning = true;
    this.waveBreakTimer = 1.2; // erste Welle kommt fast sofort
  }

  /** Entfernt alle Gegner und setzt die Wellen zurück (für Neustart). */
  public reset(): void {
    for (const enemy of [...this.enemies]) {
      this.destroyEnemy(enemy);
    }
    this.wavesRunning = false;
    this.wave = 0;
    this.spawnQueue = [];
    this.waveSubject.next(0);
  }

  /** Erzeugt aus einer Bilddatei einen Sprite-Gegner an zufälliger Position. */
  public spawnFromFile(file: File): void {
    const reader = new FileReader();
    reader.onload = (event) => {
      const imgData = event.target?.result as string;
      const texture = this.textureLoader.load(imgData);
      this.createSpriteEnemy(texture);
    };
    reader.readAsDataURL(file);
  }

  /**
   * Verarbeitet einen Waffentreffer auf ein Objekt. Läuft die Parent-Kette hoch,
   * weil der Raycast Kind-Meshes einer Gegner-Gruppe treffen kann.
   */
  public hitEnemy(object: THREE.Object3D): 'killed' | 'damaged' | 'none' {
    let node: THREE.Object3D | null = object;
    while (node) {
      const enemy = this.enemies.find(e => e.root === node);
      if (enemy) return this.applyHit(enemy);
      node = node.parent;
    }
    return 'none';
  }

  private applyHit(enemy: Enemy): 'killed' | 'damaged' {
    enemy.hp -= 1;

    if (enemy.hp <= 0) {
      this.eventSubject.next({
        type: 'killed',
        kind: enemy.kind,
        position: enemy.root.position.clone(),
        color: enemy.color.clone(),
        points: enemy.points,
      });
      this.destroyEnemy(enemy);
      return 'killed';
    }

    // Noch nicht tot: weiß aufblitzen lassen als Treffer-Feedback.
    enemy.flashUntil = performance.now() + 120;
    this.setFlash(enemy, true);
    this.eventSubject.next({
      type: 'damaged',
      kind: enemy.kind,
      position: enemy.root.position.clone(),
      color: enemy.color.clone(),
      points: 0,
    });
    return 'damaged';
  }

  /** Pro Frame: Wellen spawnen, Gegner bewegen, Schaden prüfen, Medikit aufsammeln. */
  public update(delta: number, playerPos: THREE.Vector3): void {
    const now = performance.now();
    const time = now / 1000;

    if (this.wavesRunning) this.updateWaveSpawning(delta, playerPos);

    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      const root = e.root;

      // Richtung zum Spieler (nur XZ-Ebene).
      const dir = new THREE.Vector3(playerPos.x - root.position.x, 0, playerPos.z - root.position.z);
      const dist = dir.length();
      if (dist > 0.001) dir.divideScalar(dist);

      // Kamikaze beschleunigt, je näher er kommt — Panik-Faktor!
      let speed = e.speed;
      if (e.kind === 'kamikaze') {
        speed *= 1 + 1.8 * (1 - Math.min(dist, 30) / 30);
      }

      // Zickzack: seitliches Ausweichen macht schnelle Gegner schwerer zu treffen.
      const zig = Math.sin(time * e.zigzagFreq + e.zigzagPhase) * e.zigzagStrength;
      const sideX = -dir.z;
      const sideZ = dir.x;

      root.position.x += (dir.x * speed + sideX * zig) * delta;
      root.position.z += (dir.z * speed + sideZ * zig) * delta;
      root.position.y = e.baseY + Math.sin(time * 2 + e.bobPhase) * 0.25;

      // Mesh-Gegner schauen den Spieler an (Sprites drehen sich selbst zur Kamera).
      if (e.kind !== 'sprite') {
        root.lookAt(playerPos.x, root.position.y, playerPos.z);
      }

      // Rotierende Deko (Wireframe-Schale / Ring).
      if (e.spin) {
        e.spin.rotation.y += e.spinSpeed * delta;
        e.spin.rotation.x += e.spinSpeed * 0.6 * delta;
      }

      // Kamikaze pulsiert bedrohlich.
      if (e.kind === 'kamikaze') {
        root.scale.setScalar(1 + Math.sin(time * 10) * 0.12);
      }

      // Hit-Flash nach Ablauf zurücksetzen.
      if (e.flashUntil > 0 && now > e.flashUntil) {
        e.flashUntil = 0;
        this.setFlash(e, false);
      }

      // Kontakt mit dem Spieler.
      if (e.kind === 'kamikaze' && dist < 2.2) {
        this.explodeKamikaze(e);
        continue;
      }
      if (dist < this.damageDistance && now - this.lastDamageTime > this.damageCooldownMs) {
        this.playerService.takeDamage(e.damage);
        this.lastDamageTime = now;
      }
    }

    this.updateMedikit(playerPos);
  }

  // ------------------------------------------------------------------
  // Wellen-Logik
  // ------------------------------------------------------------------

  private updateWaveSpawning(delta: number, playerPos: THREE.Vector3): void {
    if (this.spawnQueue.length > 0) {
      this.spawnTimer -= delta;
      if (this.spawnTimer <= 0 && this.enemies.length < this.maxAlive) {
        const kind = this.spawnQueue.shift()!;
        this.spawnEnemy(kind, playerPos);
        this.spawnTimer = this.spawnInterval();
      }
    } else if (this.enemies.length === 0) {
      // Welle geschafft: kurze Verschnaufpause, dann die nächste.
      this.waveBreakTimer -= delta;
      if (this.waveBreakTimer <= 0) this.startNextWave();
    }
  }

  private startNextWave(): void {
    this.wave++;
    this.waveSubject.next(this.wave);
    this.spawnQueue = this.buildWaveQueue(this.wave);
    this.spawnTimer = 0.5;
    this.waveBreakTimer = this.waveBreakSeconds;
  }

  /** Zusammensetzung der Welle: später mehr, schneller und gemeiner. */
  private buildWaveQueue(wave: number): EnemyKind[] {
    const count = Math.min(5 + wave * 2, 24);
    const kinds: EnemyKind[] = [];
    for (let i = 0; i < count; i++) {
      const r = Math.random();
      if (wave >= 3 && r < 0.12)      kinds.push('brocken');
      else if (wave >= 2 && r < 0.30) kinds.push('kamikaze');
      else if (r < 0.55)              kinds.push('flitzer');
      else                            kinds.push('jaeger');
    }
    return kinds;
  }

  /** Spawn-Abstand innerhalb einer Welle: wird mit den Wellen immer kürzer. */
  private spawnInterval(): number {
    return Math.max(0.35, 1.1 - this.wave * 0.07);
  }

  /** Geschwindigkeits-Skalierung pro Welle (max. +70%). */
  private waveSpeedScale(): number {
    return 1 + Math.min((this.wave - 1) * 0.06, 0.7);
  }

  private spawnEnemy(kind: EnemyKind, playerPos: THREE.Vector3): void {
    if (!this.scene) return;

    const build = this.buildEnemyMesh(kind);
    const s = this.stats[kind];

    // Rund um den Spieler spawnen (22–40m), innerhalb der Arena-Wände bleiben.
    const angle = Math.random() * Math.PI * 2;
    const dist = 22 + Math.random() * 18;
    const x = THREE.MathUtils.clamp(playerPos.x + Math.cos(angle) * dist, -92, 92);
    const z = THREE.MathUtils.clamp(playerPos.z + Math.sin(angle) * dist, -92, 92);
    build.root.position.set(x, s.baseY, z);

    const enemy: Enemy = {
      root: build.root,
      kind,
      hp: s.hp,
      speed: s.speed * this.waveSpeedScale(),
      damage: s.damage,
      points: s.points,
      color: build.color,
      baseY: s.baseY,
      bobPhase: Math.random() * Math.PI * 2,
      zigzagPhase: Math.random() * Math.PI * 2,
      zigzagFreq: s.zigzagFreq,
      zigzagStrength: s.zigzagStrength,
      spin: build.spin,
      spinSpeed: build.spinSpeed,
      flashMats: build.flashMats,
      flashUntil: 0,
    };

    this.scene.add(build.root);
    this.enemies.push(enemy);
    this.enemyRoots.push(build.root);
    this.countSubject.next(this.enemies.length);
  }

  // ------------------------------------------------------------------
  // Gegner-Bau (prozedural, keine Assets nötig)
  // ------------------------------------------------------------------

  private buildEnemyMesh(kind: EnemyKind): {
    root: THREE.Object3D; color: THREE.Color; spin?: THREE.Object3D; spinSpeed: number;
    flashMats: Enemy['flashMats'];
  } {
    switch (kind) {
      case 'flitzer':  return this.buildFlitzer();
      case 'brocken':  return this.buildBrocken();
      case 'kamikaze': return this.buildKamikaze();
      case 'jaeger':
      default:         return this.buildJaeger();
    }
  }

  /** JÄGER: roter Kristall-Kern mit rotierender Wireframe-Schale. Standard-Gegner. */
  private buildJaeger() {
    const color = new THREE.Color(0xff2222);
    const root = new THREE.Group();
    root.name = 'enemy';

    const coreMat = new THREE.MeshStandardMaterial({
      color: 0x330000, emissive: 0xff2222, emissiveIntensity: 1.8,
      roughness: 0.35, flatShading: true,
    });
    const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.45, 1), coreMat);

    const shell = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.75, 0),
      new THREE.MeshBasicMaterial({ color: 0xff4444, wireframe: true, transparent: true, opacity: 0.7 })
    );

    root.add(core, shell, this.makeEye(0.16, 0.5), this.makeGlow(0xff3333, 2.4));
    return { root, color, spin: shell, spinSpeed: 2.5, flashMats: this.collectFlashMats([coreMat]) };
  }

  /** FLITZER: türkiser Pfeil — sehr schnell, fliegt Zickzack. Nervös abschießen! */
  private buildFlitzer() {
    const color = new THREE.Color(0x00ffee);
    const root = new THREE.Group();
    root.name = 'enemy';

    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0x003333, emissive: 0x00ffee, emissiveIntensity: 2.2,
      roughness: 0.3, flatShading: true,
    });
    const body = new THREE.Mesh(new THREE.OctahedronGeometry(0.42), bodyMat);
    body.scale.set(1, 0.65, 1.8); // in Flugrichtung gestreckt = Pfeilform

    root.add(body, this.makeEye(0.12, 0.7), this.makeGlow(0x00ffee, 2.0));
    return { root, color, spin: undefined, spinSpeed: 0, flashMats: this.collectFlashMats([bodyMat]) };
  }

  /** BROCKEN: violetter Panzer-Kristall mit Energie-Ring. 5 Treffer, dicke Punkte. */
  private buildBrocken() {
    const color = new THREE.Color(0xaa44ff);
    const root = new THREE.Group();
    root.name = 'enemy';

    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0x1a0526, emissive: 0x7722cc, emissiveIntensity: 1.0,
      roughness: 0.4, flatShading: true,
    });
    const body = new THREE.Mesh(new THREE.DodecahedronGeometry(1.3), bodyMat);

    // Schräger Energie-Ring, der um den Körper kreist.
    const ringHolder = new THREE.Group();
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(1.8, 0.07, 8, 40),
      new THREE.MeshBasicMaterial({ color: 0xff44ff })
    );
    ring.rotation.x = Math.PI / 2.6;
    ringHolder.add(ring);

    root.add(body, ringHolder, this.makeEye(0.28, 1.25), this.makeGlow(0xaa44ff, 4.5));
    return { root, color, spin: ringHolder, spinSpeed: 1.5, flashMats: this.collectFlashMats([bodyMat]) };
  }

  /** KAMIKAZE: orangene Stachel-Bombe — beschleunigt und explodiert am Spieler. */
  private buildKamikaze() {
    const color = new THREE.Color(0xff8800);
    const root = new THREE.Group();
    root.name = 'enemy';

    const coreMat = new THREE.MeshStandardMaterial({
      color: 0x331100, emissive: 0xff6600, emissiveIntensity: 2.0,
      roughness: 0.3,
    });
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.5, 12, 12), coreMat);

    const spikes = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.7, 0),
      new THREE.MeshBasicMaterial({ color: 0xffaa00, wireframe: true })
    );

    root.add(core, spikes, this.makeEye(0.14, 0.55), this.makeGlow(0xff8800, 2.6));
    return { root, color, spin: spikes, spinSpeed: 4, flashMats: this.collectFlashMats([coreMat]) };
  }

  /** Böses Auge, das (dank lookAt) immer zum Spieler zeigt. */
  private makeEye(size: number, z: number): THREE.Group {
    const eye = new THREE.Group();
    const white = new THREE.Mesh(
      new THREE.SphereGeometry(size, 10, 10),
      new THREE.MeshBasicMaterial({ color: 0xffffff })
    );
    const pupil = new THREE.Mesh(
      new THREE.SphereGeometry(size * 0.5, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0x000000 })
    );
    pupil.position.z = size * 0.6;
    eye.add(white, pupil);
    eye.position.set(0, 0.1, z);
    return eye;
  }

  /** Additiver Glow-Sprite — lässt die Gegner in der Nachtszene leuchten. */
  private makeGlow(color: number, scale: number): THREE.Sprite {
    const mat = new THREE.SpriteMaterial({
      map: this.glowTexture, color, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const glow = new THREE.Sprite(mat);
    glow.scale.setScalar(scale);
    return glow;
  }

  /** Radialer Verlauf als geteilte Glow-Textur (einmal erzeugt, überall genutzt). */
  private makeGlowTexture(): THREE.Texture {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d')!;
    const grad = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, 'rgba(255,255,255,0.8)');
    grad.addColorStop(0.4, 'rgba(255,255,255,0.25)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(canvas);
  }

  private collectFlashMats(mats: THREE.MeshStandardMaterial[]): Enemy['flashMats'] {
    return mats.map(mat => ({ mat, emissive: mat.emissive.clone(), intensity: mat.emissiveIntensity }));
  }

  private setFlash(enemy: Enemy, on: boolean): void {
    for (const f of enemy.flashMats) {
      if (on) {
        f.mat.emissive.set(0xffffff);
        f.mat.emissiveIntensity = 4;
      } else {
        f.mat.emissive.copy(f.emissive);
        f.mat.emissiveIntensity = f.intensity;
      }
    }
  }

  /** Upload-Bild als Sprite-Gegner (Feature bleibt erhalten). */
  private createSpriteEnemy(texture: THREE.Texture): void {
    if (!this.scene) return;

    const material = new THREE.SpriteMaterial({ map: texture });
    const sprite = new THREE.Sprite(material);
    sprite.scale.set(1.5, 1.5, 1);
    sprite.name = 'enemy';

    const angle = Math.random() * Math.PI * 2;
    const dist = 20 + Math.random() * 30;
    sprite.position.set(Math.cos(angle) * dist, 1, Math.sin(angle) * dist);

    const s = this.stats['sprite'];
    this.scene.add(sprite);
    this.enemies.push({
      root: sprite,
      kind: 'sprite',
      hp: s.hp,
      speed: s.speed,
      damage: s.damage,
      points: s.points,
      color: new THREE.Color(0xffaa00),
      baseY: s.baseY,
      bobPhase: Math.random() * Math.PI * 2,
      zigzagPhase: Math.random() * Math.PI * 2,
      zigzagFreq: s.zigzagFreq,
      zigzagStrength: s.zigzagStrength,
      spinSpeed: 0,
      flashMats: [],
      flashUntil: 0,
    });
    this.enemyRoots.push(sprite);
    this.countSubject.next(this.enemies.length);
  }

  // ------------------------------------------------------------------
  // Entfernen / Explodieren
  // ------------------------------------------------------------------

  private explodeKamikaze(enemy: Enemy): void {
    this.playerService.takeDamage(enemy.damage);
    this.eventSubject.next({
      type: 'exploded',
      kind: enemy.kind,
      position: enemy.root.position.clone(),
      color: enemy.color.clone(),
      points: 0,
    });
    this.destroyEnemy(enemy);
  }

  private destroyEnemy(enemy: Enemy): void {
    const index = this.enemies.indexOf(enemy);
    if (index === -1) return;

    this.scene?.remove(enemy.root);
    this.disposeObject(enemy.root);
    this.enemies.splice(index, 1);
    this.enemyRoots.splice(this.enemyRoots.indexOf(enemy.root), 1);
    this.countSubject.next(this.enemies.length);
  }

  /** Geometrien + Materialien freigeben (geteilte Glow-Textur bleibt am Leben). */
  private disposeObject(root: THREE.Object3D): void {
    root.traverse(obj => {
      const mesh = obj as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach(m => m.dispose());
      else mat?.dispose();
    });
  }

  // ------------------------------------------------------------------
  // Medikit (unverändert)
  // ------------------------------------------------------------------

  private createMedikit(): void {
    if (!this.scene) return;

    // Weiße Box mit rotem Kreuz (Canvas-Textur).
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, 64, 64);
    ctx.fillStyle = 'red';
    ctx.fillRect(24, 8, 16, 48);
    ctx.fillRect(8, 24, 48, 16);
    const texture = new THREE.CanvasTexture(canvas);

    this.medikit = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ map: texture })
    );
    this.scene.add(this.medikit);
    this.spawnMedikit();
  }

  private spawnMedikit(): void {
    if (!this.medikit) return;
    this.medikit.position.set(Math.random() * 160 - 80, 0.5, Math.random() * 160 - 80);
    this.medikit.visible = true;
  }

  private updateMedikit(playerPos: THREE.Vector3): void {
    if (!this.medikit || !this.medikit.visible || this.playerService.isDead) return;

    if (playerPos.distanceTo(this.medikit.position) < this.damageDistance) {
      this.playerService.heal(this.medikitHeal);
      this.medikit.visible = false;
      clearTimeout(this.medikitRespawnTimer);
      this.medikitRespawnTimer = setTimeout(() => this.spawnMedikit(), this.medikitRespawnMs);
    }
  }
}
