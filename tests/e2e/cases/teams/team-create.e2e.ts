/**
 * E2E Scenario 1: Create a team from the sidebar.
 *
 * Flow: sidebar "+" button -> Create Team modal -> fill form -> create -> verify navigation
 */
import { test, expect } from '../../fixtures';
import {
  TEAM_SUPPORTED_BACKENDS,
  cleanupTeamsByName,
  ensureTeamAgentOptionSelected,
  submitTeamCreation,
} from '../../helpers';

/**
 * UI label patterns for each backend. Used to match the agent option in the
 * Create Team member list. Falls back to a case-insensitive backend name match.
 */
const BACKEND_UI_PATTERN: Record<string, RegExp> = {
  claude: /Claude Code/i,
  codex: /Codex/i,
  gemini: /Gemini/i,
};

test.describe('Team Create', () => {
  test('sidebar shows team section with create button', async ({ page }) => {
    // Wait for sidebar to render — no fixed timeout, listen for element
    const teamSection = page.locator('[data-testid="team-section-toggle"]');
    await expect(teamSection).toBeVisible({ timeout: 15000 });

    // Screenshot: initial state
    await page.screenshot({ path: 'tests/e2e/results/team-01-initial.png' });

    // Verify the "+" create button exists next to the Teams title
    const createBtn = page.locator('[data-testid="team-create-btn"]').first();
    await expect(createBtn).toBeVisible();
  });

  test('clicking + opens create team modal', async ({ page }) => {
    // Wait for create button to be ready before clicking
    const createBtn = page.locator('[data-testid="team-create-btn"]').first();
    await expect(createBtn).toBeVisible({ timeout: 10000 });
    await createBtn.click();

    // Screenshot: modal open
    await page.screenshot({ path: 'tests/e2e/results/team-02-modal.png' });

    // Verify Modal is visible with "Create Team" title
    const modalTitle = page.locator('.team-create-modal h3');
    await expect(modalTitle).toBeVisible({ timeout: 5000 });

    // Verify Team name input exists
    const modal = page.locator('.team-create-modal');
    const nameInput = modal.locator('[data-testid="team-create-name-input"]');
    await expect(nameInput).toBeVisible();

    // Verify the current multi-select agent list exists, or the empty-state is shown.
    const agentOption = modal.locator('[data-testid^="team-create-agent-option-"]').first();
    const noAgentsMsg = modal.getByText(/No supported agents installed|没有支持的 agent/i);
    const hasAgentOption = await agentOption.isVisible({ timeout: 3000 }).catch(() => false);
    const hasNoAgentsMsg = await noAgentsMsg.isVisible({ timeout: 1000 }).catch(() => false);
    expect(hasAgentOption || hasNoAgentsMsg).toBeTruthy();

    // Verify Create button exists (disabled until agent is selected and name is filled)
    const confirmBtn = modal.locator('.arco-btn-primary');
    await expect(confirmBtn).toBeVisible();

    // Close modal via Cancel button
    await modal.locator('.arco-btn-text').first().click();
    await expect(modal).toBeHidden({ timeout: 5000 });
  });

  test('can fill form and create team', async ({ page }) => {
    // Wait for create button to be ready before clicking
    const createBtn = page.locator('[data-testid="team-create-btn"]').first();
    await expect(createBtn).toBeVisible({ timeout: 10000 });
    await createBtn.click();

    // Wait for modal to appear
    const modalTitle = page.locator('.team-create-modal h3');
    await expect(modalTitle).toBeVisible({ timeout: 5000 });

    // Fill team name
    const modal = page.locator('.team-create-modal');
    const nameInput = modal.locator('[data-testid="team-create-name-input"]');
    await nameInput.fill('E2E Test Team');

    const firstOption = modal.locator('[data-testid^="team-create-agent-option-"]').first();
    const hasAgentOption = await firstOption.isVisible({ timeout: 3000 }).catch(() => false);

    // Screenshot: select trigger visible
    await page.screenshot({ path: 'tests/e2e/results/team-03-agent-dropdown.png' });

    if (hasAgentOption) {
      await expect(firstOption).toBeVisible({ timeout: 5000 });
      await ensureTeamAgentOptionSelected(firstOption);

      // Wait for select value to reflect the chosen option (Create btn becomes enabled)
      const confirmBtn = modal.locator('.arco-btn-primary');
      await expect(confirmBtn).toBeEnabled({ timeout: 5000 });

      // Screenshot: form filled
      await page.screenshot({ path: 'tests/e2e/results/team-04-filled.png' });

      // Click Create and wait for navigation
      await submitTeamCreation(page, modal, confirmBtn);

      // Screenshot: after creation
      await page.screenshot({ path: 'tests/e2e/results/team-05-created.png' });

      // Verify team name appears in sidebar
      const teamName = page.locator('text=E2E Test Team');
      await expect(teamName.first()).toBeVisible({ timeout: 10000 });

      // cleanup: remove the team we just created to avoid polluting later tests
      await cleanupTeamsByName(page, 'E2E Test Team');
    } else {
      // No supported agents installed — screenshot and skip
      await page.screenshot({ path: 'tests/e2e/results/team-03-no-agents.png' });
      console.log('[E2E] No supported agents available for team creation');
      test.skip();
    }
  });
});

