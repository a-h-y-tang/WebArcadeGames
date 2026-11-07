// Copies the playable game folders from the repository root into the
// production build at dist/game-browser/browser/games/<dir>/, so the links in
// games.json (games/<dir>/...) work when the build output is deployed on its own.
import { cpSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = join(here, '..');
const repoRoot = join(appRoot, '..');
const outDir = join(appRoot, 'dist/game-browser/browser/games');

const games = JSON.parse(readFileSync(join(appRoot, 'src/assets/games.json'), 'utf8'));
const dirs = [...new Set(games.map((game) => game.dir))];

// Test suites and design notes are not part of the playable game.
const skip = new Set(['tests', 'node_modules', 'DESIGN.md', 'design.md', 'README.md']);

rmSync(outDir, { recursive: true, force: true });
const missing = [];
for (const dir of dirs) {
  const src = join(repoRoot, dir);
  if (!existsSync(src)) {
    missing.push(dir);
    continue;
  }
  cpSync(src, join(outDir, dir), {
    recursive: true,
    filter: (path) => !skip.has(basename(path)),
  });
}

if (missing.length) {
  console.error(`games.json points at folders that do not exist: ${missing.join(', ')}`);
  process.exit(1);
}
console.log(`Copied ${dirs.length} game folders into ${outDir}`);
