// Metro, taught about the monorepo. Identical in intent to
// `apps/business/metro.config.js`; see that file for why each line is required.
//
//   `watchFolders` — the workspace root, so edits in `packages/ui` and
//   `packages/api` trigger a reload.
//   `nodeModulesPaths` — this app first, then the root, because npm workspaces
//   hoist most dependencies and leave only conflicts local.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules')
];

module.exports = config;
