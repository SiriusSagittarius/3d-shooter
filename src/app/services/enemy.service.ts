import { Injectable } from '@angular/core';
import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { BehaviorSubject, Observable, Subject } from 'rxjs';
import { PlayerService } from './player.service';
import { GameWorld } from './level.service';

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
  /** Animation (nur bei GLTF-Modell-Gegnern gesetzt). */
  mixer?: THREE.AnimationMixer;
  /** Animationen: Idle (Stillstand), Walk (Patrouille), Run (Angriff). */
  idleAction?: THREE.AnimationAction;
  walkAction?: THREE.AnimationAction;
  runAction?: THREE.AnimationAction;
  /** true = echtes GLTF-Modell (bekommt kein bobbing/lookAt-Kippeln, läuft am Boden). */
  isModel: boolean;
  /** false = passiv (patrouilliert), true = greift an (läuft auf Spieler zu). */
  aggro: boolean;
  /** Patrouille: aktuelles Wander-Ziel (XZ) und Zeit bis zum nächsten Ziel. */
  wanderTarget: THREE.Vector3;
  wanderTimer: number;
  /** true = gerade eine kurze Idle-Pause während der Patrouille. */
  wanderPausing: boolean;
  /** Zu welcher Welt der Gegner gehört (nur die aktive Welt wird bewegt/sichtbar). */
  world: GameWorld;
}

/** Vorgeladenes GLTF-Modell + seine Animationsclips (einmal geladen, pro Gegner geklont). */
interface EnemyModel {
  scene: THREE.Object3D;
  clips: THREE.AnimationClip[];
  /** Zielhöhe des Fußpunkts über dem Boden (Modelle stehen auf y=baseModelY). */
  baseModelY: number;
  /** Uniform-Skalierung, damit das Modell zur Gegner-Größe passt. */
  scale: number;
  /** Name des Lauf-Clips (Angriff) — je nach Modell unterschiedlich. */
  runClip: string;
  /** Name des Ruhe-Clips (passiv stehend). */
  idleClip: string;
  /** Name des Geh-Clips (Patrouille). */
  walkClip: string;
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

  /** Vorgeladene GLTF-Modelle pro Gegnertyp (leer = prozedurales Fallback). */
  private models = new Map<EnemyKind, EnemyModel>();

  /** Aktuell aktive Welt — nur deren Gegner bewegen sich und sind sichtbar. */
  private activeWorld: GameWorld = 'arena';
  /** Ob Welt 2 schon mit Patrouillen-Soldaten bevölkert wurde. */
  private world2Populated = false;

  private medikit?: THREE.Mesh;
  private medikitRespawnTimer?: ReturnType<typeof setTimeout>;
  private lastDamageTime = 0;

  private readonly damageDistance = 1.6;
  private readonly damageCooldownMs = 800;
  private readonly medikitHeal = 50;
  private readonly medikitRespawnMs = 20000;
  private readonly maxAlive = 30;
  private readonly waveBreakSeconds = 3.5;
  /** Radius, in dem ein beschossener Gegner seine Nachbarn mit-alarmiert. */
  private readonly aggroRadius = 14;
  /** Geh-Tempo passiver Gegner beim Patrouillieren (langsamer als Angriff). */
  private readonly patrolSpeed = 1.6;
  /** Radius, in dem passive Gegner um ihren Spawn herum umherwandern. */
  private readonly patrolRange = 16;

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

  /**
   * Registriert ein vorgeladenes GLTF-Modell als Optik für einen Gegnertyp.
   * Ab jetzt spawnt dieser Typ als animiertes Modell statt als Neon-Form.
   * Vom GameEngineService nach dem Laden aufgerufen.
   */
  public registerModel(kind: EnemyKind, scene: THREE.Object3D, clips: THREE.AnimationClip[]): void {
    // Sinnvolle Größe/Höhe/Clips pro Modell (die Rohmodelle haben verschiedene Maßstäbe).
    const cfg: Record<string, { scale: number; baseModelY: number; runClip: string; idleClip: string; walkClip: string }> = {
      // Soldier.glb: Idle / Walk / Run
      jaeger: { scale: 1.3, baseModelY: 0, runClip: 'Run', idleClip: 'Idle', walkClip: 'Walk' },
    };
    const c = cfg[kind] ?? { scale: 1, baseModelY: 0, runClip: 'Run', idleClip: 'Idle', walkClip: 'Walk' };

    // Modelle werfen ohne Schatten-Setup manchmal dunkel — sicherstellen, dass sie sichtbar sind.
    scene.traverse(obj => {
      const mesh = obj as THREE.Mesh;
      if (mesh.isMesh) mesh.frustumCulled = false;
    });

    this.models.set(kind, {
      scene, clips, scale: c.scale, baseModelY: c.baseModelY,
      runClip: c.runClip, idleClip: c.idleClip, walkClip: c.walkClip,
    });
  }

