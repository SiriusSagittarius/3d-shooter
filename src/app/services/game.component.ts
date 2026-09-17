import { Component, ElementRef, ViewChild, AfterViewInit, OnDestroy, NgZone, HostListener } from '@angular/core';
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { GameEngineService } from './game-engine.service';
import { LevelService } from './level.service';
import { DebugOverlayComponent } from './debug-overlay.component';
import { WeaponService } from './weapon.service';
import { WeaponViewService } from './weapon-view.service';
import { ParticleService } from './particle.service';
import { InputService } from './input.service';
import { EnemyService } from './enemy.service';
import { PlayerService } from './player.service';
import { CommonModule } from '@angular/common';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-game',
  standalone: true,
  imports: [CommonModule, DebugOverlayComponent],
  template: `
    <app-debug-overlay></app-debug-overlay>

    <!-- First-Person-Waffe als 2D-Sprite (s2 = Ruhe, s3-s5 = Schuss-Animation) -->
    <img #weaponEl id="weapon" src="assets/img/sniper/s2.png" alt="Weapon" style="display:none" />

    <!-- Scope-Overlay beim Zielen -->
    <img #scopeEl id="scope" src="assets/img/sniper/s1.png" style="display:none" />

    <!-- Flugbesen — nur im Flug-Modus sichtbar -->
    <img #broomEl id="broom" src="assets/img/besen.png" style="display:none" />

    <!-- Fadenkreuz -->
    <div #crosshairEl id="crosshair"></div>

    <!-- Auto-Dashboard (Tacho), nur im Auto sichtbar -->
    <div #dashboardEl id="dashboard">
      <span #speedEl class="speed">0</span><label>km/h</label>
    </div>

    <!-- Minimap -->
    <canvas #minimapEl id="minimap" width="180" height="180"></canvas>

    <!-- Score + Combo (links oben) -->
    <div id="scoreHud">
      <div class="score">{{ weaponService.score$ | async }}</div>
      <div class="combo" [class.active]="(weaponService.combo$ | async)! >= 2">
        COMBO x{{ weaponService.combo$ | async }}
      </div>
    </div>

    <!-- Health-Leiste -->
    <div id="healthBar">
      ❤️ {{ playerService.health$ | async }}
      <span class="ammo">🔫 {{ weaponService.ammo$ | async }}</span>
      <span class="wave">🌊 W{{ enemyService.wave$ | async }}</span>
      <span class="enemies">👾 {{ enemyService.count$ | async }}</span>
    </div>

    <!-- Nachlade-Hinweis bei leerem Magazin -->
    <div id="reloadHint" *ngIf="(weaponService.ammo$ | async) === 0">[R] NACHLADEN</div>

    <!-- Wellen-Ansage ("WELLE 3") -->
    <div #waveBannerEl id="waveBanner"></div>

    <!-- Roter Rand-Flash bei erlittenem Schaden -->
    <div #damageFlashEl id="damageFlash"></div>

    <!-- Schwebende Punkte-Popups (+150 x3) -->
    <div #popupContainerEl id="popups"></div>

    <!-- Gegner-Upload (Bilder werden zu Gegnern) -->
    <div id="enemyPanel">
      <label for="enemyUpload">+ Gegner (Bild)</label>
      <input type="file" id="enemyUpload" multiple accept="image/*"
             (change)="onEnemyUpload($event)" />
    </div>

    <div class="game-container" #rendererContainer (click)="onStarted()">
      <div *ngIf="loading" class="overlay">Lade Assets...</div>
      <div *ngIf="!started && !gameOver" class="overlay">Klicken zum Starten</div>

      <div *ngIf="gameOver" class="overlay gameover">
        GAME OVER<br />
        <div class="finalScore">SCORE: {{ finalScore }}</div>
        <div class="record" *ngIf="newRecord">🏆 NEUER REKORD!</div>
        <div class="record" *ngIf="!newRecord">Rekord: {{ highscore }}</div>
        <button (click)="restart($event)">Neustart</button>
      </div>

      <div *ngIf="paused && !gameOver" class="overlay menu">
        PAUSE<br />
        <button (click)="resume($event)">Weiter</button>
        <button (click)="toggleMute($event)">{{ muted ? '🔇 Ton: AUS' : '🔊 Ton: AN' }}</button>
      </div>
    </div>
  `,
  styles: [`
    .game-container { width: 100vw; height: 100vh; overflow: hidden; position: relative; }
    .overlay {
      position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
      color: white; font-family: sans-serif; font-size: 2rem; background: rgba(0,0,0,0.5); padding: 20px;
      z-index: 20;
    }
    #scope {
      position: absolute; top: 0; left: 0; width: 100vw; height: 100vh;
      pointer-events: none; z-index: 10;
    }
    #weapon {
      position: absolute; bottom: -10vh; left: 50%;
      transform: translateX(calc(-50% + 350px)) rotateY(-15deg);
      height: 50vh; pointer-events: none; z-index: 5;
    }
    #broom {
      position: absolute; bottom: -15vh; left: 50%; transform: translateX(-50%);
      height: 60vh; pointer-events: none; z-index: 6;
    }
    #crosshair {
      position: absolute; top: 50%; left: 50%;
      width: 4px; height: 4px; border-radius: 50%;
      background: rgba(255, 255, 255, 0.8);
      transform: translate(-50%, -50%); pointer-events: none; z-index: 8;
    }
    #healthBar {
      position: absolute; top: 10px; right: 10px; z-index: 15;
      background: rgba(0,0,0,0.7); color: #fff; padding: 8px 12px;
      border-radius: 4px; font-family: 'Courier New', monospace; font-size: 16px;
      pointer-events: none;
    }
    #dashboard {
      display: none; position: absolute; bottom: 20px; left: 50%;
      transform: translateX(-50%); z-index: 15; pointer-events: none;
      background: rgba(0,0,0,0.6); color: #0ff; padding: 10px 20px;
      border-radius: 8px; font-family: 'Courier New', monospace; text-align: center;
      border: 1px solid rgba(0,255,255,0.4);
    }
    #dashboard .speed { font-size: 34px; font-weight: bold; display: block; line-height: 1; }
    #dashboard label { font-size: 12px; opacity: 0.8; }
    #minimap {
      position: absolute; bottom: 10px; left: 10px; z-index: 15;
      width: 180px; height: 180px; border-radius: 50%;
      background: rgba(0,0,0,0.55); border: 2px solid rgba(0,255,0,0.4);
      pointer-events: none;
    }
    #healthBar .enemies { margin-left: 12px; color: #ff6666; }
    #healthBar .ammo { margin-left: 12px; color: #ffcc66; }
    #healthBar .wave { margin-left: 12px; color: #66ccff; }
    #scoreHud {
      position: absolute; top: 10px; left: 10px; z-index: 15;
      font-family: 'Courier New', monospace; pointer-events: none;
    }
    #scoreHud .score {
      font-size: 34px; font-weight: bold; color: #fff;
      text-shadow: 0 0 10px #0ff;
    }
    #scoreHud .combo {
      font-size: 18px; font-weight: bold; color: #ffcc00;
      text-shadow: 0 0 8px #ff8800;
      opacity: 0; transition: opacity 0.15s;
    }
    #scoreHud .combo.active { opacity: 1; }
    #reloadHint {
      position: absolute; top: 58%; left: 50%; transform: translateX(-50%);
      color: #ff4444; font: bold 20px 'Courier New', monospace;
      z-index: 15; pointer-events: none;
      animation: blink 0.5s infinite alternate;
    }
    @keyframes blink { from { opacity: 1; } to { opacity: 0.2; } }
    #waveBanner {
      position: absolute; top: 30%; left: 50%; transform: translate(-50%, -50%);
      font: bold 56px 'Courier New', monospace; color: #0ff;
      text-shadow: 0 0 24px #0ff; letter-spacing: 8px;
      opacity: 0; pointer-events: none; z-index: 18; white-space: nowrap;
    }
    #waveBanner.show { animation: waveIn 2s ease-out; }
    @keyframes waveIn {
      0%   { opacity: 0; transform: translate(-50%, -50%) scale(2.2); }
      15%  { opacity: 1; transform: translate(-50%, -50%) scale(1); }
      75%  { opacity: 1; }
      100% { opacity: 0; }
    }
    #damageFlash {
      position: absolute; inset: 0; pointer-events: none; z-index: 17;
      background: radial-gradient(ellipse at center, transparent 40%, rgba(255,0,0,0.6) 100%);
      opacity: 0; transition: opacity 0.5s ease-out;
    }
    #popups { position: absolute; inset: 0; pointer-events: none; z-index: 16; overflow: hidden; }
    .scorePopup {
      position: absolute; font: bold 26px 'Courier New', monospace;
      text-shadow: 0 0 6px currentColor;
      animation: popupFloat 0.9s ease-out forwards;
    }
    @keyframes popupFloat {
      0%   { opacity: 1; transform: translateY(0) scale(1); }
      100% { opacity: 0; transform: translateY(-80px) scale(1.4); }
    }
    .shake { animation: shake 0.3s; }
    @keyframes shake {
      0%, 100% { transform: translate(0, 0); }
      20% { transform: translate(-8px, 4px); }
      40% { transform: translate(6px, -6px); }
      60% { transform: translate(-4px, 6px); }
      80% { transform: translate(4px, -4px); }
    }
    .gameover .finalScore {
      font-size: 1.6rem; margin-top: 12px; color: #fff;
      font-family: 'Courier New', monospace;
    }
    .gameover .record { font-size: 1.1rem; margin-top: 6px; color: #ffcc00; }
    #enemyPanel {
      position: absolute; bottom: 10px; right: 10px; z-index: 15;
    }
    #enemyPanel label {
      background: rgba(0,0,0,0.7); color: cyan; padding: 8px 12px;
      border-radius: 4px; font-family: sans-serif; font-size: 14px; cursor: pointer;
    }
    #enemyPanel input { display: none; }
    .gameover { color: #ff3333; text-align: center; }
    .gameover button {
      display: block; margin: 16px auto 0; padding: 10px 24px; font-size: 1.2rem;
      cursor: pointer;
    }
    .menu { text-align: center; }
    .menu button {
      display: block; margin: 12px auto 0; padding: 10px 24px; font-size: 1.1rem;
      cursor: pointer; min-width: 200px;
    }
  `]
})
export class GameComponent implements AfterViewInit, OnDestroy {
  @ViewChild('rendererContainer') rendererContainer!: ElementRef;
  @ViewChild('scopeEl') scopeEl!: ElementRef<HTMLImageElement>;
  @ViewChild('weaponEl') weaponEl!: ElementRef<HTMLImageElement>;
  @ViewChild('broomEl') broomEl!: ElementRef<HTMLImageElement>;
  @ViewChild('crosshairEl') crosshairEl!: ElementRef<HTMLDivElement>;
  @ViewChild('dashboardEl') dashboardEl!: ElementRef<HTMLDivElement>;
  @ViewChild('speedEl') speedEl!: ElementRef<HTMLSpanElement>;
  @ViewChild('minimapEl') minimapEl!: ElementRef<HTMLCanvasElement>;
  @ViewChild('waveBannerEl') waveBannerEl!: ElementRef<HTMLDivElement>;
  @ViewChild('damageFlashEl') damageFlashEl!: ElementRef<HTMLDivElement>;
  @ViewChild('popupContainerEl') popupContainerEl!: ElementRef<HTMLDivElement>;

