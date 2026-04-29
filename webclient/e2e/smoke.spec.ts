import { test, expect } from '@playwright/test';

/**
 * Slice 62 — end-to-end smoke test. Per the audit's v1 exit-gate:
 * "log in → create table → add AI → play → game-over banner shows."
 *
 * v1 shape: concede mid-game instead of playing through 5 turns.
 * Concede still triggers the game-end-modal — the assertion is the
 * same — and avoids the flakiness of 60+ priority-pass clicks
 * across an AI's variable think time.
 *
 * Prerequisites: WebApi running on :18080, Vite dev on :5173.
 * Run: `pnpm e2e` (or `pnpm e2e:headed` to watch the browser).
 */
test('login → create table → AI → start → concede → game-end modal', async ({ page }) => {
  // 1. Anonymous login
  await page.goto('/');
  await page.locator('[data-testid="login-submit"]').click();

  // 2. Lobby loaded — click "Create table"
  await page.locator('[data-testid="create-table-button"]').click();

  // 3. CreateTableModal — defaults are: AI checked + COMPUTER_MAD
  //    + wins-needed=1. Just submit.
  //    (wins-needed=1 means a single game, no sideboarding.)
  //    Wait for the submit to be ENABLED — it's gated on
  //    serverState.deckTypes being populated, which arrives async
  //    from the WebApi /serverState call. Without this wait, a
  //    fresh-cold server can flake here (click no-ops on disabled
  //    button → next assertion times out with no visible cause).
  const createSubmit = page.locator('[data-testid="create-table-submit"]');
  await expect(createSubmit).toBeEnabled({ timeout: 10_000 });
  await createSubmit.click();

  // 4. Wait for the table to reach READY_TO_START state, then click
  //    Start. The AI join is async; allow up to 15s.
  await page.locator('[data-testid="start-table-button"]').click({ timeout: 15_000 });

  // 5. Game window loads — wait for the action panel to appear,
  //    indicating the game stream is connected and our hand is dealt.
  await expect(page.locator('[data-testid="action-panel"]')).toBeVisible({ timeout: 20_000 });

  // 6. Wait for our priority before conceding (otherwise the click
  //    has no effect). Priority indicator shows "Your priority"
  //    when we hold priority.
  //    Timeout 30s — generous because if the AI is on the play, it
  //    plays its full first turn (untap → upkeep → … → end → cleanup,
  //    plus think time on each priority window) before we ever see
  //    priority. Mad AI's per-priority budget is 12s (slice 47), so
  //    a worst-case first-turn could chew most of 30s.
  await expect(page.locator('[data-testid="priority-indicator"]'))
    .toContainText(/your priority/i, { timeout: 30_000 });

  // 7. Concede.
  await page.locator('[data-testid="concede-button"]').click();
  await page.locator('[data-testid="concede-confirm-yes"]').click();

  // 8. Assert game-end modal appears.
  await expect(page.locator('[data-testid="game-end-modal"]')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('[data-testid="game-end-modal"]')).toContainText(/lost|won|over/i);
});
