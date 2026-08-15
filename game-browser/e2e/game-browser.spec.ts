import { test, expect } from '@playwright/test';

test.describe('Game Browser', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test('should load the home page with header', async ({ page }) => {
    // Check page title
    await expect(page).toHaveTitle(/WholesomeFun/);

    // Check header is visible
    const header = page.locator('app-header');
    await expect(header).toBeVisible();

    // Check header content
    await expect(page.locator('h1')).toContainText('WholesomeFun');
    await expect(page.locator('header')).toContainText(
      'Free games. No ads. No tracking.'
    );
  });

  test('should display games in a grid', async ({ page }) => {
    // Wait for games to load
    const gameCards = page.locator('app-game-card');
    await expect(gameCards).toHaveCount(109);

    // Check first game card structure
    const firstCard = gameCards.first();
    await expect(firstCard.locator('h3')).toBeVisible();
    await expect(firstCard.locator('button:has-text("Play")')).toBeVisible();
  });

  test('should have search functionality', async ({ page }) => {
    // Initial state: all 105 games visible
    let gameCards = page.locator('app-game-card');
    await expect(gameCards).toHaveCount(109);

    // Search for "Tetris"
    const searchInput = page.locator('input[placeholder="Search games..."]');
    await searchInput.fill('Tetris');

    // Should show only Tetris
    gameCards = page.locator('app-game-card');
    await expect(gameCards).toHaveCount(1);
    await expect(gameCards.first().locator('h3')).toContainText('Tetris');
  });

  test('should filter by category', async ({ page }) => {
    // Get initial game count
    let gameCards = page.locator('app-game-card');
    const initialCount = await gameCards.count();
    expect(initialCount).toBeGreaterThan(0);

    // Click on "Puzzle" category
    const puzzleButton = page.locator('button:has-text("Puzzle")');
    await puzzleButton.click();

    // Wait for filtered results
    gameCards = page.locator('app-game-card');
    const puzzleCount = await gameCards.count();

    // Should have fewer games than total
    expect(puzzleCount).toBeLessThan(initialCount);
    expect(puzzleCount).toBeGreaterThan(0);
  });

  test('should combine search and filter', async ({ page }) => {
    // Filter by Puzzle category
    const puzzleButton = page.locator('button:has-text("Puzzle")');
    await puzzleButton.click();

    // Search within puzzles
    const searchInput = page.locator('input[placeholder="Search games..."]');
    await searchInput.fill('Tetris');

    // Should show only Tetris (which is a Puzzle)
    const gameCards = page.locator('app-game-card');
    await expect(gameCards).toHaveCount(1);
    await expect(gameCards.first().locator('h3')).toContainText('Tetris');
  });

  test('should clear search with clear button', async ({ page }) => {
    // Search for a game
    const searchInput = page.locator('input[placeholder="Search games..."]');
    await searchInput.fill('Tetris');

    // Clear button should appear
    const clearButton = page.locator('button:has-text("Clear")');
    await expect(clearButton).toBeVisible();

    // Click clear
    await clearButton.click();

    // Search should be empty and all games visible
    await expect(searchInput).toHaveValue('');
    const gameCards = page.locator('app-game-card');
    await expect(gameCards).toHaveCount(109);
  });

  test('should reset category filter', async ({ page }) => {
    // Filter by Action
    const actionButton = page.locator('button:has-text("Action")');
    await actionButton.click();

    // Games should be filtered
    let gameCards = page.locator('app-game-card');
    const filteredCount = await gameCards.count();
    expect(filteredCount).toBeLessThan(105);

    // Click Reset button
    const resetButton = page.locator('button:has-text("Reset")');
    await resetButton.click();

    // All games should be visible again
    gameCards = page.locator('app-game-card');
    await expect(gameCards).toHaveCount(109);
  });

  test('should display game card details', async ({ page }) => {
    const gameCards = page.locator('app-game-card');
    const firstCard = gameCards.first();

    // Check card has title
    const title = firstCard.locator('h3');
    await expect(title).toBeVisible();
    const titleText = await title.textContent();
    expect(titleText?.length).toBeGreaterThan(0);

    // Check card has description
    const description = firstCard.locator('p');
    await expect(description).toBeVisible();

    // Check card has category badge
    const badge = firstCard.locator('span');
    await expect(badge).toContainText(/Action|Puzzle|Strategy|Board Game|Card Game|Sports/);

    // Check Play button exists
    const playButton = firstCard.locator('button:has-text("Play")');
    await expect(playButton).toBeVisible();
  });

  test('should navigate to game when Play button clicked', async ({ page }) => {
    const playButton = page.locator('app-game-card').first().locator('button:has-text("Play")');

    // Get the expected URL (e.g., /games/2048/index.html)
    const gameCard = page.locator('app-game-card').first();
    const gameTitle = await gameCard.locator('h3').textContent();

    // Capture navigation
    const navigationPromise = page.waitForNavigation();
    await playButton.click();

    // Wait for navigation to complete
    const response = await navigationPromise;

    // Verify we navigated to a game path
    expect(response?.url()).toContain('/games/');
  });

  test('should show "no games found" when search has no results', async ({ page }) => {
    const searchInput = page.locator('input[placeholder="Search games..."]');
    await searchInput.fill('XYZ_NONEXISTENT_GAME_12345');

    // Should show no games
    const gameCards = page.locator('app-game-card');
    await expect(gameCards).toHaveCount(0);

    // Should show message
    await expect(page.locator('text=No games found')).toBeVisible();
  });

  test('should display all game categories', async ({ page }) => {
    const expectedCategories = [
      'Action',
      'Puzzle',
      'Strategy',
      'Board Game',
      'Card Game',
      'Sports',
    ];

    for (const category of expectedCategories) {
      const categoryButton = page.locator(`button:has-text("${category}")`);
      await expect(categoryButton).toBeVisible();
    }
  });

  test('should have accessible game grid on mobile', async ({ page }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });

    // Games should still load and be visible
    const gameCards = page.locator('app-game-card');
    await expect(gameCards.first()).toBeVisible();

    // Should have games displayed on mobile
    const gameCount = await gameCards.count();
    expect(gameCount).toBeGreaterThan(0);
  });

  test('should have accessible game grid on desktop', async ({ page }) => {
    // Set desktop viewport
    await page.setViewportSize({ width: 1920, height: 1080 });

    // Games should load
    const gameCards = page.locator('app-game-card');
    await expect(gameCards.first()).toBeVisible();
  });

  test('should display footer', async ({ page }) => {
    // Scroll to bottom
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));

    // Footer should be visible
    const footer = page.locator('footer');
    await expect(footer).toBeVisible();
    await expect(footer).toContainText('WholesomeFun');
    await expect(footer).toContainText('Free, Ad-Free Games for Families');
  });
});