  private renderer = new THREE.WebGLRenderer({ antialias: true });
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
  private composer!: EffectComposer;
  private animationId?: number;
  private subs: Subscription[] = [];

  public loading = true;
  public started = false;
  public gameOver = false;
  public paused = false;
  public muted = false;

  // Endstand für das Game-Over-Overlay (Highscore via localStorage).
  public finalScore = 0;
  public highscore = 0;
  public newRecord = false;
  private readonly highscoreKey = 'shooter.highscore';

  // Scope-Zustand (steuert Overlay, FOV und Waffen-Sichtbarkeit).
  public scoped = false;

  constructor(
    private gameEngine: GameEngineService,
    private levelService: LevelService,
    public weaponService: WeaponService,
    private weaponView: WeaponViewService,
    private particleService: ParticleService,
    private inputService: InputService,
    public enemyService: EnemyService,
    public playerService: PlayerService,
    private ngZone: NgZone
  ) {}

  private get showWeapon(): boolean {
    return !this.scoped && this.gameEngine.mode === 'ON_FOOT';
  }

  async ngAfterViewInit() {
    // 1. Renderer Setup
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    // PixelRatio auf max. 2 begrenzen: HiDPI (3x) würde 9x so viele Pixel rendern.
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    // Filmisches Tone-Mapping: weiche Lichter statt ausgebrannter Flächen.
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.rendererContainer.nativeElement.appendChild(this.renderer.domElement);

    // Post-Processing: Bloom lässt alles Emissive wirklich LEUCHTEN (Neon-Look).
    // MSAA (samples) + HalfFloat, damit Kantenglättung und HDR-Glow erhalten bleiben.
    const bufferSize = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const renderTarget = new THREE.WebGLRenderTarget(bufferSize.width, bufferSize.height, {
      samples: 4,
      type: THREE.HalfFloatType,
    });
    this.composer = new EffectComposer(this.renderer, renderTarget);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.composer.addPass(new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      0.85, // Stärke
      0.45, // Radius
      0.5   // Schwelle: nur helle/emissive Flächen glühen
    ));
    this.composer.addPass(new OutputPass());

