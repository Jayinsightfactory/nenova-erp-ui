'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { parseGitLog, buildSnapshot, validateSourceGraph } = require('../lib/fullDevelopmentHistory.cjs');

const root = path.resolve(__dirname, '..');
const externalPath = path.join(root, 'data/history-sources/external-development-history.json');
const outputPath = path.join(root, 'data/generated/full-development-history.json');

function git(args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 128 * 1024 * 1024, windowsHide: true }).trim();
}

function run() {
  if (!fs.existsSync(externalPath)) throw new Error('External source manifest missing; run export-external-development-history.cjs first');
  const external = JSON.parse(fs.readFileSync(externalPath, 'utf8'));
  if (external.schemaVersion !== 1 || !Array.isArray(external.sources) || external.sources.length !== 2 || !['mindmap-viewer', 'nenovakakao'].every(id => external.sources.some(source => source.id === id))) throw new Error('Invalid external history manifest');
  for (const source of external.sources) {
    validateSourceGraph(source);
    const expectedRepo = source.id === 'mindmap-viewer' ? 'Jayinsightfactory/mindmap-viewer' : 'Jayinsightfactory/nenovakakao';
    if (source.repo !== expectedRepo || source.ref !== 'main' || !/^[a-f\d]{40}$/i.test(source.headHash || '') || !Number.isFinite(Date.parse(source.collectedAt)) || !Array.isArray(source.records) || !Number.isSafeInteger(source.reachableCount) || source.reachableCount <= 0 || source.records.length !== source.reachableCount || !source.records.some(record => record.hash === source.headHash) || !Array.isArray(source.rootHashes) || !source.rootHashes.length || source.records.some(record => !Array.isArray(record.parents) || record.parents.some(hash => !/^[a-f\d]{40}$/i.test(hash)))) throw new Error(`Invalid external source identity: ${source.id}`);
    const actualRoots = source.records.filter(record => record.parents.length === 0).map(record => record.hash).sort();
    if (JSON.stringify(actualRoots) !== JSON.stringify([...source.rootHashes].sort()) || new Set(source.records.map(record => record.hash)).size !== source.records.length) throw new Error(`Invalid external source graph: ${source.id}`);
  }
  const ref = process.env.FULL_HISTORY_ERP_REF || 'HEAD';
  const headHash = git(['rev-parse', ref]);
  if (!/^[a-f\d]{40}$/i.test(headHash)) throw new Error('ERP source ref is unavailable');
  if (git(['rev-parse', '--is-shallow-repository']) !== 'false') throw new Error('Full ERP Git history is required');
  const raw = execFileSync('git', ['log', ref, '--root', '--diff-merges=first-parent', '--format=%x1e%H%x1f%aI%x1f%cI%x1f%s%x1f%P%x1d', '--name-only', '-z'], { cwd: root, encoding: 'utf8', maxBuffer: 128 * 1024 * 1024, windowsHide: true });
  const current = parseGitLog(raw);
  if (current.length !== Number(git(['rev-list', '--count', ref]))) throw new Error('Incomplete ERP Git export');
  const indexText = execFileSync('git', ['show', `${ref}:docs/work-sessions/INDEX.md`], { cwd: root, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024, windowsHide: true });
  const indexedTitles = new Map();
  for (const match of indexText.matchAll(/^-\s*\[([^\]\r\n]+)\]\((20\d{2}-\d{2}-\d{2}_[\w-]+\.md)\)/gm)) {
    if (match[1].startsWith(match[2].slice(0, 10))) indexedTitles.set(match[2], match[1]);
  }
  const currentSummaries = git(['ls-tree', '-r', '--name-only', ref, 'docs/work-sessions']).split(/\r?\n/)
    .map(name => name.split('/').at(-1)).filter(name => /^20\d{2}-\d{2}-\d{2}_[\w-]+\.md$/.test(name))
    .map((name, index) => ({ id: `work-session-${index}`, date: `${name.slice(0, 10)}T12:00:00+09:00`, title: indexedTitles.get(name) || '제목 미확인 · ERP 작업 문서 · 날짜', titleKnown: indexedTitles.has(name), path: 'docs/work-sessions' }));
  const menuSnapshot = JSON.parse(fs.readFileSync(path.join(root, 'data/generated/menu-development-history.json'), 'utf8'));
  const snapshot = buildSnapshot({ current, currentSummaries, external, menus: menuSnapshot.menus, headHash, ref });
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`);
  process.stdout.write(`Full development history: ${snapshot.counts.uniqueCommits} unique commits, ${snapshot.counts.summaries} summaries -> ${outputPath}\n`);
}

run();
