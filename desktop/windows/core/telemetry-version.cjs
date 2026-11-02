// Single source of truth: package.json → nvu.pluginVersion (also stamped into the plugin by build-plugin.cjs).
const pkg = require('../package.json');
module.exports = { TELEMETRY_PLUGIN_VERSION: pkg.nvu.pluginVersion };
