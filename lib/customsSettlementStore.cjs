// File-only evidence ledger. A failed parse/read never becomes an empty ledger.
const fs = require('node:fs/promises');
const syncFs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { randomUUID, createHash } = require('node:crypto');
const { scopeOf, hash, receiptKey,receiptFingerprint,validateReceipt } = require('./customsSettlementPlan.cjs');
const ROOT = path.join(process.cwd(), 'data/runtime/customs-settlement');
function scopePath(root, year, major) { const s = scopeOf(year, major); return path.join(root, `${s.year}-${s.major}.json`); }
function validateLedger(value, year, major) {
  const scope = scopeOf(year, major);
  if (value?.version !== 1 || value.year !== scope.year || value.major !== scope.major || !Number.isSafeInteger(value.revision) || value.revision < 0 || !Array.isArray(value.documents) || !value.values || typeof value.values !== 'object' || !Array.isArray(value.history)) throw Error('invalid settlement scope/schema');
  for (const [key, fields] of Object.entries(value.values)) if (!/^(?:country\|[^|]+\|0[12]|colombia\|\d{2}-\d{2})$/.test(key) || !fields || Object.entries(fields).some(([f, n]) => !/^(?:Customs[12]_[123]|SunYul[12]_[123]|CustomsFee|HandlingFee|ActualQuarantineAgencyFee)$/.test(f) || !Number.isSafeInteger(n) || n < 0)) throw Error('invalid settlement fields');
  const ids=new Set();
  const expected={};
  for(const doc of value.documents){
    validateReceipt(doc);const key=receiptKey(doc);if(ids.has(key)||doc.fingerprint!==receiptFingerprint(doc)||doc.date.slice(0,4)!==scope.year||!Object.prototype.hasOwnProperty.call(value.values,doc.targetKey)||doc.matchedOrderWeek&&!String(doc.matchedOrderWeek).startsWith(`${scope.major}-`))throw Error('invalid settlement document scope');ids.add(key);
    const [kind,category,phase]=doc.targetKey.split('|');expected[doc.targetKey]||={};
    for(const c of doc.charges){if(c.code==='IMPORT_VAT')continue;let field,amount;
      if(kind==='country'){field=c.code==='DUTY'?`Customs${Number(phase)}`:['HANDLING','QUARANTINE_AGENCY'].includes(c.code)?`SunYul${Number(phase)}`:null;amount=c.code==='DUTY'||category!=='베트남'?c.total:c.net;}
      else {field=({DUTY:'CustomsFee',HANDLING:'HandlingFee',QUARANTINE_AGENCY:'ActualQuarantineAgencyFee'})[c.code];amount=c.code==='DUTY'?c.total:c.net;}
      if(!field)throw Error('invalid settlement charge');expected[doc.targetKey][field]=(expected[doc.targetKey][field]||0)+amount;
    }
  }
  for(const key of Object.keys(value.values))if(key.startsWith('colombia|')&&!key.startsWith(`colombia|${scope.major}-`))throw Error('invalid settlement target scope');
  const actual={};for(const [target,fields] of Object.entries(value.values)){actual[target]={};for(const [field,amount] of Object.entries(fields)){const total=field.replace(/_[123]$/,'');actual[target][total]=(actual[target][total]||0)+amount;}}
  const canonical=v=>JSON.stringify(Object.keys(v).sort().map(k=>[k,Object.entries(v[k]).sort(([a],[b])=>a.localeCompare(b))]));
  if(canonical(actual)!==canonical(expected))throw Error('settlement document/value totals differ');
  if(value.contentDigest){const {contentDigest,...body}=value;if(hash(body)!==contentDigest)throw Error('settlement content digest differs');}
  return value;
}
async function readLedger(root, year, major) {
  try { return validateLedger(JSON.parse(await fs.readFile(scopePath(root, year, major), 'utf8')), year, major); }
  catch (error) { if (error.code === 'ENOENT') return { version: 1, ...scopeOf(year, major), revision: 0, documents: [], values: {}, history: [] }; throw Object.assign(Error('통관 연결 이력을 읽지 못했습니다. 자동 초기화하지 않습니다.'), { statusCode: 503,code:'SETTLEMENT_LEDGER_INVALID' }); }
}
async function withStoreLock(root, fn) {
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  const key = createHash('sha256').update(path.resolve(root)).digest('hex').slice(0, 24);
  const address = process.platform === 'win32' ? `\\\\.\\pipe\\nenova-settlement-${key}` : `\0nenova-settlement-${key}`;
  const server = net.createServer(socket => socket.destroy());
  await new Promise((resolve, reject) => { server.once('error', () => reject(Object.assign(Error('통관 연결 저장소가 사용 중입니다. 다시 검토하세요.'), { statusCode: 409 }))); server.listen({ path: address, exclusive: true }, resolve); });
  try { return await fn(); } finally { await new Promise(resolve => server.close(resolve)); }
}
async function writeAtomic(filename, value) {
  const temp = `${filename}.${randomUUID()}.tmp`;
  try { const handle = await fs.open(temp, 'wx', 0o600); try { await handle.writeFile(JSON.stringify(value)); await handle.sync(); } finally { await handle.close(); } await fs.rename(temp, filename); }
  finally { await fs.unlink(temp).catch(() => {}); }
}
async function applySettlementPlan({ root = ROOT, year, major, expectedDigest, confirmed, approveConflicts = false, actor, makePlan }) {
  if (confirmed !== true || typeof expectedDigest !== 'string') throw Object.assign(Error('연결할 비용을 명시적으로 확인하세요.'), { statusCode: 400 });
  return withStoreLock(root, async () => {
    const ledger = await readLedger(root, year, major);
    const plan = await makePlan(ledger);
    if (plan.planDigest !== expectedDigest) throw Object.assign(Error('입고·기존 입력·연결 이력이 바뀌었습니다. 다시 검토하세요.'), { statusCode: 409 });
    const blocking = plan.issues.filter(i => !approveConflicts || !['SAVED_VALUE_CONFLICT','ITEM_COUNT_CONFLICT'].includes(i.code));
    if (blocking.length) throw Object.assign(Error('충돌 또는 확인하지 못한 비용이 있습니다.'), { statusCode: 422 });
    if (!plan.documents.some(d => d.status === 'new')) return { applied: false, duplicate: true, plan };
    const values = structuredClone(ledger.values);
    for (const row of plan.patches) { values[row.targetKey] ||= {}; values[row.targetKey][row.field] = row.amount; }
    const documents = [...ledger.documents];
    for (const receipt of plan.documents.filter(r => r.status === 'new')) if (!documents.some(r => receiptKey(r) === receiptKey(receipt))) documents.push(receipt);
    const event = { id: randomUUID(), at: new Date().toISOString(), actorHash: hash(String(actor)), planDigest: plan.planDigest, approveConflicts: approveConflicts === true, documentCount: plan.documents.filter(r => r.status === 'new').length };
    const next = { version: 1, ...scopeOf(year, major), revision: ledger.revision + 1, documents, values, history: [...ledger.history, event] };
    next.contentDigest=hash(next);
    validateLedger(next, year, major);
    await writeAtomic(scopePath(root, year, major), next);
    const readback = await readLedger(root, year, major);
    if (hash(readback) !== hash(next)) throw Object.assign(Error('연결 결과 확인이 필요합니다. 다시 적용하지 말고 이력을 조회하세요.'), { statusCode: 503 });
    return { applied: true, revision: next.revision, documentCount: event.documentCount, erpWrites: 0, reportWrites: 0 };
  });
}
function readOverlaySync(year, major, { root = ROOT } = {}) {
  const filename = scopePath(root, year, major);
  try { return validateLedger(JSON.parse(syncFs.readFileSync(filename, 'utf8')), year, major).values; }
  catch (error) { if (error.code === 'ENOENT') return {}; throw Error('통관 실비 연결 파일을 읽지 못했습니다.'); }
}
module.exports = { ROOT, readLedger, withStoreLock, writeAtomic, applySettlementPlan, readOverlaySync, validateLedger };
