/**
 * E2E Scenario 6: Agent whitelist enforcement.
 *
 * Verifies: UI create modal member list only shows supported agent types.
 *
 * Core's `/api/assistants` `team_selectable` projection is authoritative.
 */
import { test, expect } from '../../fixtures';
import { httpGet } from '../../helpers';

type AssistantProjection = {
  id: string;
  enabled: boolean;
  team_selectable?: boolean;
};

test.describe('Team Agent Whitelist', () => {
  test('UI only shows whitelisted agents in create modal dropdown', async ({ page }) => {
    // Navigate to home to access the create modal
    await page.goto(page.url().split('#')[0] + '#/guid');

    // Close any leftover modal from previous tests before interacting with the page
    const createModal = page.locator('.team-create-modal');
    const existingModal = createModal.locator('.arco-btn-text');
    if (await existingModal.isVisible({ timeout: 1000 }).catch(() => false)) {
      await existingModal.click({ force: true });
      await expect(createModal).toBeHidden({ timeout: 5000 });
    }

    await expect(page.locator('[data-testid="team-create-btn"]').first()).toBeVisible({ timeout: 10000 });

    // Open Create Team modal
    const createBtn = page.locator('[data-testid="team-create-btn"]').first();
    await createBtn.click();

    // The current multi-select renders agent rows directly in the modal.
    const modal = createModal;

    // Wait for at least one option to render.
    const firstOption = modal.locator('[data-testid^="team-create-agent-option-"]').first();
    await expect(firstOption).toBeVisible({ timeout: 5000 });

    // Screenshot: dropdown options
    await page.screenshot({ path: 'tests/e2e/results/team-whitelist-01-dropdown.png' });

    const allOptions = modal.locator('[data-testid^="team-create-agent-option-"]');
    const totalCount = await allOptions.count();
    expect(totalCount).toBeGreaterThan(0);

    const visibleAssistantIds: string[] = [];
    for (let i = 0; i < totalCount; i++) {
      const testId = await allOptions.nth(i).getAttribute('data-testid');
      const id = testId?.replace('team-create-agent-option-', '');
      if (id && !id.startsWith('model:')) visibleAssistantIds.push(id);
    }

    const assistants = await httpGet<AssistantProjection[]>(page, '/api/assistants');
    const expectedAssistantIds = assistants
      .filter((assistant) => assistant.enabled !== false && assistant.team_selectable === true)
      .map((assistant) => assistant.id)
      .sort();

    expect(visibleAssistantIds.sort()).toEqual(expectedAssistantIds);

    // Close the modal via Cancel button.
    await modal.locator('.arco-btn-text').first().click();
    await expect(modal).toBeHidden({ timeout: 5000 });
  });
});