    // Dezente Umgebungs-Reflexionen (Auto-Lack, Pfützen, Gegner-Kristalle).
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.2;
    pmrem.dispose();

    // 2. Szene & Audio Setup — Start zu Fuß auf Augenhöhe.
    this.camera.position.set(0, 1.6, 20);
    this.camera.lookAt(0, 1.6, 0);
    // Kamera in die Szene: nötig, damit Kamera-Kinder (Audio-Listener) aktiv sind.
    this.scene.add(this.camera);
    this.gameEngine.init(this.camera, this.renderer.domElement);
    this.levelService.createEnvironment(this.scene);
    this.particleService.init(this.scene);
    this.enemyService.init(this.scene);

    this.wireWeaponEvents();

    // Game Over: Endstand + Highscore ermitteln, Maus freigeben, Overlay zeigen.
    this.subs.push(this.playerService.dead$.subscribe(() => {
      this.ngZone.run(() => {
        this.finalScore = this.weaponService.score;
        const best = Number(localStorage.getItem(this.highscoreKey) ?? '0');
        this.newRecord = this.finalScore > best;
        if (this.newRecord) localStorage.setItem(this.highscoreKey, String(this.finalScore));
        this.highscore = Math.max(best, this.finalScore);
        this.gameOver = true;
      });
      this.gameEngine.unlockControls();
    }));

