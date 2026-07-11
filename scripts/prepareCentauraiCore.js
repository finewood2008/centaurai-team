const path = require('node:path');

const { prepareCentauraiCore } = require('../packages/shared-scripts/src/prepare-centaurai-core.js');
const { resolveCentauraiCoreVersion } = require('./resolveCentauraiCoreVersion.js');

const projectRoot = path.resolve(__dirname, '..');
const platform = process.platform;
const arch = process.env.CENTAURAI_CORE_ARCH || process.env.AIONUI_BACKEND_ARCH || process.env.npm_config_target_arch || process.arch;
const version = resolveCentauraiCoreVersion(projectRoot);

function prepare() {
  return prepareCentauraiCore({ projectRoot, platform, arch, version });
}

if (require.main === module) {
  try {
    prepare();
  } catch (error) {
    console.error('prepareCentauraiCore failed:', error.message);
    process.exit(1);
  }
}

module.exports = prepare;
