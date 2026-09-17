import { Injectable } from '@angular/core';

/**
 * First-Person-Waffe als 2D-Sprite (wie im alten Spiel):
 * s2.png = Ruhebild, s3–s5.png = Schuss-Animation mit gebackenem Mündungsfeuer.
 * Waffen-Bob, Rückstoß und Nachlade-Absenkung laufen als CSS-Transform
 * direkt auf dem <img>-Element.
 */
@Injectable({
  providedIn: 'root'
})
export class WeaponViewService {
  private el?: HTMLImageElement;
  private lastTime = 0;

  private recoil = 0;      // 1 direkt nach dem Schuss, federt auf 0 zurück
  private reloadAnim = 0;  // 0 = normal, 1 = ganz abgesenkt (Nachladen)
  private reloading = false;
  private bobTime = 0;
  private shotTimers: ReturnType<typeof setTimeout>[] = [];

  private readonly idleFrame = 'assets/img/sniper/s2.png';
  private readonly shotFrames = [
    'assets/img/sniper/s3.png',
    'assets/img/sniper/s4.png',
    'assets/img/sniper/s5.png',
  ];
  private readonly frameMs = 70; // Abstand zwischen den Schuss-Frames

  /** Merkt sich das Waffen-Bild und lädt alle Frames vor (kein Flackern beim ersten Schuss). */
  public async init(el: HTMLImageElement): Promise<void> {
    this.el = el;
    el.src = this.idleFrame;

    await Promise.all([this.idleFrame, ...this.shotFrames].map(src =>
      new Promise<void>(resolve => {
        const img = new Image();
        img.onload = () => resolve();
        img.onerror = () => resolve();
        img.src = src;
      })
    ));
  }

  /**
   * Pro Frame aufrufen: Sichtbarkeit, Bob, Rückstoß-Feder und Reload-Absenkung.
   */
  public update(state: { visible: boolean; moving: boolean; sprinting: boolean }): void {
    const el = this.el;
    if (!el) return;

    const now = performance.now();
    const delta = Math.min((now - this.lastTime) / 1000, 0.1);
    this.lastTime = now;

    const display = state.visible ? 'block' : 'none';
    if (el.style.display !== display) el.style.display = display;
    if (!state.visible) return;

    // Rückstoß federt zurück, Reload-Absenkung lerpt Richtung Ziel.
    this.recoil = Math.max(0, this.recoil - delta * 6);
    const reloadTarget = this.reloading ? 1 : 0;
    this.reloadAnim += (reloadTarget - this.reloadAnim) * Math.min(1, delta * 7);

    // Waffen-Bob nur bei Bewegung (Sprint = schneller + tiefer getragen).
    if (state.moving) this.bobTime += delta * (state.sprinting ? 11 : 6);
    const bobX = Math.sin(this.bobTime) * 12;
    const bobY = Math.abs(Math.cos(this.bobTime)) * 16;
    const sprintDrop = state.sprinting && state.moving ? 60 : 0;

    const offsetX = bobX;
    const offsetY = bobY + sprintDrop + this.recoil * 26 + this.reloadAnim * 320;
    el.style.transform =
      `translateX(calc(-50% + 350px)) translate(${offsetX}px, ${offsetY}px) ` +
      `rotateY(-15deg) rotate(${this.reloadAnim * 14}deg)`;
  }

  /** Schuss: Rückstoß anstoßen + Sprite-Animation s3 -> s4 -> s5 -> zurück zu s2. */
  public triggerShot(): void {
    this.recoil = 1;

    const el = this.el;
    if (!el) return;

    // Laufende Animation abbrechen, damit schnelle Schüsse sauber neu starten.
    this.shotTimers.forEach(t => clearTimeout(t));
    this.shotTimers = [];

    el.src = this.shotFrames[0];
    for (let i = 1; i < this.shotFrames.length; i++) {
      this.shotTimers.push(setTimeout(() => { el.src = this.shotFrames[i]; }, i * this.frameMs));
    }
    this.shotTimers.push(setTimeout(() => { el.src = this.idleFrame; }, this.shotFrames.length * this.frameMs));
  }

  public setReloading(reloading: boolean): void {
    this.reloading = reloading;
  }
}
