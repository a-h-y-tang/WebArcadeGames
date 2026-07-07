const fs = require('fs');
const { defineConfig, devices } = require('@playwright/test');

// In some managed / cloud CI environments a full Chromium is pre-installed at a
// fixed path that may not match the version Playwright would otherwise download
// (and its own download is disabled). When that executable exists, point the
// browser at it; otherwise fall back to the browser Playwright manages itself
// (the normal local-dev / Windows case).
const PREINSTALLED_CHROMIUM = '/opt/pw-browsers/chromium';
const launchOptions = fs.existsSync(PREINSTALLED_CHROMIUM)
    ? { executablePath: PREINSTALLED_CHROMIUM }
    : {};

module.exports = defineConfig({
    testDir: '.',
    testMatch: '**/tests/*.spec.js',
    timeout: 10_000,
    use: {
        headless: true,
        launchOptions,
    },
    projects: [
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'], launchOptions },
        },
    ],
});
