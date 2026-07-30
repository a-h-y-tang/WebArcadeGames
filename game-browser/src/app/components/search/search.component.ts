import { Component, EventEmitter, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-search',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="flex gap-2">
      <input
        type="text"
        [(ngModel)]="searchQuery"
        (ngModelChange)="onSearchChange()"
        placeholder="Search games..."
        class="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
      />
      <button
        *ngIf="searchQuery"
        (click)="clearSearch()"
        class="px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-800 rounded-lg transition"
      >
        Clear
      </button>
    </div>
  `,
  styles: [],
})
export class SearchComponent {
  @Output() searchChange = new EventEmitter<string>();

  searchQuery = '';

  onSearchChange(): void {
    this.searchChange.emit(this.searchQuery);
  }

  clearSearch(): void {
    this.searchQuery = '';
    this.searchChange.emit('');
  }
}
