import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, Subject } from 'rxjs';

/**
 * Spieler-Zustand: Leben, Tod/Game-Over. Portiert aus playerHealth-Logik der alten main.js.
 */
@Injectable({
  providedIn: 'root'
})
export class PlayerService {
  private readonly maxHealth = 100;
  private healthSubject = new BehaviorSubject<number>(this.maxHealth);
  private deadSubject = new Subject<void>();
  private damagedSubject = new Subject<number>();

  public health$: Observable<number> = this.healthSubject.asObservable();
  /** Feuert einmalig, wenn das Leben auf 0 fällt (Game Over). */
  public dead$: Observable<void> = this.deadSubject.asObservable();
  /** Feuert bei jedem erlittenen Treffer (für Schadens-Flash + Screenshake). */
  public damaged$: Observable<number> = this.damagedSubject.asObservable();

  public get health(): number {
    return this.healthSubject.value;
  }

  public get isDead(): boolean {
    return this.healthSubject.value <= 0;
  }

  /** Schaden zufügen; löst bei <= 0 einmalig Game Over aus. */
  public takeDamage(amount: number): void {
    if (this.isDead) return;
    const next = Math.max(0, this.healthSubject.value - amount);
    this.healthSubject.next(next);
    this.damagedSubject.next(amount);
    if (next <= 0) {
      this.deadSubject.next();
    }
  }

  /** Heilen bis maximal maxHealth. */
  public heal(amount: number): void {
    if (this.isDead) return;
    this.healthSubject.next(Math.min(this.maxHealth, this.healthSubject.value + amount));
  }

  /** Nach Game Over zurücksetzen. */
  public reset(): void {
    this.healthSubject.next(this.maxHealth);
  }

  /**
   * Setzt das Leben direkt (Multiplayer: der Server ist die Wahrheit).
   * Loest bewusst KEIN dead$ aus — Tod/Respawn steuert dort der Server.
   */
  public setHealth(value: number): void {
    this.healthSubject.next(Math.max(0, Math.min(this.maxHealth, value)));
  }
}
