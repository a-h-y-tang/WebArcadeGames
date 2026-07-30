---
title: Angular Game Browser Design
description: Technical architecture and component design for the game browser
---

## Architecture Overview

```
┌─────────────────────────────────────────────────────┐
│              Angular Game Browser                   │
├─────────────────────────────────────────────────────┤
│                                                     │
│  ┌──────────────────────────────────────────────┐  │
│  │           App Component                      │  │
│  │  (Layout, header, nav)                       │  │
│  └──────────────────────────────────────────────┘  │
│                        │                           │
│         ┌──────────────┼──────────────┐            │
│         ▼              ▼              ▼            │
│   ┌──────────┐  ┌──────────┐  ┌──────────┐       │
│   │ Header   │  │ Search   │  │ Filter   │       │
│   │Component │  │Component │  │Component │       │
│   └──────────┘  └──────────┘  └──────────┘       │
│                                                     │
│  ┌──────────────────────────────────────────────┐  │
│  │        Game Grid Component                   │  │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐    │  │
│  │  │Game Card │ │Game Card │ │Game Card │    │  │
│  │  │Component │ │Component │ │Component │    │  │
│  │  └──────────┘ └──────────┘ └──────────┘    │  │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐    │  │
│  │  │Game Card │ │Game Card │ │Game Card │    │  │
│  │  │Component │ │Component │ │Component │    │  │
│  │  └──────────┘ └──────────┘ └──────────┘    │  │
│  └──────────────────────────────────────────────┘  │
│                                                     │
│  ┌──────────────────────────────────────────────┐  │
│  │        Game Service                          │  │
│  │  • Load games.json                           │  │
│  │  • Filter/search logic                       │  │
│  │  • Category management                       │  │
│  └──────────────────────────────────────────────┘  │
│                                                     │
└─────────────────────────────────────────────────────┘
                        │
                        ▼
        ┌───────────────────────────────┐
        │    games.json (static data)   │
        │  [                            │
        │    {                          │
        │      id, name, description,   │
        │      category, path, thumb    │
        │    }, ...                     │
        │  ]                            │
        └───────────────────────────────┘
```

## Component Structure

### AppComponent
- Main layout wrapper
- Header with site branding
- Search/filter container
- Game grid container

### HeaderComponent
- Site title/logo (WholesomeFun.org)
- Tagline: "Free games. No ads. No tracking."
- Mission statement

### SearchComponent
- Text input for search
- Real-time filtering
- Clear button

### FilterComponent
- Category dropdown/chips (Puzzle, Action, Strategy, etc.)
- Optional: difficulty filter
- Reset filters button

### GameGridComponent
- Displays games in responsive CSS Grid (3-4 columns on desktop, 1-2 on mobile)
- Uses GameCardComponent for each game
- Lazy loads images for performance

### GameCardComponent
- Game thumbnail image
- Game title
- Short description
- Category badge
- "Play" button (links to game)
- Hover effects for interactivity

## Data Model

```typescript
interface Game {
  id: string;           // unique identifier
  name: string;         // "Asteroids", "Breakout", etc
  description: string;  // Short description
  category: string;     // "Action", "Puzzle", "Strategy"
  path: string;         // Relative path to game folder
  thumbnail: string;    // Path to thumbnail image
  keywords?: string[];  // For search
}
```

## games.json Structure

```json
[
  {
    "id": "asteroids",
    "name": "Asteroids",
    "description": "Classic arcade shooter - destroy asteroids before they hit you",
    "category": "Action",
    "path": "./Asteroids",
    "thumbnail": "./Asteroids/thumbnail.png",
    "keywords": ["shooter", "space", "classic"]
  },
  {
    "id": "breakout",
    "name": "Breakout",
    "description": "Paddle-based arcade game - break all the bricks",
    "category": "Action",
    "path": "./Breakout",
    "thumbnail": "./Breakout/thumbnail.png"
  }
]
```

## Service Layer

### GameService
```typescript
- loadGames(): Observable<Game[]>
- getGamesByCategory(category: string): Game[]
- searchGames(query: string): Game[]
- getAllCategories(): string[]
- filterGames(query: string, category: string): Game[]
```

## Styling Approach

Use **Tailwind CSS** for:
- Clean, modern design
- Responsive grid layouts
- Fast development
- Minimal bundle size

Color scheme (wholesome, trustworthy):
- Primary: Calm blue (#4F46E5)
- Accent: Warm green (#10B981)
- Neutral: Grays for text/backgrounds
- Light/dark mode support

## Performance Optimizations

1. **Static Build**: ng build --prod generates pre-rendered HTML
2. **Image Optimization**: Lazy loading images as they enter viewport
3. **Code Splitting**: Angular tree-shaking removes unused code
4. **Caching**: Cloudflare/Vercel CDN caches static assets

## Deployment

### Cloudflare Pages
```
Build command: npm run build
Build directory: dist/game-browser
```

### Vercel
```
Build command: npm run build
Build directory: dist/game-browser
```

Both support automatic deployments from git push.
