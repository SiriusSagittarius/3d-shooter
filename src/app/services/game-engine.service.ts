import { Injectable } from '@angular/core';
import { Subject, Observable } from 'rxjs';
import * as THREE from 'three';
import { GLTFLoader, GLTF } from 'three/addons/loaders/GLTFLoader.js'; // Pfad ist korrekt
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { Octree } from 'three/addons/math/Octree.js';
import { Capsule } from 'three/addons/math/Capsule.js';
import { Car } from '../models/car.model';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { Broom } from '../models/broom.model';
import { InputService } from './input.service';
import { LevelService, GameWorld } from './level.service';
import { ParticleService } from './particle.service';
import { EnemyService } from './enemy.service';

export type PlayerMode = 'ON_FOOT' | 'IN_CAR' | 'FLYING';

@Injectable({
  providedIn: 'root'
})
export class GameEngineService {
  private listener: THREE.AudioListener;
  private audioLoader: THREE.AudioLoader;
  private gltfLoader: GLTFLoader;
  private sounds: Map<string, THREE.Audio> = new Map();
  private controls?: PointerLockControls;
  private clock: THREE.Clock;
  private camera?: THREE.Camera;
  private audioContextStarted = false;
  
  public car?: Car;
  public broom: Broom;
  public fps: number = 0;

  /** Aktueller Fortbewegungsmodus. Nur EINE Physik ist pro Frame aktiv. */
  public mode: PlayerMode = 'ON_FOOT';

  /** Aktive Welt: 'arena' (Neon-Stadt), 'world2' (Lagerhalle), 'offroad' (Terrain). */
  public world: GameWorld = 'arena';
  /** Octree-Kollision der zweiten Welt (im Boden-Modus dort aktiv). */
  private world2Octree?: Octree;
  /** Kollisions-Kapsel des Spielers in Welt 2. */
  private playerCapsule?: Capsule;
  /** Verhindert sofortiges Zurück-Teleportieren direkt nach einem Portalwechsel. */
  private portalCooldownUntil = 0;

  private worldChangedSubject = new Subject<GameWorld>();
  /** Feuert bei jedem Weltwechsel (für HUD-Hinweis). */
  public worldChanged$: Observable<GameWorld> = this.worldChangedSubject.asObservable();

  private ringPassedSubject = new Subject<void>();
  /** Feuert, wenn der Besen durch einen Flug-Ring fliegt (für Score). */
  public ringPassed$: Observable<void> = this.ringPassedSubject.asObservable();

  private lockedSubject = new Subject<boolean>();
  /** true = Steuerung aktiv (Spiel läuft), false = Maus frei (Pause/Menü). */
  public locked$: Observable<boolean> = this.lockedSubject.asObservable();

  private playerVelocity = new THREE.Vector3();
  private broomRollVelocity = 0;
  private bKeyWasDown = false;
  private fKeyWasDown = false;

  /** Abstand, ab dem man in Reichweite des Autos ist (Ein-/Ausstieg). */
  private readonly carEnterDistance = 6;
  /** Auto-Kameraansichten (per Taste V umschaltbar). off = Position relativ zum Auto,
   *  ahead/lookH = Blickpunkt vor dem Auto. */
  private readonly carCamModes: { off: THREE.Vector3; ahead: number; lookH: number; name: string }[] = [
    { off: new THREE.Vector3(0, 2.7, 6.2),  ahead: 2.5, lookH: 0.1, name: 'VERFOLGER' },
    { off: new THREE.Vector3(0, 4.6, 11),   ahead: 3.0, lookH: 0.6, name: 'WEIT' },
    { off: new THREE.Vector3(0, 1.35, -1.1), ahead: 10, lookH: 0.6, name: 'MOTORHAUBE' },
    { off: new THREE.Vector3(0.32, 1.2, 0.15), ahead: 10, lookH: 1.1, name: 'COCKPIT' },
    { off: new THREE.Vector3(0, 13, 7),     ahead: 0,   lookH: 0,   name: 'VOGEL' },
  ];
  private carCamMode = 0;
  private vKeyWasDown = false;

