const { resolveCoreBinary } = require('./resolve-core-binary.js');

function mockResolver({ existing = [], pathResults = {}, env = {}, platform = 'linux', arch = 'x64' } = {}) {
  const exists = new Set(existing);
  const execFileSync = vi.fn((_command, args) => {
    const result = pathResults[args[0]];
    if (!result) throw new Error(`${args[0]} not found`);
    return `${result}\n`;
  });
  return {
    execFileSync,
    resolve: () =>
      resolveCoreBinary({
        platform,
        arch,
        env,
        resourcesRoot: platform === 'win32' ? 'C:\\app\\resources' : '/app/resources',
        existsSync: (candidate) => exists.has(candidate),
        readdirSync: () => [],
        readFileSync: () => '{}',
        execFileSync,
      }),
  };
}

describe('resolveCoreBinary', () => {
  it('uses explicit configuration before bundled and PATH candidates', () => {
    const fixture = mockResolver({
      existing: ['/custom/core', '/app/resources/bundled-centaurai-core/linux-x64/centaurai-core'],
      env: { CENTAURAI_CORE_BIN: '/custom/core' },
      pathResults: { 'centaurai-core': '/usr/bin/centaurai-core' },
    });
    expect(fixture.resolve()).toMatchObject({ path: '/custom/core', source: 'explicit', fallbackUsed: false });
    expect(fixture.execFileSync).not.toHaveBeenCalled();
  });

  it('uses the canonical bundle before canonical PATH', () => {
    const bundled = '/app/resources/bundled-centaurai-core/linux-x64/centaurai-core';
    const fixture = mockResolver({ existing: [bundled], pathResults: { 'centaurai-core': '/usr/bin/centaurai-core' } });
    expect(fixture.resolve()).toMatchObject({ path: bundled, source: 'bundled', flavor: 'centaurai-core' });
  });

  it('uses canonical PATH before an explicitly enabled legacy bundle', () => {
    const legacy = '/app/resources/bundled-aioncore/linux-x64/aioncore';
    const fixture = mockResolver({
      existing: [legacy, '/usr/bin/centaurai-core'],
      env: { CENTAURAI_CORE_ALLOW_LEGACY_FALLBACK: '1' },
      pathResults: { 'centaurai-core': '/usr/bin/centaurai-core' },
    });
    expect(fixture.resolve()).toMatchObject({ source: 'path', fallbackUsed: false });
  });

  it('does not silently use legacy bundled or PATH binaries', () => {
    const legacy = '/app/resources/bundled-aioncore/linux-x64/aioncore';
    const fixture = mockResolver({ existing: [legacy, '/usr/bin/aioncore'], pathResults: { aioncore: '/usr/bin/aioncore' } });
    expect(fixture.resolve).toThrow('legacy fallback is disabled');
    expect(fixture.execFileSync).toHaveBeenCalledTimes(1);
  });

  it('uses legacy bundle before legacy PATH when fallback is explicit', () => {
    const legacy = '/app/resources/bundled-aioncore/linux-x64/aioncore';
    const fixture = mockResolver({
      existing: [legacy, '/usr/bin/aioncore'],
      env: { AIONUI_BACKEND_ALLOW_LEGACY: 'true' },
      pathResults: { aioncore: '/usr/bin/aioncore' },
    });
    expect(fixture.resolve()).toMatchObject({ path: legacy, source: 'legacy-bundled', fallbackUsed: true });
  });

  it('uses .exe names and Windows paths', () => {
    const bundled = 'C:\\app\\resources\\bundled-centaurai-core\\win32-arm64\\centaurai-core.exe';
    const fixture = mockResolver({ platform: 'win32', arch: 'arm64', existing: [bundled] });
    expect(fixture.resolve()).toMatchObject({ path: bundled, binaryName: 'centaurai-core.exe' });
  });

  it('rejects an explicit legacy binary unless fallback mode is enabled', () => {
    const fixture = mockResolver({ existing: ['/custom/aioncore'], env: { AIONUI_BACKEND_BIN: '/custom/aioncore' } });
    expect(fixture.resolve).toThrow('requires CENTAURAI_CORE_ALLOW_LEGACY_FALLBACK=1');
  });
});
