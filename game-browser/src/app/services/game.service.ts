import { Injectable } from '@angular/core';
import gamesData from '../../assets/games.json';
import { Game } from '../models/game';

const CATEGORY_ORDER = [
  'Action',
  'Puzzle',
  'Strategy',
  'Board Game',
  'Card Game',
  'Sports',
];

@Injectable({ providedIn: 'root' })
export class GameService {
  private readonly games: readonly Game[] = gamesData as Game[];

  getGames(): readonly Game[] {
    return this.games;
  }

  getAllCategories(): string[] {
    const present = new Set(this.games.map((game) => game.category));
    const known = CATEGORY_ORDER.filter((category) => present.has(category));
    const extra = [...present].filter((c) => !CATEGORY_ORDER.includes(c)).sort();
    return [...known, ...extra];
  }

  countByCategory(category: string): number {
    return this.games.filter((game) => game.category === category).length;
  }

  searchGames(query: string, category = ''): Game[] {
    const needle = query.trim().toLowerCase();
    return this.games.filter((game) => {
      if (category && game.category !== category) return false;
      if (!needle) return true;
      return (
        game.name.toLowerCase().includes(needle) ||
        game.description.toLowerCase().includes(needle)
      );
    });
  }
}
