const fs = require('node:fs');
const path = require('node:path');

const { assertExactReleaseTag } = require('../packages/shared-scripts/src/core-artifact-config.js');

function resolveCentauraiCoreVersion(projectRoot, env = process.env) {
  const envOverride = env.CENTAURAI_CORE_VERSION?.trim() || env.AIONUI_BACKEND_VERSION?.trim();
  if (envOverride) return assertExactReleaseTag(envOverride);

  const packagePath = path.join(projectRoot, 'package.json');
  let packageJson;
  try {
    packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  } catch (error) {
    throw new Error(`Cannot read CentaurAI Core version from ${packagePath}: ${error.message}`);
  }

  const pinnedVersion = packageJson.centauraiCoreVersion?.trim() || packageJson.aioncoreVersion?.trim();
  if (!pinnedVersion) {
    throw new Error(`package.json must define an exact centauraiCoreVersion; latest is not allowed`);
  }
  return assertExactReleaseTag(pinnedVersion);
}

module.exports = { resolveCentauraiCoreVersion };