  private carCamSubject = new Subject<string>();
  /** Feuert beim Umschalten der Auto-Kamera (für HUD-Hinweis). */
  public carCam$: Observable<string> = this.carCamSubject.asObservable();

  constructor(
    private inputService: InputService,
    private levelService: LevelService,
    private particleService: ParticleService,
    private enemyService: EnemyService
  ) {
    this.listener = new THREE.AudioListener();
    this.audioLoader = new THREE.AudioLoader();
    this.gltfLoader = new GLTFLoader();
    // Ferrari-Modell ist Draco-komprimiert -> Decoder aus lokalen Assets (kein CDN).
    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath('assets/draco/');
    this.gltfLoader.setDRACOLoader(dracoLoader);
    this.clock = new THREE.Clock();
    this.broom = new Broom();
  }

  /**
   * Koppelt den AudioListener an die Kamera. 
   * Muss aufgerufen werden, sobald die Three.js Kamera initialisiert wurde.
   */
  public init(camera: THREE.Camera, canvas: HTMLCanvasElement): void {
    this.camera = camera;
    camera.add(this.listener);
    this.controls = new PointerLockControls(camera, canvas);

    // PointerLock-Statuswechsel weitergeben (Pause/Weiter-Menü).
    this.controls.addEventListener('lock', () => this.lockedSubject.next(true));
    this.controls.addEventListener('unlock', () => this.lockedSubject.next(false));
  }

  public lockControls(): void {
    this.controls?.lock();
  }

  public unlockControls(): void {
    this.controls?.unlock();
  }

  public isLocked(): boolean {
    return this.controls?.isLocked || false;
  }

  /** Mausrad-Impuls für die Besen-Rolle (Schraube). Nur im Flug wirksam. */
  public addBroomRoll(deltaY: number): void {
    if (this.mode !== 'FLYING') return;
    this.broomRollVelocity -= deltaY * 0.05;
  }

  /** Zurück in den Fuß-Modus (z.B. nach Game Over / Neustart). */
  public resetToFoot(): void {
    this.mode = 'ON_FOOT';
    this.broom.isActive = false;
    this.playerVelocity.set(0, 0, 0);
    this.stopSound('wind');
  }

  /**
   * Lädt alle Sound-Dateien aus src/assets/audio/
   */
  public async loadGameAssets(): Promise<void> {
    const audioAssets = [
      { name: 'shoot', url: 'assets/audio/gun3.mp3' },
      { name: 'reload', url: 'assets/audio/reload.mp3' },
      { name: 'engine', url: 'assets/audio/dodge.mp3' },
      { name: 'walk', url: 'assets/audio/walk.mp3' },
      { name: 'sprint', url: 'assets/audio/sprint.mp3' },
      { name: 'jump', url: 'assets/audio/jump.mp3' },
      { name: 'rain', url: 'assets/audio/rain.mp3' },
      { name: 'wind', url: 'assets/audio/blow.mp3' },
      { name: 'door', url: 'assets/audio/door open.mp3' },
      { name: 'background', url: 'assets/audio/sound.mp3' },
      { name: 'hit', url: 'assets/audio/i1.mp3' },
      { name: 'kill', url: 'assets/audio/i2.mp3' },
      { name: 'explode', url: 'assets/audio/gun2.mp3' }
    ];

    const loadPromises = audioAssets.map(asset => this.loadSound(asset.name, asset.url));
    await Promise.all(loadPromises);
    console.log('Alle Audio-Assets geladen');
  }

  /**
   * Lädt das Auto-Modell
   */
  public loadCarModel(scene: THREE.Scene): Promise<void> {
    return new Promise((resolve, reject) => {
      this.gltfLoader.load('assets/models/ferrari/ferrari.glb', (gltf: GLTF) => {
        this.car = new Car(gltf.scene);
        this.car.setPosition(15, 0, 15); // Auto abseits vom Spawn parken (wie im Original)
        scene.add(this.car.mesh);
        resolve();
      }, undefined, (error: unknown) => {
        console.error('Fehler beim Laden des Ferrari:', error);
        reject(error);
      });
    });
  }