/**
 * Helper: open the Create Team modal, fill a team name, select the agent whose
 * option text matches `agentTextPattern`, click Create, and verify the team
 * was created. Skips gracefully if the agent is not installed.
 */
async function createTeamWithAgent(
  page: import('@playwright/test').Page,
  teamName: string,
  agentTextPattern: RegExp,
  screenshotPrefix: string
): Promise<void> {
  // Wait for create button to be ready (sidebar may still be loading after previous test)
  const createBtn = page.locator('[data-testid="team-create-btn"]').first();
  await expect(createBtn).toBeVisible({ timeout: 10000 });
  await createBtn.click();

  // Wait for modal to appear
  const modalTitle = page.locator('.team-create-modal h3');
  await expect(modalTitle).toBeVisible({ timeout: 5000 });

  // Fill team name
  const modal = page.locator('.team-create-modal');
  const nameInput = modal.locator('[data-testid="team-create-name-input"]');
  await nameInput.fill(teamName);

  await page.screenshot({ path: `tests/e2e/results/${screenshotPrefix}-agents.png` });

  // Find the agent option matching the text pattern (options are at page scope, not inside .arco-modal)
  const allOptions = page.locator('[data-testid^="team-create-agent-option-"]');
  await expect(allOptions.first())
    .toBeVisible({ timeout: 5000 })
    .catch(() => {});
  const optionCount = await allOptions.count().catch(() => 0);

  let matchingOption: import('@playwright/test').Locator | null = null;
  for (let i = 0; i < optionCount; i++) {
    const option = allOptions.nth(i);
    const text = await option.textContent().catch(() => '');
    if (agentTextPattern.test(text ?? '')) {
      matchingOption = option;
      break;
    }
  }

  if (!matchingOption) {
    // Agent not installed — close the modal and skip the test.
    await modal.locator('.arco-btn-text').first().click({ force: true });
    await expect(modal).toBeHidden({ timeout: 5000 });
    console.log(`[E2E] Agent matching ${agentTextPattern} not found — skipping`);
    test.skip();
    return;
  }

  await ensureTeamAgentOptionSelected(matchingOption);

  // Wait for Create button to become enabled (select value applied)
  const confirmBtn = page.locator('.arco-modal .arco-btn-primary');
  await expect(confirmBtn).toBeEnabled({ timeout: 5000 });

  await page.screenshot({ path: `tests/e2e/results/${screenshotPrefix}-filled.png` });

  // Submit and wait for navigation
  await submitTeamCreation(page, modal, confirmBtn);

  await page.screenshot({ path: `tests/e2e/results/${screenshotPrefix}-created.png` });

  // Verify team name appears in sidebar
  const teamNameLocator = page.locator(`text=${teamName}`);
  await expect(teamNameLocator.first()).toBeVisible({ timeout: 10000 });

  // cleanup: remove the team we just created to avoid polluting later tests
  await cleanupTeamsByName(page, teamName);
}

test.describe('Team Create - whitelisted leader types', () => {
  for (const backend of TEAM_SUPPORTED_BACKENDS) {
    const pattern = BACKEND_UI_PATTERN[backend] ?? new RegExp(backend, 'i');
    test(`create E2E Team (${backend})`, async ({ page }) => {
      await createTeamWithAgent(page, `E2E Team (${backend})`, pattern, `team-${backend}`);
    });
  }
});
