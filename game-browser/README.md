# WholesomeFun Game Browser

A modern, clean Angular-based game browser for WholesomeFun.org. Browse and play 100+ arcade games with search and filtering capabilities.

## Features

- 🎮 Browse 100+ family-friendly arcade games
- 🔍 Real-time search functionality
- 🏷️ Filter games by category
- 📱 Fully responsive design (mobile, tablet, desktop)
- ⚡ Fast static site hosting (Cloudflare Pages or Vercel)
- 🎨 Clean, modern UI with no ads or tracking

## Tech Stack

- **Framework**: Angular 22.0+ (standalone components)
- **Styling**: Pure CSS utilities (no build-time dependencies)
- **Build**: Angular build system (ng build)
- **Hosting**: Cloudflare Pages or Vercel

## Installation & Setup

### Prerequisites

- Node.js 24.18.0+
- npm 11.16.0+

### Installed Dependencies

The following packages were installed during setup:

```bash
# Angular & core dependencies
npm install

# Dev dependencies already in package.json:
# - @angular/cli: Angular CLI for development
# - typescript: TypeScript compiler
# - zone.js: Zone.js runtime
```

### Development Server

1. Navigate to the game-browser directory:
```bash
cd game-browser
```

2. Start the development server:
```bash
npm start
```

3. Open your browser and navigate to `http://localhost:4200/`

The application will automatically reload when you modify any source files.

## Building for Production

```bash
npm run build
```

The build artifacts will be stored in the `dist/game-browser/` directory.

### Optimized for Static Hosting

The build output is a pure static site with:
- Pre-built HTML, CSS, and JavaScript
- No server-side dependencies required
- Can be deployed to any CDN

## Deployment

### Cloudflare Pages

```bash
# Using Wrangler CLI
npm install -D wrangler
wrangler pages deploy dist/game-browser/
```

Or connect your Git repository to Cloudflare Pages for automatic deployments.

**Configuration file**: `wrangler.toml`

### Vercel

1. Connect your GitHub repository to Vercel
2. Set build command: `npm run build`
3. Set output directory: `dist/game-browser`

**Configuration file**: `vercel.json`

Vercel will automatically deploy on every push to your repository.

### Manual Deployment

Simply copy the contents of `dist/game-browser/` to any static host:
```bash
npm run build
cp -r dist/game-browser/* /path/to/hosting/
```

## Project Structure

```
game-browser/
├── src/
│   ├── app/
│   │   ├── components/
│   │   │   ├── header/           # Site header & branding
│   │   │   ├── search/           # Search input component
│   │   │   ├── filter/           # Category filter component
│   │   │   ├── game-card/        # Individual game card
│   │   │   └── game-grid/        # Game grid layout
│   │   ├── models/
│   │   │   └── game.ts           # Game interface
│   │   ├── services/
│   │   │   └── game.service.ts   # Game data service
│   │   ├── app.ts                # Root component
│   │   ├── app.html              # Root template
│   │   └── app.css               # Root styles
│   ├── assets/
│   │   └── games.json            # Game metadata (105 games)
│   ├── styles.css                # Global styles
│   └── index.html                # HTML entry point
├── angular.json                  # Angular configuration
├── tsconfig.json                 # TypeScript configuration
├── package.json                  # npm dependencies
├── vercel.json                   # Vercel deployment config
└── wrangler.toml                 # Cloudflare Pages config
```

## Data Format

Games are defined in `src/assets/games.json`:

```json
{
  "id": "game-id",
  "name": "Game Name",
  "description": "Short description",
  "category": "Action|Puzzle|Strategy|Board Game|Card Game|Sports",
  "path": "../GameFolder",
  "thumbnail": "../GameFolder/thumbnail.png"
}
```

## Adding New Games

1. Add a new entry to `src/assets/games.json`
2. Provide a thumbnail image (recommended: 300x200px)
3. Rebuild: `npm run build`

## Performance

- **Bundle Size**: ~75KB (gzipped)
- **Initial Load**: < 1 second on 3G
- **No server required**: Pure static files
- **CDN-optimized**: Automatic compression and caching

## Browser Support

- Chrome/Edge (latest)
- Firefox (latest)
- Safari (latest)
- Mobile browsers (iOS Safari, Chrome Mobile)

## Contributing

To add features or fix issues:

1. Create a feature branch
2. Make your changes
3. Run `npm run build` to verify
4. Submit a pull request

## License

All arcade games in this collection are classic, public-domain, or community-created games designed for family entertainment.

## Support

For issues or questions, please open an issue in the repository.

---

**Mission**: Provide free, ad-free, safe gaming for families. Help us keep it running by [supporting WholesomeFun.org](https://wholesomefun.org)
