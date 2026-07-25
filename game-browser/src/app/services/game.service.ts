import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, BehaviorSubject } from 'rxjs';
import { map, tap } from 'rxjs/operators';
import { Game } from '../models/game';

@Injectable({
  providedIn: 'root',
})
export class GameService {
  private gamesSubject = new BehaviorSubject<Game[]>([]);
  public games$ = this.gamesSubject.asObservable();

  constructor(private http: HttpClient) {
    this.loadGames();
  }

  private loadGames(): void {
    this.http.get<Game[]>('/assets/games.json').subscribe((games) => {
      this.gamesSubject.next(games);
    });
  }

  getGames(): Game[] {
    return this.gamesSubject.value;
  }

  getAllCategories(): string[] {
    const games = this.gamesSubject.value;
    const categories = new Set(games.map((game) => game.category));
    return Array.from(categories).sort();
  }

  searchGames(query: string, category: string = ''): Game[] {
    const games = this.gamesSubject.value;
    const lowerQuery = query.toLowerCase();

    let filtered = games.filter(
      (game) =>
        game.name.toLowerCase().includes(lowerQuery) ||
        game.description.toLowerCase().includes(lowerQuery)
    );

    if (category && category !== 'All') {
      filtered = filtered.filter((game) => game.category === category);
    }

    return filtered;
  }
}
