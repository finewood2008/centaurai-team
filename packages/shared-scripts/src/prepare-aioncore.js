const { prepareCentauraiCore } = require('./prepare-centaurai-core.js');

// Compatibility export for downstream build scripts during the migration.
module.exports = {
  prepareAioncore: prepareCentauraiCore,
  prepareCentauraiCore,
};
