import { Component } from '@angular/core';

@Component({
  selector: 'app-header',
  standalone: true,
  template: `
    <header class="bg-gradient-to-r from-primary-500 to-primary-700 text-white py-8 shadow-lg">
      <div class="max-w-7xl mx-auto px-4">
        <h1 class="text-4xl font-bold mb-2">WholesomeFun</h1>
        <p class="text-lg text-primary-50">Free games. No ads. No tracking. Just clean fun.</p>
      </div>
    </header>
  `,
  styles: [],
})
export class HeaderComponent {}
