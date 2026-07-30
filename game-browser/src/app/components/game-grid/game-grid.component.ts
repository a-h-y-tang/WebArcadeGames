import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Game } from '../../models/game';
import { GameCardComponent } from '../game-card/game-card.component';

@Component({
  selector: 'app-game-grid',
  standalone: true,
  imports: [CommonModule, GameCardComponent],
  template: `
    <div class="min-h-screen">
      <div
        *ngIf="games.length === 0"
        class="text-center py-12"
      >
        <p class="text-xl text-gray-600">No games found. Try adjusting your search.</p>
      </div>

      <div
        *ngIf="games.length > 0"
        class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6"
      >
        <app-game-card *ngFor="let game of games" [game]="game"></app-game-card>
      </div>
    </div>
  `,
  styles: [],
})
export class GameGridComponent {
  @Input() games: Game[] = [];
}
