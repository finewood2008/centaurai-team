/**
 * Case 1: Create Team - Full UI Flow
 *
 * Verifies the complete flow from Sider create button to Team page navigation.
 * No invokeBridge in core steps — all actions are real user interactions.
 * Cleanup uses invokeBridge (test data teardown is permitted).
 */
import { test, expect } from '../../fixtures';
import {
  TEAM_SUPPORTED_BACKENDS,
  cleanupTeamsByName,
  ensureTeamAgentOptionSelected,
  submitTeamCreation,
} from '../../helpers';

const TEAM_NAME = 'E2E Test Team 001';

test.describe('Team Create - Full UI Flow', () => {
  test('create team via UI without any API shortcut', async ({ page }) => {
    if (TEAM_SUPPORTED_BACKENDS.size === 0) {
      test.skip();
      return;
    }

    // Step 1: Wait for Sider Teams section to appear
    const teamSection = page.locator('[data-testid="team-section-toggle"]');
    await expect(teamSection).toBeVisible({ timeout: 15_000 });

    await page.screenshot({ path: 'tests/e2e/results/team-ui-01-sider.png' });

    // Step 2: Click "+" create button
    const createBtn = page.locator('[data-testid="team-create-btn"]').first();
    await expect(createBtn).toBeVisible({ timeout: 10_000 });
    await createBtn.click();

    // Step 3: Verify modal opened
    const modal = page.locator('.team-create-modal');
    await expect(modal).toBeVisible({ timeout: 5_000 });

    const modalTitle = modal.locator('h3');
    await expect(modalTitle).toBeVisible({ timeout: 5_000 });

    await page.screenshot({ path: 'tests/e2e/results/team-ui-02-modal.png' });

    // Step 4: Fill team name
    const nameInput = modal.locator('[data-testid="team-create-name-input"]');
    await expect(nameInput).toBeVisible();
    await nameInput.fill(TEAM_NAME);
    await expect(nameInput).toHaveValue(TEAM_NAME);

    // Step 5: The current multi-select renders agent rows directly in the modal.
    const firstOption = modal.locator('[data-testid^="team-create-agent-option-"]').first();
    const hasAgentOption = await firstOption.isVisible({ timeout: 3_000 }).catch(() => false);

    if (!hasAgentOption) {
      // No supported agents installed — cancel and skip
      const cancelBtn = modal
        .locator('.arco-btn')
        .filter({ hasText: /Cancel|取消/i })
        .first();
      await cancelBtn.click({ force: true }).catch(() => {});
      console.log('[E2E] No supported agent available for team creation — skipping');
      test.skip();
      return;
    }

    await page.screenshot({ path: 'tests/e2e/results/team-ui-03-agents.png' });

    // Step 6: Select first available agent option (options are portaled to document.body)
    await expect(firstOption).toBeVisible({ timeout: 5_000 });
    await ensureTeamAgentOptionSelected(firstOption);

    // Step 7: Verify Create button becomes enabled, then click
    const confirmBtn = modal.locator('.arco-btn-primary');
    await expect(confirmBtn).toBeEnabled({ timeout: 5_000 });

    await page.screenshot({ path: 'tests/e2e/results/team-ui-04-filled.png' });

    await submitTeamCreation(page, modal, confirmBtn);

    await page.screenshot({ path: 'tests/e2e/results/team-ui-05-created.png' });

    // Step 9: Verify Sider shows the new team name
    const teamNameInSider = page.locator(`text=${TEAM_NAME}`);
    await expect(teamNameInSider.first()).toBeVisible({ timeout: 10_000 });

    // Step 10: Verify the roundtable meeting room rendered (topic-centric board —
    // the only view is the meeting room; the legacy per-agent tab bar was removed).
    const roster = page.locator('[data-testid="meeting-roster"]');
    await expect(roster).toBeVisible({ timeout: 10_000 });

    // The idle control bar (topic input + start) must be present for a fresh room.
    const controlIdle = page.locator('[data-testid="meeting-control-idle"], [data-testid="meeting-start"]');
    await expect(controlIdle.first()).toBeVisible({ timeout: 5_000 });

    await page.screenshot({ path: 'tests/e2e/results/team-ui-06-team-page.png' });

    // Cleanup: remove the team via IPC (test data teardown only)
    await cleanupTeamsByName(page, TEAM_NAME);
  });
});