  /**
   * Lädt die animierten Gegner-Modelle (Soldat + Roboter) einmalig und übergibt
   * Szene + Animationen an den EnemyService, der sie pro Gegner klont.
   * Bricht nicht das Spiel ab, wenn ein Modell fehlt — der EnemyService fällt
   * dann automatisch auf seine prozeduralen Neon-Gegner zurück.
   */
  public async loadEnemyModels(): Promise<void> {
    const load = (url: string): Promise<GLTF | null> =>
      new Promise(resolve => {
        this.gltfLoader.load(url, gltf => resolve(gltf), undefined, err => {
          console.warn(`Gegner-Modell nicht geladen (${url}) – nutze prozedurales Fallback.`, err);
          resolve(null);
        });
      });

    // Nur menschliche Gegner: der Soldat. (Roboter/Neon-Formen sind raus.)
    const soldier = await load('assets/models/soldier/Soldier.glb');
    if (soldier) this.enemyService.registerModel('jaeger', soldier.scene, soldier.animations);
  }

  /**
   * Baut die zweite Welt (prozedurale Lagerhalle), erzeugt ihren Octree für die
   * Lauf-Kollision auf und übergibt das Modell an den LevelService.
   * Fehlt das Modell, bleibt nur die Arena verfügbar (kein Abbruch).
   */
  public loadWorldTwo(scene: THREE.Scene): Promise<void> {
    // Prozedurale Lagerhalle bauen und ihren Octree für die Lauf-Kollision erzeugen.
    const solids = this.levelService.buildWorldTwo(scene);
    this.world2Octree = new Octree().fromGraphNode(solids);
    // Spieler-Kapsel (Radius 0.35, Höhe ~1.5) für die Octree-Kollision.
    this.playerCapsule = new Capsule(
      new THREE.Vector3(0, 0.35, 0),
      new THREE.Vector3(0, 1.45, 0),
      0.35
    );
    // Dritte Welt: Offroad-Terrain aufbauen (Höhen werden zur Laufzeit gesampelt).
    this.levelService.buildOffroad(scene);
    return Promise.resolve();
  }

  /** Ankunftsposition beim Betreten einer Welt. */
  private arrivalPoint(target: GameWorld): THREE.Vector3 {
    if (target === 'world2') return new THREE.Vector3(0, 1.6, 0);
    if (target === 'offroad') {
      // Auf dem Terrain, nahe dem Rück-Portal (Höhe aus dem Terrain sampeln).
      const z = 6;
      return new THREE.Vector3(0, this.levelService.getTerrainHeight(0, z) + 1.6, z);
    }
    return new THREE.Vector3(0, 1.6, 20); // Arena-Spawn
  }

  /** Wechselt die aktive Welt und teleportiert den Spieler an den Ankunftspunkt. */
  private switchWorld(target: GameWorld): void {
    if (!this.camera) return;
    this.world = target;
    this.levelService.setWorld(target);
    this.enemyService.setActiveWorld(target); // Gegner der Zielwelt aktivieren

    // Weltwechsel immer zu Fuß.
    if (this.mode !== 'ON_FOOT') this.resetToFoot();

    // Auto in die passende Welt bringen: fahrbar in Arena + Offroad, versteckt in der Halle.
    if (this.car) {
      this.car.stop();
      if (target === 'world2') {
        this.car.mesh.visible = false;
      } else if (target === 'offroad') {
        this.car.mesh.visible = true;
        const cx = 6, cz = 8;
        this.car.setPosition(cx, this.levelService.getTerrainHeight(cx, cz), cz);
      } else {
        this.car.mesh.visible = true;
        this.car.setPosition(15, 0, 15); // Arena-Parkplatz
      }
    }

    const arrival = this.arrivalPoint(target);
    this.camera.position.copy(arrival);
    if (this.playerCapsule) {
      this.playerCapsule.start.set(arrival.x, arrival.y - 1.25, arrival.z);
      this.playerCapsule.end.set(arrival.x, arrival.y, arrival.z);
    }
    this.playerVelocity.set(0, 0, 0);
    this.portalCooldownUntil = performance.now() + 1200; // kurz gegen Sofort-Rückwechsel sperren
    this.playSound('door');
    this.worldChangedSubject.next(target);
  }

