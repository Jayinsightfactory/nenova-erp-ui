#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '../..');
const SOURCE_PATH = path.join(REPO_ROOT, 'components', 'Layout.js');
const OUTPUT_PATH = path.join(REPO_ROOT, 'desktop', 'menu.json');

// Read only simple object literals from the canonical MENU_ITEMS source. This
// deliberately does not import, evaluate, or execute Layout.js.
function parseMenuSource(source) {
  const groups = [];
  let current = null;
  for (const line of source.split(/\r?\n/)) {
    const groupMatch = line.match(/^\s*group:\s*(['"])(.*?)\1\s*,?\s*$/);
    if (groupMatch) {
      current = { group: groupMatch[2], items: [] };
      groups.push(current);
      continue;
    }
    if (!current || !/\bhref\s*:/.test(line) || !/\blabelKey\s*:/.test(line)) continue;

    // Restricted items are omitted entirely from the desktop catalog. This
    // includes computed userIds expressions, which are intentionally not parsed.
    if (/\buserIds\s*:/.test(line)) continue;
    const href = line.match(/\bhref\s*:\s*(['"])(.*?)\1/);
    const label = line.match(/\blabelKey\s*:\s*(['"])(.*?)\1/);
    const popup = line.match(/\bpopup\s*:\s*(true|false)\b/);
    if (!href || !label || !popup) continue;
    const route = href[2];
    if (!route.startsWith('/') || route.startsWith('//') || /[\r\n]/.test(route)) continue;
    current.items.push({ href: route, labelKey: label[2], popup: popup[1] === 'true' });
  }
  return groups.filter(group => group.items.length > 0);
}

function generateMenu({ sourcePath = SOURCE_PATH, outputPath = OUTPUT_PATH } = {}) {
  const source = fs.readFileSync(sourcePath, 'utf8');
  const groups = parseMenuSource(source);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(groups, null, 2)}\n`, 'utf8');
  return groups;
}

if (require.main === module) {
  const groups = generateMenu();
  console.log(`Wrote ${groups.reduce((n, group) => n + group.items.length, 0)} menu items to ${OUTPUT_PATH}`);
}

module.exports = { parseMenuSource, generateMenu };
