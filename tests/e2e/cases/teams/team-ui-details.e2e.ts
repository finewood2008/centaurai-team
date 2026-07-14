import { test, expect } from '../../fixtures';
import { cleanupTeamsByName, createTeam, ensureTeamAgentOptionSelected, submitTeamCreation } from '../../helpers';
import fs from 'fs';

const TEAM_COLLAPSED = 'E2E Collapsed Team';
const TEAM_WORKSPACE = 'E2E Workspace Team';

test.describe('Team UI Details', () => {
  test('collapsed sidebar shows team icon and navigates on click', async ({ page }) => {
    await cleanupTeamsByName(page, TEAM_COLLAPSED);

    const teamId = await createTeam(page, TEAM_COLLAPSED);

    const siderToggle = page.locator('[data-testid="sider-toggle"]');

    await siderToggle.click({ timeout: 5_000 });

    const collapsedItem = page.locator(`[data-testid="collapsed-team-item-${teamId}"]`);
    await expect(collapsedItem).toBeVisible({ timeout: 5_000 });

    const collapsedIcon = page.locator(`[data-testid="collapsed-team-icon-${teamId}"]`);
    await expect(collapsedIcon).toBeVisible();

    await collapsedItem.click();
    await page.waitForURL(new RegExp(`/team/${teamId}`), { timeout: 10_000 });

    const hash = await page.evaluate(() => window.location.hash);
    expect(hash).toContain(`/team/${teamId}`);

    await siderToggle.click({ timeout: 5_000 });

    await cleanupTeamsByName(page, TEAM_COLLAPSED);
  });

  test('create team with workspace folder via native dialog', async ({ electronApp, page }) => {
    await cleanupTeamsByName(page, TEAM_WORKSPACE);

    const tmpDir = `/tmp/e2e-workspace-${Date.now()}`;
    fs.mkdirSync(tmpDir, { recursive: true });
    await electronApp.evaluate(({ dialog }, dir) => {
      dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [dir] });
    }, tmpDir);

    const createBtn = page.locator('[data-testid="team-create-btn"]').first();
    await expect(createBtn).toBeVisible({ timeout: 10_000 });
    await createBtn.click();

    const modal = page.locator('.team-create-modal');
    await modal.waitFor({ state: 'visible', timeout: 5_000 });

    const nameInput = modal.locator('[data-testid="team-create-name-input"]');
    await nameInput.fill(TEAM_WORKSPACE);

    const firstOption = modal.locator('[data-testid^="team-create-agent-option-"]').first();
    const hasAgentOption = await firstOption.isVisible({ timeout: 3_000 }).catch(() => false);
    if (!hasAgentOption) {
      await modal
        .locator('.arco-btn')
        .filter({ hasText: /Cancel|取消/i })
        .first()
        .click({ force: true });
      test.skip();
      return;
    }
    await expect(firstOption).toBeVisible({ timeout: 5_000 });
    await ensureTeamAgentOptionSelected(firstOption);

    const trigger = modal.locator('[data-testid="team-create-workspace-trigger"]');
    await expect(trigger).toBeVisible({ timeout: 3_000 });
    await trigger.click();

    const menu = page.locator('[data-testid="team-create-workspace-menu"]');
    const menuVisible = await menu.isVisible({ timeout: 3_000 }).catch(() => false);

    if (menuVisible) {
      const browseOption = menu.locator('text=Choose a different folder').or(menu.locator('text=选择其他文件夹'));
      await browseOption.first().click();
    }

    await page.waitForTimeout(1_000);

    const workspacePath = modal.getByText(tmpDir.split('/').pop() ?? '', { exact: true }).first();
    await expect(workspacePath).toBeVisible({ timeout: 5_000 });

    const confirmBtn = modal.locator('.arco-btn-primary');
    await expect(confirmBtn).toBeEnabled({ timeout: 5_000 });
    await submitTeamCreation(page, modal, confirmBtn);

    const wsTitle = page.locator('text=Workspace').or(page.locator('text=工作区'));
    await expect(wsTitle.first()).toBeVisible({ timeout: 10_000 });

    await cleanupTeamsByName(page, TEAM_WORKSPACE);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