  /** Prüft, ob der Spieler in einem Portal steht, und wechselt dann die Welt. */
  private checkPortals(): void {
    if (!this.camera || performance.now() < this.portalCooldownUntil) return;
    const playerPos = this.mode === 'IN_CAR' && this.car ? this.car.mesh.position : this.camera.position;
    for (const portal of this.levelService.getPortals()) {
      // Nur Portale beachten, die in der aktuellen Welt stehen.
      if (portal.from !== this.world) continue;

      const p = portal.mesh.getWorldPosition(new THREE.Vector3());
      if (playerPos.distanceTo(p) < 2.4) {
        this.switchWorld(portal.target);
        return;
      }
    }
  }

  public updateGame() {
    const delta = this.clock.getDelta();

    // FPS Berechnung (einfache Glättung)
    if (delta > 0) {
      const currentFps = 1 / delta;
      // Glättungsfaktor 0.1 (nimmt 10% des neuen Werts und 90% des alten)
      this.fps = Math.round(this.fps * 0.9 + currentFps * 0.1);
    }

    if (!this.camera) return;

    // Treffer-Partikel immer aktualisieren (modusunabhängig).
    this.particleService.update(delta);

    // Gegner/Medikit im aktiven Spiel bewegen (EnemyService filtert nach aktiver Welt).
    if (this.controls?.isLocked) {
      const playerPos = this.mode === 'IN_CAR' && this.car
        ? this.car.mesh.position
        : this.camera.position;
      this.enemyService.update(delta, playerPos);
    }

    // Modus-Umschaltungen zuerst auswerten (Flanken-Erkennung), dann Physik.
    this.handleModeToggles();

    switch (this.mode) {
      case 'IN_CAR':
        this.updateCar(delta);
        break;
      case 'FLYING':
        this.updateFlying(delta);
        break;
      case 'ON_FOOT':
      default:
        this.updateOnFoot(delta);
        break;
    }

    // Portal-Betreten prüfen (zu Fuß oder im Auto).
    if (this.controls?.isLocked && this.mode !== 'FLYING') this.checkPortals();

    this.updateSounds();
  }

  /**
   * Hält die modusabhängigen Loop-Sounds am Laufen und stoppt die jeweils anderen:
   * Schritte/Sprint (Fuß), Motor (Auto), Wind (Fliegen).
   */
  private updateSounds(): void {
    const locked = this.controls?.isLocked;

    // Im Menü/Pause oder wenn nicht gelockt: alle Bewegungs-Loops still.
    if (!locked) {
      this.stopSound('walk');
      this.stopSound('sprint');
      this.stopSound('engine');
      this.stopSound('wind');
      return;
    }

    const onGround = this.camera ? this.camera.position.y <= 1.61 : false;
    const moving = this.inputService.moveForward || this.inputService.moveBackward ||
                   this.inputService.moveLeft || this.inputService.moveRight;

    // --- ZU FUSS: Schritte / Sprint ---
    if (this.mode === 'ON_FOOT' && moving && onGround) {
      if (this.inputService.moveSprint) {
        this.ensureLoop('sprint', 0.6);
        this.stopSound('walk');
      } else {
        this.ensureLoop('walk', 0.5);
        this.stopSound('sprint');
      }
    } else {
      this.stopSound('walk');
      this.stopSound('sprint');
    }

    // --- IM AUTO: Motor (Lautstärke steigt mit Tempo) ---
    if (this.mode === 'IN_CAR' && this.car) {
      const speed = Math.abs(this.car.getSpeed());
      this.ensureLoop('engine', 0.3 + Math.min(0.5, speed / 30 * 0.5));
    } else {
      this.stopSound('engine');
    }

    // --- FLIEGEN: Wind (Lautstärke steigt mit Tempo) ---
    if (this.mode === 'FLYING') {
      const volume = this.broom.getWindVolume(this.playerVelocity.length());
      if (volume > 0.05) this.ensureLoop('wind', volume);
      else this.stopSound('wind');
    } else {
      this.stopSound('wind');
    }
  }

