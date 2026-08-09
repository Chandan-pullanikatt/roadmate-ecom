// Metro, taught about the monorepo.
//
// Two settings, both required and neither optional:
//
//   `watchFolders` — the workspace root, so edits in `packages/ui` and
//   `packages/api` trigger a reload. Without it Metro watches only this app and
//   shared-package changes appear to do nothing.
//
//   `nodeModulesPaths` — this app's `node_modules` first, then the root's, since
//   npm workspaces hoist most dependencies to the root and leave only conflicts
//   local. Without it Metro cannot resolve React from a hoisted install.
//
// `disableHierarchicalLookup` is deliberately left off: the shared packages ship
// uncompiled source and resolve their own peers upward.
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
