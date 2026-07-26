import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HeaderComponent } from './components/header/header.component';
import { SearchComponent } from './components/search/search.component';
import { FilterComponent } from './components/filter/filter.component';
import { GameGridComponent } from './components/game-grid/game-grid.component';
import { GameService } from './services/game.service';
import { Game } from './models/game';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    CommonModule,
    HeaderComponent,
    SearchComponent,
    FilterComponent,
    GameGridComponent,
  ],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  games: readonly Game[];
  filteredGames: Game[] = [];
  categories: string[] = [];
  searchQuery = '';
  selectedCategory = '';

  constructor(private gameService: GameService) {
    this.games = this.gameService.getGames();
    this.categories = this.gameService.getAllCategories();
    this.filteredGames = this.gameService.searchGames('', '');
  }

  onSearchChange(query: string): void {
    this.searchQuery = query;
    this.updateFiltered();
  }

  onCategoryChange(category: string): void {
    this.selectedCategory = category;
    this.updateFiltered();
  }

  private updateFiltered(): void {
    this.filteredGames = this.gameService.searchGames(
      this.searchQuery,
      this.selectedCategory
    );
  }
}
