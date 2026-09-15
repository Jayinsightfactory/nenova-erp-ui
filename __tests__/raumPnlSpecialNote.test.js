const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const value = (params, name) => params?.[name]?.value;

function noteDb(seed = []) {
  const rows = new Map(seed.map(row => [`${row.PartnerCode}|${row.OrderYear}`, { ...row }]));
  const calls = [];
  let revisionNumber = 1;
  const nextRevision = () => `00000000-0000-4000-8000-${String(revisionNumber++).padStart(12, '0')}`;
  const tQuery = async (statement, params = {}) => {
    calls.push({ statement, params });
    if (statement.includes('OBJECT_ID')) return { recordset: [{ Ready: 1 }] };
    const key = `${value(params, 'partnerCode')}|${value(params, 'orderYear')}`;
    if (statement.includes('FROM dbo.WebRaumPnlSpecialNote')) return { recordset: rows.has(key) ? [{ ...rows.get(key) }] : [] };
    if (statement.includes('INSERT INTO dbo.WebRaumPnlSpecialNote')) {
      const row = { PartnerCode: value(params, 'partnerCode'), OrderYear: value(params, 'orderYear'), NoteText: value(params, 'noteText'), Revision: nextRevision(), UpdatedAt: '2026-09-15T00:00:00.000Z', UpdatedBy: value(params, 'actor') };
      rows.set(key, row); return { recordset: [{ ...row }] };
    }
    if (statement.includes('UPDATE dbo.WebRaumPnlSpecialNote')) {
      const row = { ...rows.get(key), NoteText: value(params, 'noteText'), Revision: nextRevision(), UpdatedAt: '2026-09-15T00:01:00.000Z', UpdatedBy: value(params, 'actor') };
      rows.set(key, row); return { recordset: [{ ...row }] };
    }
    throw new Error(`unexpected SQL: ${statement}`);
  };
  return { rows, calls, tQuery, runTransaction: fn => fn(tQuery) };
}

async function main() {
  const policy = await import('../lib/raumPnlSpecialNotePolicy.js');
  const store = await import('../lib/raumPnlSpecialNote.js');

  assert.equal(policy.normalizePnlSpecialNoteYear(' 2026 '), '2026');
  assert.throws(() => policy.normalizePnlSpecialNoteYear('26'), error => error.code === 'PNL_SPECIAL_NOTE_YEAR_INVALID');
  assert.equal(policy.normalizePnlSpecialNoteText('첫 줄\r\n둘째 줄'), '첫 줄\n둘째 줄');
  assert.throws(() => policy.normalizePnlSpecialNoteText('가'.repeat(5001)), error => error.code === 'PNL_SPECIAL_NOTE_TOO_LONG');

  const db = noteDb();
  const empty = await store.loadPnlSpecialNote({ partnerCode: 'shilla', orderYear: 2026 }, db.tQuery);
  assert.deepEqual(empty, { partnerCode: 'shilla', orderYear: '2026', text: '', revision: null, updatedAt: null, updatedBy: '' });

  const created = await store.savePnlSpecialNote({ partnerCode: 'shilla', orderYear: 2026, text: '15차 호접은 무상 입고', expectedRevision: null, actor: '임재용' }, { runTransaction: db.runTransaction });
  assert.equal(created.changed, true);
  assert.equal(created.note.text, '15차 호접은 무상 입고');
  assert.equal(created.note.updatedBy, '임재용');
  assert.match(created.note.revision, /^[0-9a-f-]{36}$/);

  const unchanged = await store.savePnlSpecialNote({ partnerCode: 'shilla', orderYear: 2026, text: created.note.text, expectedRevision: created.note.revision, actor: '다른담당자' }, { runTransaction: db.runTransaction });
  assert.equal(unchanged.changed, false, '같은 내용은 버전과 수정자를 불필요하게 바꾸지 않는다.');
  assert.equal(unchanged.note.updatedBy, '임재용');

  await assert.rejects(
    store.savePnlSpecialNote({ partnerCode: 'shilla', orderYear: 2026, text: '덮어쓰기', expectedRevision: null, actor: '다른담당자' }, { runTransaction: db.runTransaction }),
    error => error.code === 'PNL_SPECIAL_NOTE_STALE' && error.statusCode === 409,
  );

  const updated = await store.savePnlSpecialNote({ partnerCode: 'shilla', orderYear: 2026, text: '31차 합계 제외행 확인', expectedRevision: created.note.revision, actor: '정재훈' }, { runTransaction: db.runTransaction });
  assert.equal(updated.note.text, '31차 합계 제외행 확인');
  assert.notEqual(updated.note.revision, created.note.revision);

  const otherYear = await store.loadPnlSpecialNote({ partnerCode: 'shilla', orderYear: 2025 }, db.tQuery);
  const otherPartner = await store.loadPnlSpecialNote({ partnerCode: 'raum', orderYear: 2026 }, db.tQuery);
  assert.equal(otherYear.text, '', '전년도 동일 거래처 메모를 섞지 않는다.');
  assert.equal(otherPartner.text, '', '같은 연도 다른 거래처 메모를 섞지 않는다.');

  const source = read('lib/raumPnlSpecialNote.js');
  const api = read('pages/api/raum/pnl-notes.js');
  const migration = read('docs/migrations/2026-09-15_pnl_special_notes.sql');
  for (const forbidden of ['OrderDetail', 'ShipmentDetail', 'ProductStock', 'StockHistory', 'Estimate', 'WebProfitReport']) {
    assert.doesNotMatch(source, new RegExp(`(?:INSERT\\s+INTO|UPDATE|DELETE\\s+FROM)\\s+(?:dbo\\.)?${forbidden}`, 'i'));
  }
  assert.doesNotMatch(source, /CREATE\s+TABLE|ALTER\s+TABLE/i, '런타임 GET/PUT은 스키마를 만들지 않는다.');
  assert.match(migration, /PRIMARY KEY \(PartnerCode, OrderYear\)/);
  assert.match(source, /WITH \(UPDLOCK, HOLDLOCK\)/);
  assert.match(source, /currentRevision !== revision/);
  assert.match(api, /withAuth/);
  assert.match(api, /requirePnlPartner\(req\.query\.partner\)/);
  assert.match(api, /requirePnlPartner\(req\.body\?\.partner\)/);
  assert.match(api, /req\.user\?\.userName \|\| req\.user\?\.userId/);
  assert.match(read('.github/workflows/deploy.yml'), /apply-pnl-special-notes-migration\.mjs --apply \|\| exit 1/);
  console.log('Raum P&L partner/year special-note store contract passed');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
