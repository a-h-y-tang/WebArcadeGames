import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Game } from '../../models/game';

@Component({
  selector: 'app-game-card',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div
      class="bg-white rounded-lg shadow-md hover:shadow-xl transition duration-300 overflow-hidden cursor-pointer transform hover:scale-105"
      (click)="openGame()"
    >
      <div class="relative h-48 bg-gray-200 overflow-hidden">
        <img
          [src]="game.thumbnail"
          [alt]="game.name"
          loading="lazy"
          class="w-full h-full object-cover"
          (error)="onImageError($event)"
        />
      </div>
      <div class="p-4">
        <h3 class="text-lg font-bold text-gray-800 mb-1">{{ game.name }}</h3>
        <p class="text-sm text-gray-600 mb-3 line-clamp-2">{{ game.description }}</p>
        <div class="flex justify-between items-center">
          <span class="inline-block px-3 py-1 bg-primary-100 text-primary-700 text-xs font-semibold rounded-full">
            {{ game.category }}
          </span>
          <button
            class="px-4 py-2 bg-accent-500 hover:bg-accent-600 text-white font-semibold rounded-lg transition"
          >
            Play
          </button>
        </div>
      </div>
    </div>
  `,
  styles: [],
})
export class GameCardComponent {
  @Input() game!: Game;

  openGame(): void {
    window.location.href = this.game.path;
  }

  onImageError(event: any): void {
    event.target.src = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="300" height="200"%3E%3Crect fill="%23e5e7eb" width="300" height="200"/%3E%3Ctext x="50%25" y="50%25" text-anchor="middle" dy=".3em" fill="%23999" font-size="18"%3ENo Image%3C/text%3E%3C/svg%3E';
  }
}
