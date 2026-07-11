const {
  CORE_ARTIFACT_CONFIG,
  assertExactReleaseTag,
  getArtifactUrl,
  getAssetName,
  getBinaryName,
  getTarget,
} = require('./core-artifact-config.js');

describe('CentaurAI Core artifact contract', () => {
  it('pins the fork repository and exact release', () => {
    expect(CORE_ARTIFACT_CONFIG.repository).toBe('finewood2008/centaurai-core');
    expect(CORE_ARTIFACT_CONFIG.version).toBe('v0.1.46');
    expect(() => assertExactReleaseTag('latest')).toThrow('exact v-prefixed release tag');
  });

  it.each([
    ['darwin', 'x64', 'x86_64-apple-darwin', '.tar.gz'],
    ['darwin', 'arm64', 'aarch64-apple-darwin', '.tar.gz'],
    ['linux', 'x64', 'x86_64-unknown-linux-gnu', '.tar.gz'],
    ['linux', 'arm64', 'aarch64-unknown-linux-gnu', '.tar.gz'],
    ['win32', 'x64', 'x86_64-pc-windows-msvc', '.zip'],
    ['win32', 'arm64', 'aarch64-pc-windows-msvc', '.zip'],
  ])('maps %s-%s to its release asset', (platform, arch, releaseTarget, extension) => {
    expect(getTarget(platform, arch)).toMatchObject({ releaseTarget, archiveExtension: extension });
    expect(getAssetName(platform, arch)).toBe(`centaurai-core-v0.1.46-${releaseTarget}${extension}`);
    expect(getArtifactUrl(platform, arch)).toBe(
      `https://github.com/finewood2008/centaurai-core/releases/download/v0.1.46/centaurai-core-v0.1.46-${releaseTarget}${extension}`
    );
  });

  it('maps canonical and compatibility binary names on Windows', () => {
    expect(getBinaryName('win32')).toBe('centaurai-core.exe');
    expect(getBinaryName('win32', true)).toBe('aioncore.exe');
  });
});
