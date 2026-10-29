const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const ROOT = path.join(process.cwd(), 'data/runtime/hotel-orders');
const fail = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
function scope(owner, year, week) {
  if (typeof owner !== 'string' || !owner || owner.length > 200) throw fail('로그인이 필요합니다.', 401);
  if (!/^20[2-9]\d$|^2100$/.test(String(year)) || !/^(0[1-9]|[1-4]\d|5[0-3])-0[1-4]$/.test(String(week))) throw fail('연도와 차수를 확인하세요.');
  return path.join(createHash('sha256').update(owner).digest('hex'), String(year), week);
}
function validate(work) {
  if (!work || typeof work !== 'object' || Array.isArray(work)) throw fail('초안 형식을 확인하세요.');
  for (const key of ['request', 'purchase', 'pinned', 'receipts', 'history']) if (!Array.isArray(work[key]) || work[key].length > 10000) throw fail('초안 행 수를 확인하세요.');
  if (typeof work.frozen !== 'boolean' || !work.allocations || typeof work.allocations !== 'object') throw fail('초안 상태를 확인하세요.');
  for (const side of ['request','purchase']) {
    const pending=work.pending?.[side], batches=work.batches?.[side];
    if (pending && (!Array.isArray(pending.rows) || pending.rows.length>10000 || !uuid(pending.id))) throw fail('검토 자료를 확인하세요.');
    if (batches !== undefined && (!Array.isArray(batches) || batches.length>10000)) throw fail('저장 자료를 확인하세요.');
    for (const source of [...(pending ? [pending] : []),...(batches || [])]) {
      if (source.imageId && !/^[a-f0-9]{64}\.(png|jpg|gif|webp)$/.test(source.imageId)) throw fail('이미지 번호를 확인하세요.');
    }
  }
  for (const r of [...work.receipts, ...work.history]) {
    if (!r || !Array.isArray(r.items) || !Array.isArray(r.results)) throw fail('등록 내역을 확인하세요.');
  }
  if (Buffer.byteLength(JSON.stringify(work)) > 4 * 1024 * 1024) throw fail('초안은 최대 4MB까지 저장할 수 있습니다.');
}
async function latest(dir) {
  let names; try { names = await fs.readdir(dir); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
  const revision = names.reduce((max, n) => /^\d+\.json$/.test(n) ? Math.max(max, Number(n.slice(0, -5))) : max, 0);
  if (!revision) return null;
  const record = JSON.parse(await fs.readFile(path.join(dir, `${revision}.json`), 'utf8'));
  if (record.revision !== revision || !record.work || !uuid(record.id)) throw fail('서버 저장본을 확인하세요.', 503);
  return record;
}
async function read(owner, year, week, id, { root = ROOT } = {}) {
  const base = scope(owner, year, week); if (!uuid(id)) throw fail('작업 번호를 확인하세요.');
  const record = await latest(path.join(root, base, id));
  if (!record) throw fail('저장된 작업을 찾지 못했습니다.', 404);
  return record;
}
async function list(owner, year, week, { root = ROOT } = {}) {
  const dir = path.join(root, scope(owner, year, week));
  let names; try { names = await fs.readdir(dir); } catch (e) { if (e.code === 'ENOENT') return []; throw e; }
  const records = [];
  for (const id of names.filter(uuid)) {
    const r = await latest(path.join(dir, id));
    if (r) records.push({ id, revision: r.revision, createdAt: r.createdAt, updatedAt: r.updatedAt, frozen: r.work.frozen, requestCount: r.work.request.length, purchaseCount: r.work.purchase.length, receiptCount: r.work.receipts.length });
  }
  return records.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
async function save(owner, input, { root = ROOT } = {}) {
  const { id, work, expectedRevision } = input || {};
  validate(work); const base = scope(owner, work.year, work.week);
  if (!uuid(id) || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw fail('작업 번호와 저장 버전을 확인하세요.');
  const dir = path.join(root, base, id); await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const old = await latest(dir);
  if ((old?.revision ?? 0) !== expectedRevision) throw fail('다른 PC 또는 창에서 저장했습니다. 현재 내용을 다운로드한 뒤 서버 작업을 다시 불러오세요.', 409);
  if (old?.work.frozen) {
    for (const key of ['year', 'week', 'request', 'purchase', 'allocations', 'pinned', 'raum', 'surplus', 'history', 'frozen', 'pending', 'batches', 'omitted', 'orderTotals', 'specialMappings', 'registrationSnapshot', 'quantityHistory']) {
      if (JSON.stringify(old.work[key]) !== JSON.stringify(work[key])) throw fail('등록을 시작한 작업의 원본과 잠금은 변경할 수 없습니다.', 409);
    }
    if (work.receipts.length < old.work.receipts.length) throw fail('등록 내역은 삭제할 수 없습니다.', 409);
    old.work.receipts.forEach((before, i) => {
      const after = work.receipts[i];
      for (const key of ['custKey', 'year', 'week', 'items', 'time']) if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) throw fail('등록 대상은 변경할 수 없습니다.', 409);
      if (before.status === '등록·검증 완료' && (after.status !== before.status || JSON.stringify(after.results) !== JSON.stringify(before.results))) throw fail('완료 결과는 변경할 수 없습니다.', 409);
    });
  }
  const now = new Date().toISOString();
  const record = { id, revision: expectedRevision + 1, createdAt: old?.createdAt || now, updatedAt: now, work };
  const temp = path.join(dir, `${randomUUID()}.tmp`), target = path.join(dir, `${record.revision}.json`);
  try {
    const handle = await fs.open(temp, 'wx', 0o600);
    try { await handle.writeFile(JSON.stringify(record)); await handle.sync(); } finally { await handle.close(); }
    // Exclusive atomic publication: competing processes cannot overwrite this revision.
    try { await fs.link(temp, target); } catch (e) { if (e.code === 'EEXIST') throw fail('다른 PC에서 먼저 저장했습니다. 서버 작업을 다시 불러오세요.', 409); throw e; }
    if (process.platform !== 'win32') {
      const directory = await fs.open(dir, 'r');
      try { await directory.sync(); } finally { await directory.close(); }
    }
  } finally { await fs.unlink(temp).catch(e => { if (e.code !== 'ENOENT') throw e; }); }
  return record;
}
module.exports = { read, list, save };
