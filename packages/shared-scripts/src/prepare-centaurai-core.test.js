const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  findBinaryInDir,
  parseChecksumFile,
  prepareCentauraiCore,
} = require('./prepare-centaurai-core.js');

const tempRoots = [];

afterEach(() => {
  delete process.env.CENTAURAI_CORE_RELEASE_COMMIT;
  for (const tempRoot of tempRoots.splice(0)) fs.rmSync(tempRoot, { recursive: true, force: true });
});

function makeRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'centaurai-core-prepare-test-'));
  tempRoots.push(root);
  return root;
}

function writeFile(filePath, contents = 'fixture') {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents);
}

function populateManagedResources(bundleOut, runtimeKey) {
  writeFile(path.join(bundleOut, 'node', 'node-v24.11.0-linux-x64', 'bin', 'node'));
  for (const [tool, version] of [
    ['codex-acp', '1.1.2'],
    ['claude-agent-acp', '0.58.1'],
  ]) {
    const platformRoot = path.join(bundleOut, 'acp', tool, version, runtimeKey);
    writeFile(path.join(platformRoot, 'dist', 'index.js'));
    writeFile(path.join(platformRoot, 'manifest.json'), JSON.stringify({ entrypoint: 'dist/index.js' }));
  }
}

function fixtureDeps({ sourceBinaryName = 'centaurai-core', checksum = 'valid', managedResources = true } = {}) {
  return {
    downloadFile(url, outputPath) {
      if (url.endsWith('centaurai-core-checksums.txt')) {
        const archiveName = 'centaurai-core-v0.1.47-x86_64-unknown-linux-gnu.tar.gz';
        const archivePath = path.join(path.dirname(outputPath), archiveName);
        const digest =
          checksum === 'valid'
            ? crypto.createHash('sha256').update(fs.readFileSync(archivePath)).digest('hex')
            : '0'.repeat(64);
        writeFile(outputPath, `${digest}  ${archiveName}\n`);
      } else {
        writeFile(outputPath, 'release archive fixture');
      }
    },
    extractArchive(_archivePath, outputDir) {
      writeFile(path.join(outputDir, 'nested', sourceBinaryName));
    },
    resolveReleaseCommit() {
      return 'a'.repeat(40);
    },
    execFileSync() {
      return 'centaurai-core 0.1.47\n';
    },
    prepareManagedResources(_binaryPath, stageDir) {
      const bundleOut = path.join(stageDir, 'managed-resources');
      fs.mkdirSync(bundleOut, { recursive: true });
      if (managedResources) populateManagedResources(bundleOut, 'linux-x64');
      return bundleOut;
    },
  };
}

describe('prepareCentauraiCore', () => {
  it('downloads from the fork, verifies checksum, and records complete provenance', () => {
    const projectRoot = makeRoot();
    const result = prepareCentauraiCore({
      projectRoot,
      platform: 'linux',
      arch: 'x64',
      version: 'v0.1.47',
      deps: fixtureDeps(),
    });

    expect(result.manifest).toMatchObject({
      repository: 'finewood2008/centaurai-core',
      tag: 'v0.1.47',
      commit: 'a'.repeat(40),
      binaryName: 'centaurai-core',
      sourceBinaryName: 'centaurai-core',
      fallbackUsed: false,
      artifactUrl:
        'https://github.com/finewood2008/centaurai-core/releases/download/v0.1.47/centaurai-core-v0.1.47-x86_64-unknown-linux-gnu.tar.gz',
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(fs.existsSync(path.join(result.dir, 'centaurai-core'))).toBe(true);
    expect(fs.existsSync(path.join(result.dir, 'managed-resources', 'acp', 'codex-acp'))).toBe(true);
  });

  it('rejects a checksum mismatch and removes an incomplete output', () => {
    const projectRoot = makeRoot();
    expect(() =>
      prepareCentauraiCore({
        projectRoot,
        platform: 'linux',
        arch: 'x64',
        version: 'v0.1.47',
        deps: fixtureDeps({ checksum: 'invalid' }),
      })
    ).toThrow('Checksum mismatch');
    expect(fs.existsSync(path.join(projectRoot, 'resources', 'bundled-centaurai-core', 'linux-x64'))).toBe(false);
  });

  it('rejects missing managed resources', () => {
    const projectRoot = makeRoot();
    expect(() =>
      prepareCentauraiCore({
        projectRoot,
        platform: 'linux',
        arch: 'x64',
        version: 'v0.1.47',
        deps: fixtureDeps({ managedResources: false }),
      })
    ).toThrow('Managed resources are incomplete');
  });

  it('normalizes a compatibility binary name and records fallback use', () => {
    const projectRoot = makeRoot();
    const result = prepareCentauraiCore({
      projectRoot,
      platform: 'linux',
      arch: 'x64',
      version: 'v0.1.47',
      deps: fixtureDeps({ sourceBinaryName: 'aioncore' }),
    });
    expect(result.manifest).toMatchObject({ sourceBinaryName: 'aioncore', binaryName: 'centaurai-core', fallbackUsed: true });
    expect(fs.existsSync(path.join(result.dir, 'centaurai-core'))).toBe(true);
  });

  it('rejects latest instead of making production builds non-reproducible', () => {
    expect(() =>
      prepareCentauraiCore({ projectRoot: makeRoot(), platform: 'linux', arch: 'x64', version: 'latest' })
    ).toThrow('exact v-prefixed release tag');
  });
});

describe('downloader helpers', () => {
  it('finds a binary nested inside an extracted archive', () => {
    const root = makeRoot();
    writeFile(path.join(root, 'release', 'bin', 'centaurai-core'));
    expect(findBinaryInDir(root, ['centaurai-core', 'aioncore'])).toMatchObject({ name: 'centaurai-core' });
  });

  it('requires exactly one matching checksum entry', () => {
    const asset = 'centaurai-core-v0.1.47-x86_64-unknown-linux-gnu.tar.gz';
    expect(parseChecksumFile(`${'a'.repeat(64)}  ${asset}\n`, asset)).toBe('a'.repeat(64));
    expect(() => parseChecksumFile(`${'a'.repeat(64)}  another.tar.gz\n`, asset)).toThrow('exactly one entry');
  });
});
