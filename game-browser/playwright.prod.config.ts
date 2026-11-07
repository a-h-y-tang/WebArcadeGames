import { existsSync } from 'fs';
import { defineConfig, devices } from '@playwright/test';

const PREINSTALLED_CHROMIUM = '/opt/pw-browsers/chromium';
const launchOptions = existsSync(PREINSTALLED_CHROMIUM)
  ? { executablePath: PREINSTALLED_CHROMIUM }
  : {};

// Builds the site and tests the static output that actually gets deployed.
export default defineConfig({
  testDir: './e2e-prod',
  reporter: 'list',
  use: { baseURL: 'http://localhost:4300' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], launchOptions } }],
  webServer: {
    command: 'npm run build && node e2e-prod/serve-dist.js',
    url: 'http://localhost:4300',
    reuseExistingServer: false,
    timeout: 180000,
  },
});
