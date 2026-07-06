import { Injectable } from '@angular/core';
import * as THREE from 'three';
import { BehaviorSubject, Observable, Subject } from 'rxjs';
import { GameEngineService } from './game-engine.service';

@Injectable({
  providedIn: 'root'
})
export class WeaponService {
  private readonly maxAmmo = 30;
  private ammoSubject = new BehaviorSubject<number>(this.maxAmmo);
  private reloadingSubject = new BehaviorSubject<boolean>(false);
  private scoreSubject = new BehaviorSubject<number>(0);
  private scopedSubject = new BehaviorSubject<boolean>(false);
  private hitSubject = new Subject<{ point: THREE.Vector3; object: THREE.Object3D; color: THREE.Color }>();
  private firedSubject = new Subject<void>();

  // --- Combo-System: Kills kurz hintereinander erhöhen den Punkte-Multiplikator ---
  private readonly comboWindowMs = 2500;
  private readonly maxMultiplier = 10;
  private comboSubject = new BehaviorSubject<number>(0);
  private comboCount = 0;
  private lastKillTime = 0;
  private comboResetTimer?: ReturnType<typeof setTimeout>;

  public ammo$: Observable<number> = this.ammoSubject.asObservable();
  public isReloading$: Observable<boolean> = this.reloadingSubject.asObservable();
  public score$: Observable<number> = this.scoreSubject.asObservable();
  public isScoped$: Observable<boolean> = this.scopedSubject.asObservable();
  /** Aktueller Combo-Multiplikator (0 = keine Combo aktiv). */
  public combo$: Observable<number> = this.comboSubject.asObservable();
  /** Treffer inkl. Trefferpunkt und Farbe des getroffenen Objekts (für Partikel). */
  public hit$: Observable<{ point: THREE.Vector3; object: THREE.Object3D; color: THREE.Color }> = this.hitSubject.asObservable();
  /** Ein Schuss wurde abgefeuert (für die Waffen-Sprite-Animation). */
  public fired$: Observable<void> = this.firedSubject.asObservable();

  private raycaster = new THREE.Raycaster();

  constructor(private gameEngine: GameEngineService) {}

  public get isScoped(): boolean {
    return this.scopedSubject.value;
  }

  public get score(): number {
    return this.scoreSubject.value;
  }

  /** Punkte hinzufügen (z.B. Ring-Durchflug). */
  public addScore(points: number): void {
    this.scoreSubject.next(this.scoreSubject.value + points);
  }

  /**
   * Registriert einen Kill: Kills innerhalb des Combo-Fensters erhöhen den
   * Multiplikator (x1 … x10). Gibt die tatsächlich gutgeschriebenen Punkte zurück.
   */
  public registerKill(basePoints: number): { points: number; multiplier: number } {
    const now = performance.now();
    this.comboCount = now - this.lastKillTime < this.comboWindowMs ? this.comboCount + 1 : 1;
    this.lastKillTime = now;

    const multiplier = Math.min(this.comboCount, this.maxMultiplier);
    const points = basePoints * multiplier;
    this.addScore(points);
    this.comboSubject.next(multiplier);

    // Combo läuft ab, wenn kein weiterer Kill im Zeitfenster folgt.
    clearTimeout(this.comboResetTimer);
    this.comboResetTimer = setTimeout(() => this.comboSubject.next(0), this.comboWindowMs);

    return { points, multiplier };
  }

  /** Setzt Score + Combo für einen neuen Run zurück (nach Game Over). */
  public resetRun(): void {
    this.scoreSubject.next(0);
    this.comboCount = 0;
    this.lastKillTime = 0;
    clearTimeout(this.comboResetTimer);
    this.comboSubject.next(0);
  }

  public toggleScope(): void {
    this.scopedSubject.next(!this.scopedSubject.value);
  }

  /**
   * Führt die Schuss-Logik aus der alten main.js aus.
   * @param camera Aktuelle Kamera für den Raycast
   * @param targets Liste der treffbaren Objekte (Enemies, Hindernisse)
   */
  public shoot(camera: THREE.Camera, targets: THREE.Object3D[]): void {
    if (this.reloadingSubject.value || this.ammoSubject.value <= 0) {
      return;
    }

    // Munition abziehen und Sound abspielen
    this.ammoSubject.next(this.ammoSubject.value - 1);
    this.gameEngine.playSound('shoot');
    this.firedSubject.next(); // Sprite-Animation triggern

    // Ray genau durch die Bildschirmmitte (dort sitzt das Fadenkreuz).
    this.raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
    const intersects = this.raycaster.intersectObjects(targets, true);

    if (intersects.length > 0) {
      const hit = intersects[0];
      this.scoreSubject.next(this.scoreSubject.value + 10);

      // Farbe des getroffenen Objekts für die Partikel-Explosion ermitteln.
      const mat = (hit.object as THREE.Mesh).material as THREE.MeshStandardMaterial;
      const color = mat?.color ? mat.color.clone() : new THREE.Color(0xffaa00);

      this.hitSubject.next({ point: hit.point, object: hit.object, color });
    }
  }

  /**
   * Prüft (ohne zu schießen), ob das Fadenkreuz gerade ein Ziel trifft.
   * Genutzt für die rote Fadenkreuz-Färbung.
   */
  public isTargetInSight(camera: THREE.Camera, targets: THREE.Object3D[]): boolean {
    this.raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
    return this.raycaster.intersectObjects(targets, true).length > 0;
  }

  /**
   * Startet den Nachladevorgang mit der 1.5s Verzögerung aus der main.js.
   */
  public reload(): void {
    if (this.reloadingSubject.value || this.ammoSubject.value === this.maxAmmo) {
      return;
    }

    this.reloadingSubject.next(true);
    this.gameEngine.playSound('reload');

    setTimeout(() => {
      this.ammoSubject.next(this.maxAmmo);
      this.reloadingSubject.next(false);
    }, 1500);
  }
}