    // Pause-Menü: Maus-Lock verloren (Esc) -> Menü zeigen, sofern nicht Game Over.
    this.subs.push(this.gameEngine.locked$.subscribe(locked => {
      this.ngZone.run(() => {
        this.paused = !locked && this.started && !this.gameOver;
      });
    }));

    // 3. Render-Loop sofort starten, damit man die Welt sieht
    this.ngZone.runOutsideAngular(() => {
      this.animate();
    });

    // 4. Assets laden
    try {
      await Promise.all([
        this.gameEngine.loadGameAssets(),
        this.gameEngine.loadCarModel(this.scene),
        this.weaponView.init(this.weaponEl.nativeElement)
      ]);
    } catch (err) {
      console.error("Fehler beim Laden der Assets", err);
    } finally {
      this.loading = false;
    }

    window.addEventListener('resize', this.onWindowResize.bind(this));
    (window as any).__scene = this.scene; // TEMP-DIAGNOSE: wieder entfernen
    (window as any).__camera = this.camera; // TEMP-DIAGNOSE: wieder entfernen
  }

  /** Verbindet alle Waffen-/Kampf-Events mit der Darstellung. */
  private wireWeaponEvents(): void {
    // Treffer -> Partikel-Explosion; Gegner Schaden zufügen oder Level-Ziel entfernen.
    this.subs.push(this.weaponService.hit$.subscribe(({ point, object, color }) => {
      this.particleService.createExplosion(point, color);

      // War es ein Gegner? Dann übernimmt der EnemyService (HP, Kill-Events).
      if (this.enemyService.hitEnemy(object) !== 'none') return;

      // Sonst: rotes Test-Ziel aus dem Level entfernen.
      const target = object.name === 'target' ? object : object.parent;
      target?.removeFromParent();
    }));

    // Kampf-Ereignisse: Kill (Combo-Punkte + Popup), Treffer, Kamikaze-Explosion.
    this.subs.push(this.enemyService.events$.subscribe(ev => {
      if (ev.type === 'killed') {
        this.particleService.createExplosion(ev.position, ev.color);
        this.gameEngine.playSound('kill', 0.6);
        const { points, multiplier } = this.weaponService.registerKill(ev.points);
        this.showScorePopup(points, multiplier);
      } else if (ev.type === 'exploded') {
        this.particleService.createExplosion(ev.position, ev.color);
        this.particleService.createExplosion(ev.position, new THREE.Color(0xffff00));
        this.gameEngine.playSound('explode', 0.8);
      } else {
        this.gameEngine.playSound('hit', 0.5);
      }
    }));

    // Neue Welle -> großes Banner in der Bildschirmmitte.
    this.subs.push(this.enemyService.wave$.subscribe(wave => {
      if (wave > 0) this.showWaveBanner(wave);
    }));

    // Erlittener Schaden -> roter Rand-Flash + Screenshake.
    this.subs.push(this.playerService.damaged$.subscribe(() => this.playDamageFeedback()));

    // Schuss -> Sprite-Animation (s3-s5) + Rückstoß an der Waffe.
    this.subs.push(this.weaponService.fired$.subscribe(() => {
      this.weaponView.triggerShot();
    }));

    // Ring durchflogen -> Bonus-Punkte.
    this.subs.push(this.gameEngine.ringPassed$.subscribe(() => {
      this.weaponService.addScore(500);
    }));

    // Scope-State -> HUD (direktes DOM) + Kamera-FOV.
    this.subs.push(this.weaponService.isScoped$.subscribe(scoped => {
      this.scoped = scoped;
      this.scopeEl.nativeElement.style.display = scoped ? 'block' : 'none';
      this.crosshairEl.nativeElement.style.display = scoped ? 'none' : 'block';
      this.camera.fov = scoped ? 20 : 75;
      this.camera.updateProjectionMatrix();
    }));
    // Nachladen -> Waffe absenken (Animation läuft im WeaponViewService).
    this.subs.push(this.weaponService.isReloading$.subscribe(r => this.weaponView.setReloading(r)));

    // Eingabe-Events aus dem InputService.
    this.subs.push(this.inputService.reload$.subscribe(() => {
      if (this.gameEngine.isLocked() && this.gameEngine.mode === 'ON_FOOT') {
        this.weaponService.reload();
      }
    }));
    this.subs.push(this.inputService.scopeToggle$.subscribe(() => {
      if (this.gameEngine.isLocked() && this.gameEngine.mode === 'ON_FOOT') {
        this.weaponService.toggleScope();
      }
    }));
    // Mausrad: im Flug -> Schraube/Rolle, sonst zu Fuß -> Zoom.
    this.subs.push(this.inputService.wheel$.subscribe(deltaY => {
      if (this.gameEngine.mode === 'FLYING') {
        this.gameEngine.addBroomRoll(deltaY);
      } else if (this.gameEngine.mode === 'ON_FOOT' && !this.scoped) {
        this.camera.fov = THREE.MathUtils.clamp(this.camera.fov + deltaY * 0.05, 30, 100);
        this.camera.updateProjectionMatrix();
      }
    }));
  }

  public onStarted() {
    this.started = true;
    this.gameEngine.lockControls();
    this.gameEngine.resumeAudioContext();
    this.gameEngine.startBackgroundMusic();
    this.enemyService.startWaves(); // idempotent — startet nur beim ersten Mal
  }

  @HostListener('mousedown', ['$event'])
  onMouseDown(event: MouseEvent) {
    // Nur schießen, wenn Steuerung aktiv ist und man nicht im Auto sitzt.
    if (this.gameEngine.isLocked() && event.button === 0 && this.gameEngine.mode !== 'IN_CAR') {
      this.weaponService.shoot(this.camera, this.targets());
    }
  }

  /** Kombinierte Trefferliste: Level-Ziele + aktuelle Gegner. */
  private targets(): THREE.Object3D[] {
    return [...this.levelService.getTargets(), ...this.enemyService.getEnemies()];
  }

  /** Datei-Upload: jedes Bild wird zu einem Gegner. */
  onEnemyUpload(event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = input.files;
    if (!files?.length) return;
    for (let i = 0; i < files.length; i++) {
      this.enemyService.spawnFromFile(files[i]);
    }
    input.value = ''; // Reset, damit dieselbe Datei erneut geladen werden kann
  }

  /** Nach Game Over neu starten: frischer Run ab Welle 1 mit Score 0. */
  restart(event: MouseEvent): void {
    event.stopPropagation(); // nicht gleichzeitig onStarted() vom Container triggern
    this.playerService.reset();
    this.weaponService.resetRun();
    this.enemyService.reset();
    this.enemyService.startWaves();
    this.gameOver = false;
    this.camera.position.set(0, 1.6, 20);
    this.gameEngine.resetToFoot();
    this.gameEngine.lockControls();
  }

  /** Aus dem Pause-Menü fortsetzen. */
  resume(event: MouseEvent): void {
    event.stopPropagation();
    this.gameEngine.lockControls();
  }

  /** Ton an/aus (Master-Volume). */
  toggleMute(event: MouseEvent): void {
    event.stopPropagation();
    this.muted = !this.muted;
    this.gameEngine.setGlobalVolume(this.muted ? 0 : 1);
  }

  /**
   * Schwebendes Punkte-Popup nahe der Bildschirmmitte. Direktes DOM
   * (außerhalb der Angular-Zone), CSS-Animation räumt sich selbst auf.
   */
  private showScorePopup(points: number, multiplier: number): void {
    const el = document.createElement('div');
    el.className = 'scorePopup';
    el.textContent = multiplier >= 2 ? `+${points} x${multiplier}` : `+${points}`;
    // Farbe eskaliert mit dem Multiplikator: weiß -> gelb -> orange -> rot.
    const colors = ['#ffffff', '#ffff66', '#ffcc00', '#ff8800', '#ff4444'];
    el.style.color = colors[Math.min(multiplier - 1, colors.length - 1)];
    el.style.left = `calc(50% + ${Math.round(Math.random() * 120 - 60)}px)`;
    el.style.top = `calc(50% - ${Math.round(40 + Math.random() * 40)}px)`;
    this.popupContainerEl.nativeElement.appendChild(el);
    setTimeout(() => el.remove(), 900);
  }

  /** Wellen-Banner einblenden (CSS-Animation per Klassen-Retrigger). */
  private showWaveBanner(wave: number): void {
    const el = this.waveBannerEl.nativeElement;
    el.textContent = `WELLE ${wave}`;
    el.classList.remove('show');
    void el.offsetWidth; // Reflow erzwingen, damit die Animation neu startet
    el.classList.add('show');
  }

  /** Roter Rand-Flash + kurzer Screenshake bei erlittenem Schaden. */
  private playDamageFeedback(): void {
    const flash = this.damageFlashEl.nativeElement;
    flash.style.transition = 'none';
    flash.style.opacity = '0.85';
    requestAnimationFrame(() => {
      flash.style.transition = 'opacity 0.5s ease-out';
      flash.style.opacity = '0';
    });

    const container = this.rendererContainer.nativeElement as HTMLElement;
    container.classList.remove('shake');
    void container.offsetWidth;
    container.classList.add('shake');
  }

  private animate() {
    this.animationId = requestAnimationFrame(() => this.animate());

    this.gameEngine.updateGame();
    this.weaponView.update({
      visible: this.showWeapon,
      moving: this.inputService.moveForward || this.inputService.moveBackward ||
              this.inputService.moveLeft || this.inputService.moveRight,
      sprinting: this.inputService.moveSprint,
    });
    this.updateBroomVisibility();
    this.updateCrosshairColor();
    this.updateDashboard();
    this.updateMinimap();

    this.composer.render();
  }

  /** Besen-Bild nur im Flug-Modus einblenden, direkt am DOM. */
  private updateBroomVisibility(): void {
    const el = this.broomEl.nativeElement;
    const visible = this.gameEngine.mode === 'FLYING' ? 'block' : 'none';
    if (el.style.display !== visible) el.style.display = visible;
  }

  /**
   * Minimap zeichnen (portiert aus main.js): Spieler fest in der Mitte, Welt rotiert
   * mit der Blickrichtung. Gebäude grau, Auto rot, Spieler als grünes Dreieck.
   */
  private minimapFrame = 0;
  private updateMinimap(): void {
    if (++this.minimapFrame % 2 !== 0) return; // ~30 Hz reicht

    const canvas = this.minimapEl.nativeElement;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const size = canvas.width;      // 180
    const center = size / 2;
    const scale = 0.7;              // Weltmeter -> Pixel

    // Spielerposition + Blickrichtung.
    const pos = this.gameEngine.mode === 'IN_CAR' && this.gameEngine.car
      ? this.gameEngine.car.mesh.position
      : this.camera.position;
    const yaw = this.camera.rotation.y;

    ctx.clearRect(0, 0, size, size);
    ctx.save();
    ctx.translate(center, center);
    ctx.rotate(yaw);
    ctx.scale(scale, scale);
    ctx.translate(-pos.x, -pos.z);

    // Gebäude (nur Box-Ziele).
    ctx.fillStyle = 'rgba(150,150,150,0.7)';
    for (const obj of this.levelService.getTargets()) {
      const geo: any = (obj as THREE.Mesh).geometry;
      if (geo?.type === 'BoxGeometry') {
        const w = geo.parameters.width;
        const d = geo.parameters.depth;
        ctx.fillRect(obj.position.x - w / 2, obj.position.z - d / 2, w, d);
      }
    }

    // Auto (rot).
    if (this.gameEngine.car) {
      ctx.fillStyle = 'red';
      ctx.fillRect(this.gameEngine.car.mesh.position.x - 3, this.gameEngine.car.mesh.position.z - 3, 6, 6);
    }

    // Gegner (leuchtend rote Punkte) — man sieht, aus welcher Richtung sie kommen.
    ctx.fillStyle = '#ff3344';
    for (const enemy of this.enemyService.getEnemies()) {
      ctx.fillRect(enemy.position.x - 2, enemy.position.z - 2, 4, 4);
    }
    ctx.restore();

    // Spieler: grünes Dreieck, fest im Zentrum, zeigt nach oben.
    ctx.fillStyle = '#00ff00';
    ctx.beginPath();
    ctx.moveTo(center, center - 8);
    ctx.lineTo(center + 6, center + 6);
    ctx.lineTo(center - 6, center + 6);
    ctx.fill();
  }

  /** Auto-Tacho aktualisieren (nur im Auto sichtbar), direkt am DOM. */
  private updateDashboard(): void {
    const dash = this.dashboardEl.nativeElement;
    const inCar = this.gameEngine.mode === 'IN_CAR';
    const visible = inCar ? 'block' : 'none';
    if (dash.style.display !== visible) dash.style.display = visible;

    if (inCar && this.gameEngine.car) {
      const kmh = Math.abs(Math.round(this.gameEngine.car.getSpeed() * 3.6));
      this.speedEl.nativeElement.textContent = String(kmh);
    }
  }

  /**
   * Fadenkreuz rot färben, wenn ein Ziel anvisiert wird.
   * Gedrosselt auf ~10 Hz — der Raycast über alle Ziele ist zu teuer für jeden Frame.
   */
  private lastCrosshairCheck = 0;
  private updateCrosshairColor(): void {
    const el = this.crosshairEl.nativeElement;

    // Sichtbarkeit: nur zu Fuß und ohne Scope.
    const visible = !this.scoped && this.gameEngine.mode !== 'IN_CAR' ? 'block' : 'none';
    if (el.style.display !== visible) el.style.display = visible;
    if (visible === 'none') return;

    const now = performance.now();
    if (now - this.lastCrosshairCheck < 100) return;
    this.lastCrosshairCheck = now;

    const hit = this.weaponService.isTargetInSight(this.camera, this.targets());
    el.style.backgroundColor = hit ? 'red' : 'rgba(255, 255, 255, 0.8)';
  }

  private onWindowResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.composer.setSize(window.innerWidth, window.innerHeight);
  }

  ngOnDestroy() {
    if (this.animationId) cancelAnimationFrame(this.animationId);
    this.subs.forEach(s => s.unsubscribe());
    this.composer.dispose();
    this.renderer.dispose();
  }
}
