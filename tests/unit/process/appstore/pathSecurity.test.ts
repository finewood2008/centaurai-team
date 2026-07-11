import { describe, expect, it } from 'vitest';
import { isSafeAppId, resolveAppstoreChildPath } from '@/process/appstore/pathSecurity';

describe('app store path security', () => {
  it('accepts ordinary managed app ids', () => {
    expect(isSafeAppId('centaur-image-workbench')).toBe(true);
    expect(resolveAppstoreChildPath('/tmp/appstore-apps', 'centaur-image-workbench')).toBe(
      '/tmp/appstore-apps/centaur-image-workbench'
    );
  });

  it('rejects traversal and absolute/path-like ids', () => {
    expect(resolveAppstoreChildPath('/home/user/.config/CentaurAI/appstore-apps', '../../../../user')).toBeNull();
    expect(resolveAppstoreChildPath('/tmp/appstore-apps', '../outside')).toBeNull();
    expect(resolveAppstoreChildPath('/tmp/appstore-apps', '/etc')).toBeNull();
    expect(resolveAppstoreChildPath('/tmp/appstore-apps', 'nested/app')).toBeNull();
  });

  it('bounds id length and character set', () => {
    expect(isSafeAppId('Uppercase')).toBe(false);
    expect(isSafeAppId('-leading')).toBe(false);
    expect(isSafeAppId('trailing-')).toBe(false);
    expect(isSafeAppId('a'.repeat(65))).toBe(false);
  });
});
