#!/usr/bin/env node
'use strict';

const path = require('node:path');
const { verifyReleaseStage } = require('../lib/desktopReleases.cjs');

const dir = process.argv[2];
if (!dir) {
  console.error('usage: node scripts/verify-desktop-release-stage.cjs <stage-dir>');
  process.exit(2);
}

try {
  const meta = verifyReleaseStage(path.resolve(dir));
  console.log(`VERIFIED_DESKTOP_RELEASE version=${meta.version} file=${meta.url} size=${meta.size}`);
} catch (err) {
  console.error(`DESKTOP_RELEASE_INVALID: ${err.message}`);
  process.exit(1);
}
