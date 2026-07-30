import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-filter',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="flex items-center gap-3 flex-wrap">
      <span class="font-semibold text-gray-700">Category:</span>
      <button
        *ngFor="let cat of categories"
        (click)="selectCategory(cat)"
        [class.active]="selectedCategory === cat"
        class="px-4 py-2 rounded-full transition duration-200"
        [ngClass]="
          selectedCategory === cat
            ? 'bg-primary-500 text-white'
            : 'bg-gray-200 text-gray-800 hover:bg-gray-300'
        "
      >
        {{ cat }}
      </button>
      <button
        *ngIf="selectedCategory"
        (click)="clearFilter()"
        class="px-4 py-2 bg-red-100 hover:bg-red-200 text-red-800 rounded-full transition"
      >
        Reset
      </button>
    </div>
  `,
  styles: [],
})
export class FilterComponent {
  @Input() categories: string[] = [];
  @Output() categoryChange = new EventEmitter<string>();

  selectedCategory = '';

  selectCategory(category: string): void {
    this.selectedCategory = category;
    this.categoryChange.emit(category);
  }

  clearFilter(): void {
    this.selectedCategory = '';
    this.categoryChange.emit('');
  }
}
