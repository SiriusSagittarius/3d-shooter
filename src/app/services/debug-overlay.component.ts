import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { GameEngineService } from './game-engine.service';
import { WeaponService } from './weapon.service';

@Component({
  selector: 'app-debug-overlay',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="debug-panel">
      <div>FPS: <span [style.color]="fpsColor">{{ gameEngine.fps }}</span></div>
      <div>Modus: {{ gameEngine.mode }}</div>
      <div>Ammo: {{ weaponService.ammo$ | async }}<span *ngIf="weaponService.isReloading$ | async"> (lädt…)</span></div>
      <div>Score: {{ weaponService.score$ | async }}</div>
      <div *ngIf="gameEngine.car">
        Pos: 
        X: {{ gameEngine.car.mesh.position.x | number:'1.1-1' }} 
        Y: {{ gameEngine.car.mesh.position.y | number:'1.1-1' }} 
        Z: {{ gameEngine.car.mesh.position.z | number:'1.1-1' }}
      </div>
    </div>
  `,
  styles: [`
    .debug-panel {
      position: absolute;
      top: 10px;
      left: 10px;
      padding: 10px;
      background: rgba(0, 0, 0, 0.7);
      color: #00ff00;
      font-family: 'Courier New', Courier, monospace;
      font-size: 12px;
      border-radius: 4px;
      pointer-events: none;
      z-index: 1000;
      min-width: 150px;
    }
  `]
})
export class DebugOverlayComponent {
  constructor(
    public gameEngine: GameEngineService,
    public weaponService: WeaponService
  ) {}

  get fpsColor(): string {
    if (this.gameEngine.fps > 55) return '#00ff00';
    if (this.gameEngine.fps > 30) return '#ffff00';
    return '#ff0000';
  }
}