  /** Wertet die Umschalt-Tasten aus (B = Besen, F = Auto ein/aus). */
  private handleModeToggles(): void {
    // --- Besen (Taste B): schaltet zwischen ON_FOOT und FLYING um ---
    const bDown = this.inputService.broom;
    if (bDown && !this.bKeyWasDown && this.mode !== 'IN_CAR') {
      if (this.mode === 'FLYING') {
        this.mode = 'ON_FOOT';
        this.broom.isActive = false;
        this.stopSound('wind');
      } else {
        this.mode = 'FLYING';
        this.broom.isActive = true;
        this.playerVelocity.set(0, 0, 0);
      }
    }
    this.bKeyWasDown = bDown;

    // --- Auto (Taste F): einsteigen, wenn nah genug; aussteigen jederzeit ---
    const fDown = this.inputService.enterCar;
    if (fDown && !this.fKeyWasDown && this.car) {
      if (this.mode === 'IN_CAR') {
        // Aussteigen: Spieler neben das Auto stellen.
        this.mode = 'ON_FOOT';
        const side = new THREE.Vector3(1, 0, 0).applyQuaternion(this.car.mesh.quaternion);
        this.camera!.position.copy(this.car.mesh.position).addScaledVector(side, 3);
        this.camera!.position.y = 1.6;
        this.playerVelocity.set(0, 0, 0);
        this.playSound('door'); // Tür-Sound beim Aussteigen
      } else if (this.mode === 'ON_FOOT') {
        const dist = this.car.mesh.position.distanceTo(this.camera!.position);
        if (dist <= this.carEnterDistance) {
          this.mode = 'IN_CAR';
          this.playSound('door');
        }
      }
    }
    this.fKeyWasDown = fDown;

    // --- Auto-Kamera umschalten (Taste V, nur im Auto) ---
    const vDown = this.inputService.changeCamera;
    if (vDown && !this.vKeyWasDown && this.mode === 'IN_CAR') {
      this.carCamMode = (this.carCamMode + 1) % this.carCamModes.length;
      this.carCamSubject.next(this.carCamModes[this.carCamMode].name);
    }
    this.vKeyWasDown = vDown;
  }

