import { Injectable } from '@angular/core';
import { Subject, Observable } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class InputService {
  private keys: { [key: string]: boolean } = {};
  private mouseLeftDown = false;

  // Flanken-basierte Aktionen (einmal pro Klick), als Streams.
  private reloadSubject = new Subject<void>();
  private scopeToggleSubject = new Subject<void>();
  private wheelSubject = new Subject<number>();

  /** Rechtsklick oder Taste R -> Nachladen. */
  public reload$: Observable<void> = this.reloadSubject.asObservable();
  /** Mausrad-Klick (mittlere Taste) -> Scope/Zoom umschalten. */
  public scopeToggle$: Observable<void> = this.scopeToggleSubject.asObservable();
  /** Mausrad-Drehung (deltaY) -> Zoom bzw. Besen-Rolle. */
  public wheel$: Observable<number> = this.wheelSubject.asObservable();

  constructor() {
    window.addEventListener('keydown', (e) => {
      this.keys[e.code] = true;
      if (e.code === 'KeyR') this.reloadSubject.next();
    });
    window.addEventListener('keyup', (e) => this.keys[e.code] = false);

    window.addEventListener('mousedown', (e) => {
      if (e.button === 0) this.mouseLeftDown = true;
      if (e.button === 1) { e.preventDefault(); this.scopeToggleSubject.next(); } // Mausrad-Klick
      if (e.button === 2) this.reloadSubject.next(); // Rechtsklick
    });
    window.addEventListener('mouseup', (e) => { if (e.button === 0) this.mouseLeftDown = false; });

    // Rechtsklick-Menü unterdrücken (sonst poppt das Kontextmenü beim Nachladen auf).
    window.addEventListener('contextmenu', (e) => e.preventDefault());

    window.addEventListener('wheel', (e) => this.wheelSubject.next(e.deltaY));
  }

  public isKeyDown(code: string): boolean {
    return !!this.keys[code];
  }

  // --- Laufen (WASD) ---
  get moveForward() { return this.isKeyDown('KeyW'); }
  get moveBackward() { return this.isKeyDown('KeyS'); }
  get moveLeft() { return this.isKeyDown('KeyA'); }
  get moveRight() { return this.isKeyDown('KeyD'); }
  get moveSprint() { return this.isKeyDown('KeyQ'); }
  get moveCrouch() { return this.isKeyDown('KeyC'); }
  get jump() { return this.isKeyDown('Space'); }

  // --- Fahren (Pfeiltasten) ---
  get driveForward() { return this.isKeyDown('ArrowUp'); }
  get driveBackward() { return this.isKeyDown('ArrowDown'); }
  get steerLeft() { return this.isKeyDown('ArrowLeft'); }
  get steerRight() { return this.isKeyDown('ArrowRight'); }

  get broom() { return this.isKeyDown('KeyB'); }
  get enterCar() { return this.isKeyDown('KeyF'); }
  get isAccelerating() { return this.mouseLeftDown; }
}
