import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClientModule } from '@angular/common/http';
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
    HttpClientModule,
    HeaderComponent,
    SearchComponent,
    FilterComponent,
    GameGridComponent,
  ],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App implements OnInit {
  games: Game[] = [];
  filteredGames: Game[] = [];
  categories: string[] = [];
  searchQuery = '';
  selectedCategory = '';

  constructor(private gameService: GameService) {}

  ngOnInit(): void {
    this.gameService.games$.subscribe((games) => {
      this.games = games;
      this.categories = this.gameService.getAllCategories();
      this.updateFiltered();
    });
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
