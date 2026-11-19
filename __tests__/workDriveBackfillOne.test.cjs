'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const script = path.resolve(__dirname, '../scripts/work-drive-backfill-web-uploads.mjs');
const bytes = Buffer.from('%PDF-1.7\n' + 'fixture'.repeat(200));
const sha = createHash('sha256').update(bytes).digest('hex');

function fixture(t, rows = [], recordPatch = {}) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'work-drive-backfill-one-'));
  t.after(() => {
    assert.equal(path.dirname(cwd), os.tmpdir());
    fs.rmSync(cwd, { recursive: true, force: true });
  });
  const index = path.join(cwd, 'data', 'drive', 'index.jsonl');
  fs.mkdirSync(path.dirname(index), { recursive: true });
  fs.writeFileSync(index, rows.map(row => JSON.stringify(row)).join('\n'));
  const source = path.join(cwd, 'data', 'runtime', 'import-team', 'packing-uploads');
  const records = path.join(source, 'records');
  fs.mkdirSync(records, { recursive: true });
  fs.mkdirSync(path.join(source, 'files'), { recursive: true });
  const sourceFile = path.join(source, 'files', sha);
  fs.writeFileSync(sourceFile, bytes);
  fs.writeFileSync(path.join(records, 'fixture.json'), JSON.stringify({
    actor: 'nenovaIC4', at: '2026-11-13T00:00:00.000Z', sourceHash: sha,
    snapshot: { fileName: '47-1 Packing Fixture.pdf' }, ...recordPatch,
  }));
  const run = (...args) => {
    const result = spawnSync(process.execPath, [script, `--sha=${sha}`, ...args], { cwd, encoding: 'utf8' });
    assert.equal(result.stderr, '');
    assert.deepEqual(Object.keys(JSON.parse(result.stdout)), ['status']);
    return JSON.parse(result.stdout).status;
  };
  return { cwd, index, records, run, sourceFile };
}

test('single-file dry run preserves the index and actual ingest retains original uploader', (t) => {
  const { index, run } = fixture(t);
  assert.equal(run(), 'ready');
  assert.equal(fs.readFileSync(index, 'utf8'), '');
  assert.equal(run('--apply'), 'restored');
  const stored = JSON.parse(fs.readFileSync(index, 'utf8'));
  assert.equal(stored.sha, sha);
  assert.equal(stored.dept, '수입부');
  assert.notEqual(stored.uploaderName, stored.hostname);
  assert.equal(stored.source, 'import/packing-list');
  assert.equal(run('--apply'), 'already-indexed');
});

test('protected, ambiguous and corrupt sources cannot append an index row', (t) => {
  assert.equal(fixture(t, [{ sha, deleted: true }]).run('--apply'), 'protected-index-entry');
  assert.equal(fixture(t, [{ sha, egressSnapshot: true }]).run('--apply'), 'protected-index-entry');
  assert.equal(fixture(t, [], { actor: 'unknown' }).run('--apply'), 'ownership-unverified');
  const ambiguous = fixture(t);
  const original = JSON.parse(fs.readFileSync(path.join(ambiguous.records, 'fixture.json'), 'utf8'));
  fs.writeFileSync(path.join(ambiguous.records, 'other.json'), JSON.stringify({
    ...original, snapshot: { fileName: '47-1 Packing Other.pdf' },
  }));
  assert.equal(ambiguous.run('--apply'), 'ownership-unverified');
  assert.equal(fs.readFileSync(ambiguous.index, 'utf8'), '');
  assert.equal(fixture(t, [], { snapshot: { fileName: '47-1 Invoice Fixture.pdf' } }).run('--apply'), 'access-unverified');
  const { index, run, sourceFile } = fixture(t);
  fs.appendFileSync(sourceFile, 'changed');
  assert.equal(run('--apply'), 'invalid-source');
  assert.equal(fs.readFileSync(index, 'utf8'), '');
});

test('public workflow audit emits counts only and leaves archived and index files unchanged', (t) => {
  const { cwd, index, records, sourceFile } = fixture(t);
  const recordFile = path.join(records, 'fixture.json');
  const original = fs.readFileSync(recordFile);
  const out = spawnSync(process.execPath, [script, '--audit'], { cwd, encoding: 'utf8' });
  assert.equal(out.status, 0);
  assert.equal(out.stderr, '');
  assert.deepEqual(JSON.parse(out.stdout), {
    status: 'audited', records: 1, uniqueSources: 1,
    states: { 'already-indexed': 0, 'protected-index-entry': 0, ready: 1,
      'ownership-unverified': 0, 'access-unverified': 0, 'invalid-source': 0, unverified: 0 },
  });
  assert.equal(fs.readFileSync(index, 'utf8'), '');
  assert.deepEqual(fs.readFileSync(recordFile), original);
  assert.deepEqual(fs.readFileSync(sourceFile), bytes);
});
