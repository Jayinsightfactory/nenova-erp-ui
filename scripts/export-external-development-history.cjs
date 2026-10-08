'use strict';

// Main-operator refresh only. No network, checkout, SQL, or application mutations.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { sanitizeText, isSafePath } = require('../lib/fullDevelopmentHistory.cjs');
const sourceRoot = process.argv[2];
if (!sourceRoot || !path.isAbsolute(sourceRoot)) throw new Error('Supply the absolute prepared history-sources directory');
const output = path.resolve(__dirname, '../data/history-sources/external-development-history.json');
const specs = [
  { id: 'mindmap-viewer', label: 'MindMap · Orbit', repo: 'Jayinsightfactory/mindmap-viewer', ref: 'main' },
  { id: 'nenovakakao', label: '네노바 카카오 수집 도구', repo: 'Jayinsightfactory/nenovakakao', ref: 'main' },
];
const collectedAt = new Date().toISOString();
const sources = specs.map(spec => {
  const cwd = path.join(sourceRoot, spec.id);
  const git = args => execFileSync('git', ['-c', 'core.quotepath=false', ...args], {
    cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 120000,
  });
  if (git(['rev-parse', '--is-shallow-repository']).trim() !== 'false') throw new Error(`${spec.id}: full history required`);
  const headHash = git(['rev-parse', spec.ref]).trim();
  const raw = git(['log', spec.ref, '--root', '--diff-merges=first-parent', '--name-only', '--format=%x1e%H%x1f%aI%x1f%cI%x1f%P%x1f%s%x1d']);
  const records = raw.split('\x1e').filter(Boolean).map(record => {
    const boundary = record.indexOf('\x1d');
    if (boundary < 0) throw new Error('Invalid Git metadata record');
    const header = record.slice(0, boundary).trimStart().split('\x1f');
    if (header.length !== 5 || !/^[a-f0-9]{40}$/.test(header[0])) throw new Error('Invalid Git metadata header');
    const changedPaths = record.slice(boundary + 1).split(/\r?\n/).filter(Boolean);
    const safePaths = changedPaths.filter(isSafePath);
    return { hash: header[0], date: header[1], committedAt: header[2], parents: header[3].split(' ').filter(Boolean),
      subject: sanitizeText(header[4]), paths: safePaths,
      changedFileCount: changedPaths.length, redactedPathCount: changedPaths.length - safePaths.length };
  });
  const expected = Number(git(['rev-list', '--count', spec.ref]).trim());
  if (records.length !== expected) throw new Error(`${spec.id}: incomplete export ${records.length}/${expected}`);
  const summaries = [];
  const files = git(['ls-tree', '-r', '--name-only', spec.ref]).trim().split(/\r?\n/);
  for (const file of files.filter(p => /^(?:WORK_MEMORY\.md|PROGRESS\.md|WORK-SUMMARY-[^/]+\.(?:md|txt))$/.test(p))) {
    const body = git(['show', `${spec.ref}:${file}`]);
    let index = 0;
    for (const line of body.split(/\r?\n/)) {
      const match = line.match(/^#{1,3}\s+((20\d{2}-\d{2}-\d{2})[^\r\n]*)$/);
      if (!match) continue;
      const date = `${match[2]}T12:00:00+09:00`;
      if (!Number.isFinite(Date.parse(date))) continue;
      summaries.push({ id: `${spec.id}:${file}:${++index}`, date, title: sanitizeText(match[1]), path: file });
    }
  }
  return { ...spec, headHash, collectedAt, reachableCount: expected,
    rootHashes: records.filter(record => record.parents.length === 0).map(record => record.hash).sort(), records, summaries };
});
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, JSON.stringify({ schemaVersion: 1, generatedAt: collectedAt, sources }));
process.stdout.write(`${sources.map(source => `${source.id}: ${source.records.length} commits / ${source.summaries.length} dated summaries`).join('\n')}\n`);