  /** Wurzel-Objekte der Gegner der AKTIVEN Welt (Trefferliste für Raycasts + Minimap). */
  public getEnemies(): THREE.Object3D[] {
    return this.enemies.filter(e => e.world === this.activeWorld).map(e => e.root);
  }

  /** Startet das Wellen-Spawning (idempotent — mehrfacher Aufruf schadet nicht). */
  public startWaves(): void {
    if (this.wavesRunning) return;
    this.wavesRunning = true;
    this.waveBreakTimer = 1.2; // erste Welle kommt fast sofort
  }

  /**
   * Wechselt die aktive Welt: nur deren Gegner bewegen sich und sind sichtbar.
   * Beim ersten Betreten von Welt 2 werden dort Patrouillen-Soldaten platziert.
   */
  public setActiveWorld(world: GameWorld): void {
    this.activeWorld = world;
    if (world === 'world2' && !this.world2Populated && this.models.has('jaeger')) {
      this.world2Populated = true;
      this.spawnWorldTwoPatrol();
    }
    // Sichtbarkeit angleichen: nur Gegner der aktiven Welt zeigen.
    for (const e of this.enemies) e.root.visible = e.world === world;
  }

  /** Platziert eine Handvoll patrouillierender Soldaten in der Lagerhalle (Welt 2). */
  private spawnWorldTwoPatrol(): void {
    // Feste Startpunkte in der Halle (nicht am Eingang bei +z), verteilt.
    const spots: [number, number][] = [
      [-14, -6], [12, -4], [-8, 6], [16, 8], [0, -12], [-18, -14], [18, -16], [6, 12],
    ];
    for (const [x, z] of spots) this.spawnPatrolSoldier(x, z);
  }

