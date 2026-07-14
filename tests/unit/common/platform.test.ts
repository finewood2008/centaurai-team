import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { getDevUserDataPath } from '@/common/platform';

const originalE2EMode = process.env.AIONUI_E2E_TEST;
const originalE2EUserDataDir = process.env.AIONUI_E2E_USER_DATA_DIR;

afterEach(() => {
  if (originalE2EMode === undefined) delete process.env.AIONUI_E2E_TEST;
  else process.env.AIONUI_E2E_TEST = originalE2EMode;
  if (originalE2EUserDataDir === undefined) delete process.env.AIONUI_E2E_USER_DATA_DIR;
  else process.env.AIONUI_E2E_USER_DATA_DIR = originalE2EUserDataDir;
});

describe('getDevUserDataPath', () => {
  it('uses an absolute E2E sandbox while E2E mode is enabled', () => {
    process.env.AIONUI_E2E_TEST = '1';
    process.env.AIONUI_E2E_USER_DATA_DIR = path.resolve('/tmp', 'centaurai-e2e-test');

    expect(getDevUserDataPath(path.resolve('/home', 'tester', '.config', 'CentaurAI'))).toBe(
      path.resolve('/tmp', 'centaurai-e2e-test')
    );
  });

  it('ignores a relative E2E sandbox path', () => {
    process.env.AIONUI_E2E_TEST = '1';
    process.env.AIONUI_E2E_USER_DATA_DIR = '../shared-data';

    expect(getDevUserDataPath(path.resolve('/home', 'tester', '.config', 'CentaurAI'))).toBe(
      path.resolve('/home', 'tester', '.config', 'CentaurAI-Dev')
    );
  });

  it('ignores the sandbox override outside E2E mode', () => {
    delete process.env.AIONUI_E2E_TEST;
    process.env.AIONUI_E2E_USER_DATA_DIR = path.resolve('/tmp', 'centaurai-e2e-test');

    expect(getDevUserDataPath(path.resolve('/home', 'tester', '.config', 'CentaurAI'))).toBe(
      path.resolve('/home', 'tester', '.config', 'CentaurAI-Dev')
    );
  });
});
