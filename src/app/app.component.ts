import { Component } from '@angular/core';
import { GameComponent } from './services/game.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [GameComponent],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class AppComponent {
  title = '3d-shooter';
}