  /** Auto fahren + Verfolgerkamera. */
  private updateCar(delta: number): void {
    if (!this.car || !this.camera) return;

    const oldPos = this.car.mesh.position.clone();

    this.car.update({
      delta,
      forward: this.inputService.driveForward,
      backward: this.inputService.driveBackward,
      left: this.inputService.steerLeft,
      right: this.inputService.steerRight
    });

    if (this.world === 'offroad') {
      this.settleCarOnTerrain();
    } else if (this.world === 'arena' && this.checkCollisions()) {
      // Nur in der Arena gibt es Hindernis-Boxen (Gebäude/Wände).
      this.car.mesh.position.copy(oldPos);
      this.car.stop();
    }

    // Kamera nach gewähltem Modus (Taste V), aufrecht (nur Fahrtrichtung),
    // damit die Hangneigung im Offroad die Sicht nicht kippt.
    const cam = this.carCamModes[this.carCamMode];
    const yawQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.car.getHeading());
    const offset = cam.off.clone().applyQuaternion(yawQuat);
    this.camera.position.copy(this.car.mesh.position).add(offset);
    // Blickpunkt vor dem Auto (Fahrtrichtung = -Z, mit Heading gedreht).
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(yawQuat);
    const look = this.car.mesh.position.clone().addScaledVector(forward, cam.ahead);
    look.y += cam.lookH;
    this.camera.lookAt(look);
  }

  /** Setzt das Auto auf die Terrainhöhe und neigt es in den Hang (Offroad). */
  private settleCarOnTerrain(): void {
    if (!this.car) return;
    const p = this.car.mesh.position;
    // In den Terrain-Grenzen bleiben.
    const half = this.levelService.getTerrainHalf();
    p.x = THREE.MathUtils.clamp(p.x, -half, half);
    p.z = THREE.MathUtils.clamp(p.z, -half, half);
    // Höhe = Terrain unter dem Auto.
    p.y = this.levelService.getTerrainHeight(p.x, p.z);

    // Hang-Normale aus benachbarten Höhen -> Auto in die Neigung kippen.
    const e = 1.2;
    const hL = this.levelService.getTerrainHeight(p.x - e, p.z);
    const hR = this.levelService.getTerrainHeight(p.x + e, p.z);
    const hD = this.levelService.getTerrainHeight(p.x, p.z - e);
    const hU = this.levelService.getTerrainHeight(p.x, p.z + e);
    const normal = new THREE.Vector3(hL - hR, 2 * e, hD - hU).normalize();

    const up = new THREE.Vector3(0, 1, 0);
    const yawQ = new THREE.Quaternion().setFromAxisAngle(up, this.car.getHeading());
    const tiltQ = new THREE.Quaternion().setFromUnitVectors(up, normal);
    this.car.mesh.quaternion.copy(tiltQ).multiply(yawQ);
  }

  /** Besen-Flug. */
  private updateFlying(delta: number): void {
    if (!this.camera) return;

    this.broomRollVelocity = this.broom.update(
      delta,
      this.playerVelocity,
      this.camera,
      this.inputService.isAccelerating,
      this.broomRollVelocity
    );

    // Schraube (Rollen) um die eigene Vorwärtsachse — per Mausrad gespeist.
    if (Math.abs(this.broomRollVelocity) > 0.0001) {
      const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
      const roll = new THREE.Quaternion().setFromAxisAngle(forward, this.broomRollVelocity * delta);
      this.camera.quaternion.premultiply(roll);
    }

    this.camera.position.addScaledVector(this.playerVelocity, delta);
    this.broom.checkFloorCollision(this.camera.position, this.playerVelocity);
    // Wind-Sound wird zentral in updateSounds() gesteuert.

    // Ring-Durchflug: nahe, noch sichtbare Ringe verschwinden lassen + melden.
    for (const ring of this.levelService.getRings()) {
      if (ring.visible && this.camera.position.distanceTo(ring.position) < 5) {
        ring.visible = false;
        this.ringPassedSubject.next();
      }
    }
  }

  /** Normale Lauf-Physik in Ego-Perspektive. */
  private updateOnFoot(delta: number): void {
    if (!this.camera || !this.controls?.isLocked) return;

    this.playerVelocity.x -= this.playerVelocity.x * 10.0 * delta;
    this.playerVelocity.z -= this.playerVelocity.z * 10.0 * delta;
    this.playerVelocity.y -= 9.8 * 3.0 * delta; // Gravitation

    const dirZ = Number(this.inputService.moveForward) - Number(this.inputService.moveBackward);
    const dirX = Number(this.inputService.moveRight) - Number(this.inputService.moveLeft);

    const speed = 150.0;
    if (dirZ !== 0) this.playerVelocity.z -= dirZ * speed * delta;
    if (dirX !== 0) this.playerVelocity.x -= dirX * speed * delta;

    this.controls.moveRight(-this.playerVelocity.x * delta);
    this.controls.moveForward(-this.playerVelocity.z * delta);

    this.camera.position.y += this.playerVelocity.y * delta;

    if (this.world === 'world2' && this.world2Octree && this.playerCapsule) {
      this.resolveWorldTwoCollision();
    } else if (this.world === 'offroad') {
      // Offroad: der Boden ist die Terrainhöhe unter dem Spieler.
      const groundY = this.levelService.getTerrainHeight(this.camera.position.x, this.camera.position.z) + 1.6;
      if (this.camera.position.y < groundY) {
        this.playerVelocity.y = 0;
        this.camera.position.y = groundY;
        if (this.inputService.jump) {
          this.playerVelocity.y = 12.0;
          this.playSound('jump');
        }
      }
    } else {
      // Arena: einfache, flache Bodenkollision.
      if (this.camera.position.y < 1.6) {
        this.playerVelocity.y = 0;
        this.camera.position.y = 1.6;
        if (this.inputService.jump) {
          this.playerVelocity.y = 12.0;
          this.playSound('jump');
        }
      }
    }
  }

  /**
   * Octree-Kollision der zweiten Welt: die Spieler-Kapsel folgt der Kamera,
   * wird gegen die Level-Geometrie geschoben und korrigiert die Kamera zurück.
   */
  private resolveWorldTwoCollision(): void {
    if (!this.camera || !this.world2Octree || !this.playerCapsule) return;
    const cap = this.playerCapsule;

    // Kapsel unter die Kamera setzen (Auge ~1.25 über der Kapselspitze).
    const eye = 1.25;
    cap.start.set(this.camera.position.x, this.camera.position.y - eye, this.camera.position.z);
    cap.end.set(this.camera.position.x, this.camera.position.y - eye + 1.1, this.camera.position.z);

    const result = this.world2Octree.capsuleIntersect(cap);
    let onGround = false;
    if (result) {
      // Aus der Wand/dem Boden herausschieben.
      if (result.normal.y > 0.3) {          // Bodenkontakt
        onGround = true;
        this.playerVelocity.y = 0;
      }
      cap.translate(result.normal.multiplyScalar(result.depth));
      // Kamera der korrigierten Kapsel folgen lassen.
      this.camera.position.set(cap.start.x, cap.start.y + eye, cap.start.z);
    }

    if (onGround && this.inputService.jump) {
      this.playerVelocity.y = 12.0;
      this.playSound('jump');
    }

    // Failsafe: nicht durch den Weltboden fallen.
    if (this.camera.position.y < -20) {
      this.camera.position.set(0, 1.6, 0);
      this.playerVelocity.set(0, 0, 0);
    }
  }

  private checkCollisions(): boolean {
    if (!this.car) return false;

    // Feste, kompakte Kollisionsbox um die Auto-Position (statt setFromObject,
    // das beim stark skalierten GLTF-Modell unzuverlässig/teuer ist).
    const p = this.car.mesh.position;
    const half = 2.2; // ~4.4m Kantenlänge
    const carBB = new THREE.Box3(
      new THREE.Vector3(p.x - half, p.y, p.z - half),
      new THREE.Vector3(p.x + half, p.y + 3, p.z + half)
    );

    for (const bound of this.levelService.getObstacleBounds()) {
      if (carBB.intersectsBox(bound)) return true;
    }
    return false;
  }

  private loadSound(name: string, url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.audioLoader.load(url, (buffer: AudioBuffer) => { // Explizite Typisierung
        const sound = new THREE.Audio(this.listener);
        sound.setBuffer(buffer);
        this.sounds.set(name, sound);
        resolve();
      }, undefined, (err: unknown) => { // Explizite Typisierung
        console.error(`Fehler beim Laden von: ${url}`, err);
        reject(err);
      });
    });
  }

  /**
   * Startet den AudioContext (wichtig wegen Browser-Autoplay-Policies)
   */
  public resumeAudioContext(): void {
    if (!this.audioContextStarted && this.listener.context.state === 'suspended') {
      this.listener.context.resume().then(() => {
        this.audioContextStarted = true;
      });
    }
  }

  /** Startet die loopende Hintergrundmusik (idempotent). */
  public startBackgroundMusic(): void {
    this.ensureLoop('background', 0.3);
  }

  public playSound(name: string, volume: number = 0.5, loop: boolean = false): void {
    const sound = this.sounds.get(name);
    if (sound) {
      if (sound.isPlaying) sound.stop();
      sound.setVolume(volume);
      sound.setLoop(loop);
      sound.play();
    }
  }

  public stopSound(name: string): void {
    const sound = this.sounds.get(name);
    if (sound && sound.isPlaying) {
      sound.stop();
    }
  }

  /**
   * Hält einen Loop-Sound am Laufen: startet ihn nur, wenn er nicht schon spielt
   * (verhindert das Stottern von playSound, das jeden Frame neu startet).
   * Die Lautstärke wird live nachgeregelt.
   */
  public ensureLoop(name: string, volume: number): void {
    const sound = this.sounds.get(name);
    if (!sound) return;
    sound.setVolume(volume);
    if (!sound.isPlaying) {
      sound.setLoop(true);
      sound.play();
    }
  }

  public setGlobalVolume(value: number): void {
    this.listener.setMasterVolume(value);
  }
}