  /** Einzelner passiver Patrouillen-Soldat an fester Position (für Welt 2). */
  private spawnPatrolSoldier(x: number, z: number): void {
    if (!this.scene || !this.models.has('jaeger')) return;
    const build = this.buildModelEnemy('jaeger');
    const s = this.stats['jaeger'];
    build.root.position.set(x, build.baseModelY, z);
    build.root.visible = this.activeWorld === 'world2';

    this.enemies.push({
      root: build.root,
      kind: 'jaeger',
      hp: s.hp,
      speed: s.speed,
      damage: s.damage,
      points: s.points,
      color: build.color,
      baseY: build.baseModelY,
      bobPhase: Math.random() * Math.PI * 2,
      zigzagPhase: Math.random() * Math.PI * 2,
      zigzagFreq: s.zigzagFreq,
      zigzagStrength: s.zigzagStrength,
      spin: build.spin,
      spinSpeed: build.spinSpeed,
      flashMats: build.flashMats,
      flashUntil: 0,
      mixer: build.mixer,
      idleAction: build.idleAction,
      walkAction: build.walkAction,
      runAction: build.runAction,
      isModel: build.isModel,
      aggro: false,
      wanderTarget: this.randomPatrolPoint(x, z, 26),
      wanderTimer: 2 + Math.random() * 3,
      wanderPausing: false,
      world: 'world2',
    });
    this.scene.add(build.root);
    this.enemyRoots.push(build.root);
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
    this.activeWorld = 'arena';
    this.world2Populated = false; // Welt 2 wird beim nächsten Betreten neu bevölkert
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

    // Beschuss weckt den getroffenen Gegner + alle Nachbarn im Umkreis (aggro).
    this.wakeNearby(enemy.root.position, this.aggroRadius);

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

  /** Weckt alle passiven Gegner innerhalb des Radius um einen Punkt (Aggro). */
  private wakeNearby(center: THREE.Vector3, radius: number): void {
    const r2 = radius * radius;
    for (const e of this.enemies) {
      if (e.aggro) continue;
      if (e.root.position.distanceToSquared(center) <= r2) this.setAggro(e);
    }
  }

  /** Schaltet einen Gegner scharf: von Patrouille (Walk/Idle) auf Run überblenden. */
  private setAggro(enemy: Enemy): void {
    if (enemy.aggro) return;
    enemy.aggro = true;
    if (enemy.runAction) {
      const from = enemy.wanderPausing ? enemy.idleAction : enemy.walkAction;
      enemy.runAction.reset().play();
      if (from) from.crossFadeTo(enemy.runAction, 0.25, false);
      else enemy.runAction.fadeIn(0.25);
    }
  }

  /** Zufälliger Patrouillenpunkt nahe einem Spawn-Ort, innerhalb der Weltgrenze. */
  private randomPatrolPoint(x: number, z: number, bound = 92): THREE.Vector3 {
    const a = Math.random() * Math.PI * 2;
    const r = 4 + Math.random() * this.patrolRange;
    return new THREE.Vector3(
      THREE.MathUtils.clamp(x + Math.cos(a) * r, -bound, bound),
      0,
      THREE.MathUtils.clamp(z + Math.sin(a) * r, -bound, bound)
    );
  }

  /** Richtet einen Gegner Richtung (tx,tz) aus (Modelle sind um 180° gedreht). */
  private faceTowards(e: Enemy, tx: number, tz: number): void {
    e.root.lookAt(tx, e.root.position.y, tz);
    if (e.isModel) e.root.rotateY(Math.PI);
  }

  /**
   * Passive Patrouille: läuft gemächlich zum Wander-Ziel, macht am Ziel eine
   * kurze Idle-Pause und sucht sich dann ein neues Ziel. Wirkt lebendig,
   * ohne den Spieler zu verfolgen (Aggro passiert nur durch Beschuss).
   */
  private updatePatrol(e: Enemy, delta: number): void {
    const root = e.root;
    e.wanderTimer -= delta;

    if (e.wanderPausing) {
      // Kurze Verschnaufpause (Idle) — danach neues Ziel und weiterlaufen.
      if (e.wanderTimer <= 0) {
        e.wanderPausing = false;
        e.wanderTarget = this.randomPatrolPoint(root.position.x, root.position.z, e.world === 'world2' ? 26 : 92);
        e.wanderTimer = 4 + Math.random() * 4;
        if (e.idleAction && e.walkAction) {
          e.walkAction.reset().play();
          e.idleAction.crossFadeTo(e.walkAction, 0.3, false);
        }
      }
      return;
    }

    // Zum Wander-Ziel laufen.
    const dx = e.wanderTarget.x - root.position.x;
    const dz = e.wanderTarget.z - root.position.z;
    const d = Math.hypot(dx, dz);

    if (d < 0.6 || e.wanderTimer <= 0) {
      // Ziel erreicht (oder Zeit um): kurze Idle-Pause einlegen.
      e.wanderPausing = true;
      e.wanderTimer = 1.2 + Math.random() * 2.5;
      if (e.idleAction && e.walkAction) {
        e.idleAction.reset().play();
        e.walkAction.crossFadeTo(e.idleAction, 0.3, false);
      }
      return;
    }

    root.position.x += (dx / d) * this.patrolSpeed * delta;
    root.position.z += (dz / d) * this.patrolSpeed * delta;
    this.faceTowards(e, e.wanderTarget.x, e.wanderTarget.z);
  }

  /** Pro Frame: Wellen spawnen, Gegner bewegen, Schaden prüfen, Medikit aufsammeln. */
  public update(delta: number, playerPos: THREE.Vector3): void {
    const now = performance.now();
    const time = now / 1000;

    // Wellen nur in der Arena; Welt 2 hat feste Patrouillen-Soldaten.
    if (this.wavesRunning && this.activeWorld === 'arena') this.updateWaveSpawning(delta, playerPos);

    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      const root = e.root;

      // Gegner fremder Welten ruhen (unsichtbar, keine Bewegung/kein Schaden).
      if (e.world !== this.activeWorld) continue;

      // Richtung zum Spieler (nur XZ-Ebene).
      const dir = new THREE.Vector3(playerPos.x - root.position.x, 0, playerPos.z - root.position.z);
      const dist = dir.length();
      if (dist > 0.001) dir.divideScalar(dist);

      if (e.aggro) {
        // ANGRIFF: auf den Spieler zu (mit leichtem Zickzack), Blick zum Spieler.
        const speed = e.speed;
        const zig = Math.sin(time * e.zigzagFreq + e.zigzagPhase) * e.zigzagStrength;
        root.position.x += (dir.x * speed - dir.z * zig) * delta;
        root.position.z += (dir.z * speed + dir.x * zig) * delta;
        if (e.kind !== 'sprite') this.faceTowards(e, playerPos.x, playerPos.z);
      } else if (e.isModel) {
        // PATROUILLE: passive Soldaten wandern gemächlich umher (Walk),
        // mit gelegentlichen kurzen Pausen (Idle).
        this.updatePatrol(e, delta);
      } else if (e.kind !== 'sprite') {
        // Passive Neon-Gegner (Fallback) schauen einfach zum Spieler.
        this.faceTowards(e, playerPos.x, playerPos.z);
      }

      // Neon-Gegner schweben/wippen; Modell-Gegner stehen fest am Boden.
      root.position.y = e.isModel ? e.baseY : e.baseY + Math.sin(time * 2 + e.bobPhase) * 0.25;

      // Animation weiterdrehen (Walk beim Patrouillieren, Run beim Angriff).
      if (e.mixer) e.mixer.update(delta);

      // Rotierende Deko (Wireframe-Schale / Ring) — nur Neon-Gegner.
      if (e.spin) {
        e.spin.rotation.y += e.spinSpeed * delta;
        e.spin.rotation.x += e.spinSpeed * 0.6 * delta;
      }

      // Hit-Flash nach Ablauf zurücksetzen.
      if (e.flashUntil > 0 && now > e.flashUntil) {
        e.flashUntil = 0;
        this.setFlash(e, false);
      }

      // Kontakt mit dem Spieler nur, wenn der Gegner aktiv angreift.
      if (e.aggro && dist < this.damageDistance && now - this.lastDamageTime > this.damageCooldownMs) {
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

  /** Zusammensetzung der Welle: nur noch menschliche Soldaten, mit den Wellen mehr. */
  private buildWaveQueue(wave: number): EnemyKind[] {
    const count = Math.min(5 + wave * 2, 24);
    return new Array(count).fill('jaeger');
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

    // Modell-Gegner, falls für diesen Typ ein GLTF registriert wurde, sonst Neon-Form.
    const build = this.models.has(kind)
      ? this.buildModelEnemy(kind)
      : { ...this.buildEnemyMesh(kind), mixer: undefined, isModel: false, baseModelY: 0,
          idleAction: undefined, walkAction: undefined, runAction: undefined };
    const s = this.stats[kind];
    // Modell-Gegner stehen am Boden (baseModelY), Neon-Gegner schweben (baseY).
    const baseY = build.isModel ? build.baseModelY : s.baseY;

    // Rund um den Spieler spawnen (22–40m), innerhalb der Arena-Wände bleiben.
    const angle = Math.random() * Math.PI * 2;
    const dist = 22 + Math.random() * 18;
    const x = THREE.MathUtils.clamp(playerPos.x + Math.cos(angle) * dist, -92, 92);
    const z = THREE.MathUtils.clamp(playerPos.z + Math.sin(angle) * dist, -92, 92);
    build.root.position.set(x, baseY, z);

    const enemy: Enemy = {
      root: build.root,
      kind,
      hp: s.hp,
      speed: s.speed * this.waveSpeedScale(),
      damage: s.damage,
      points: s.points,
      color: build.color,
      baseY,
      bobPhase: Math.random() * Math.PI * 2,
      zigzagPhase: Math.random() * Math.PI * 2,
      zigzagFreq: s.zigzagFreq,
      zigzagStrength: s.zigzagStrength,
      spin: build.spin,
      spinSpeed: build.spinSpeed,
      flashMats: build.flashMats,
      flashUntil: 0,
      mixer: build.mixer,
      idleAction: build.idleAction,
      walkAction: build.walkAction,
      runAction: build.runAction,
      isModel: build.isModel,
      aggro: false, // startet passiv — greift erst nach Beschuss an
      wanderTarget: this.randomPatrolPoint(x, z),
      wanderTimer: 2 + Math.random() * 3,
      wanderPausing: false,
      world: this.activeWorld,
    };

    this.scene.add(build.root);
    this.enemies.push(enemy);
    this.enemyRoots.push(build.root);
    this.countSubject.next(this.enemies.length);
  }

  /**
   * Baut einen Gegner aus einem vorgeladenen GLTF-Modell: klont Skinned Mesh
   * (SkeletonUtils), startet den Lauf-Clip in einem eigenen Mixer und sammelt
   * die Materialien fürs Treffer-Aufblitzen ein.
   */
  private buildModelEnemy(kind: EnemyKind): {
    root: THREE.Object3D; color: THREE.Color; spin?: THREE.Object3D; spinSpeed: number;
    flashMats: Enemy['flashMats']; mixer?: THREE.AnimationMixer; isModel: boolean; baseModelY: number;
    idleAction?: THREE.AnimationAction; walkAction?: THREE.AnimationAction; runAction?: THREE.AnimationAction;
  } {
    const model = this.models.get(kind)!;

    // Wrapper-Group: das geklonte Modell hängt drin, damit lookAt/Skalierung sauber sind.
    const root = new THREE.Group();
    root.name = 'enemy';

    const inst = cloneSkinned(model.scene);
    inst.scale.setScalar(model.scale);
    root.add(inst);

    // Eigener Mixer je Gegner mit Idle (Pause), Walk (Patrouille) und Run (Angriff).
    // Gegner starten patrouillierend (Walk) und wechseln erst bei Aggro auf Run.
    let mixer: THREE.AnimationMixer | undefined;
    let idleAction: THREE.AnimationAction | undefined;
    let walkAction: THREE.AnimationAction | undefined;
    let runAction: THREE.AnimationAction | undefined;
    if (model.clips.length > 0) {
      mixer = new THREE.AnimationMixer(inst);
      const findClip = (name: string, re: RegExp) =>
        THREE.AnimationClip.findByName(model.clips, name) ??
        model.clips.find(c => re.test(c.name)) ?? model.clips[0];

      const idleClip = findClip(model.idleClip, /idle|stand/i);
      const walkClip = findClip(model.walkClip, /walk/i);
      const runClip = findClip(model.runClip, /run/i);

      idleAction = mixer.clipAction(idleClip);
      walkAction = mixer.clipAction(walkClip);
      runAction = mixer.clipAction(runClip);
      // Phasen versetzen, sonst laufen alle im Gleichschritt.
      walkAction.time = Math.random() * walkClip.duration;
      runAction.time = Math.random() * runClip.duration;
      walkAction.play(); // passiv patrouillieren
    }

    // Materialien klonen (sonst blitzen alle Klone gemeinsam) und fürs Hit-Flash sammeln.
    const flashMats: Enemy['flashMats'] = [];
    inst.traverse(obj => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      // WICHTIG: Raycast auf den animierten SkinnedMeshes abschalten. three.js testet
      // sie gegen die statische Bind-Pose -> Treffer würden neben dem sichtbaren
      // Soldaten liegen. Getroffen wird stattdessen die Trefferbox (unten).
      mesh.raycast = () => {};
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      mesh.material = mats.map(m => {
        const cloned = m.clone();
        if ((cloned as THREE.MeshStandardMaterial).emissive) {
          const std = cloned as THREE.MeshStandardMaterial;
          flashMats.push({ mat: std, emissive: std.emissive.clone(), intensity: std.emissiveIntensity });
        }
        return cloned;
      });
      if (Array.isArray(mesh.material) && mesh.material.length === 1) mesh.material = mesh.material[0];
    });

    // Unsichtbare Trefferbox, die dem Gegner folgt (das ist das eigentliche Ziel).
    // Sie umschließt den stehenden Soldaten ~ (Breite 0.9, Höhe 2.0, Tiefe 0.7).
    const hitbox = new THREE.Mesh(
      new THREE.BoxGeometry(1.0, 2.3, 0.8),
      new THREE.MeshBasicMaterial()
    );
    hitbox.position.y = 1.15;
    hitbox.visible = false; // wird nicht gerendert, ist aber weiter raycastbar
    root.add(hitbox);

    const color = new THREE.Color(0xff5533);
    return {
      root, color, spin: undefined, spinSpeed: 0, flashMats, mixer,
      isModel: true, baseModelY: model.baseModelY, idleAction, walkAction, runAction,
    };
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
      isModel: false,
      aggro: true, // Upload-Sprite-Gegner sind sofort aktiv
      wanderTarget: sprite.position.clone(),
      wanderTimer: 0,
      wanderPausing: false,
      world: this.activeWorld,
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

    // Animation stoppen, damit der Mixer nicht auf ein entferntes Objekt weiterläuft.
    if (enemy.mixer) enemy.mixer.stopAllAction();

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
