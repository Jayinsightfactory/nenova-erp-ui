'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { extractMenuItems, parseGitLog, buildSnapshot } = require('../lib/menuDevelopmentHistory.cjs');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'data/generated/menu-development-history.json');
const layout = fs.readFileSync(path.join(root, 'components/Layout.js'), 'utf8');
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'config/menu-development-history.json'), 'utf8'));
const menus = extractMenuItems(layout);

function git(args) {
  return execFileSync('git', ['-c', 'core.quotepath=false', ...args], { cwd: root, encoding: 'utf8', timeout: 120000, maxBuffer: 32 * 1024 * 1024 });
}

let snapshot;
try {
  const headHash = git(['rev-parse', 'HEAD']).trim();
  const isShallow = git(['rev-parse', '--is-shallow-repository']).trim() === 'true';
  const raw = git(['log', '--first-parent', '--root', '--diff-merges=first-parent', '-M', '--name-status', '--pretty=format:%x1e%H%x1f%aI%x1f%s%x1f%b%x1d']);
  snapshot = buildSnapshot({ menus, commits: parseGitLog(raw), catalog, headHash, isShallow });
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  if (!fs.existsSync(output)) throw new Error('Git unavailable and no tracked menu history snapshot exists');
  snapshot = JSON.parse(fs.readFileSync(output, 'utf8'));
  snapshot.sourceStatus = 'tracked-fallback';
  snapshot.coverageNote = `${snapshot.coverageNote} 이 빌드에는 Git이 없어 저장소에 포함된 생성 시점의 스냅샷을 사용합니다.`;
}

fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, JSON.stringify(snapshot));
process.stdout.write(`Menu development history: ${snapshot.menus.length} menus, ${snapshot.uniqueCommitCount} unique commits (${snapshot.sourceStatus})\n`);
