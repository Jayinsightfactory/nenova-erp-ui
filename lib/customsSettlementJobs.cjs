const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { ROOT, withStoreLock, writeAtomic } = require('./customsSettlementStore.cjs');
const { scopeOf, hash } = require('./customsSettlementPlan.cjs');
const { inspectSettlementZip } = require('./customsSettlementZip.cjs');
const { parseSettlementPage } = require('./customsSettlementParser.cjs');
const JOB_ROOT = path.join(ROOT, 'jobs');
const validId = id => typeof id === 'string' && /^[a-f0-9-]{36}$/.test(id);
const jobPath = (root, id) => { if (!validId(id)) throw Object.assign(Error('작업번호를 확인하세요.'), { statusCode: 400 }); return path.join(root, `${id}.json`); };
function rawPath(root, id, sourceHash) { jobPath(root, id); if (!/^[a-f0-9]{64}$/.test(sourceHash)) throw Error('Invalid source hash'); return path.join(root, id, `${sourceHash}.pdf`); }
const readJob = async (root, id) => { try { return JSON.parse(await fs.readFile(jobPath(root, id), 'utf8')); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } };
const publicJob = row => ({ jobId: row.jobId, year: row.year, major: row.major, registration:row.registration||null,status: Date.now() - row.createdAt >= 7200000 && row.status === 'QUEUED' ? 'EXPIRED' : row.status, total: row.files.length, completed: row.files.filter(f => ['READY', 'REVIEW'].includes(f.status)).length, files: row.files.map(({ sourceHash, hint, status, receipt, error, pageCount }) => ({ sourceHash, hint, status, ...(receipt ? { receipt } : {}), ...(error ? { error } : {}), ...(pageCount ? { pageCount } : {}) })), erpWrites: 0, providerCalls: 0 });
async function expireOrRecover(root, row) {
  const now = Date.now(); let changed = false;
  if (row.status === 'QUEUED' && now - row.createdAt >= 7200000) {
    for (const f of row.files) await fs.unlink(rawPath(root, row.jobId, f.sourceHash)).catch(e => { if (e.code !== 'ENOENT') throw e; });
    row.status = 'EXPIRED'; row.files = row.files.map(({ claimToken, claimedAt, ...f }) => ({ ...f, status: f.status === 'READY' ? 'READY' : 'REVIEW', error: f.status === 'READY' ? undefined : '만료 — 같은 ZIP을 다시 선택하세요.' })); changed = true;
  } else for (const f of row.files) if (f.status === 'RUNNING' && now - f.claimedAt > 300000) {
    f.status=(f.attempts||0)>=3?'REVIEW':'QUEUED';
    if(f.status==='REVIEW'){f.error='OCR 워커 반복 중단 — 같은 ZIP을 다시 올리기 전에 연결을 확인하세요.';await fs.unlink(rawPath(root,row.jobId,f.sourceHash)).catch(e=>{if(e.code!=='ENOENT')throw e;});}
    delete f.claimToken; delete f.claimedAt; changed = true;
  }
  if(row.status==='QUEUED'&&row.files.every(f=>['READY','REVIEW'].includes(f.status))){row.status='REVIEW_READY';changed=true;}
  if (changed) await writeAtomic(jobPath(root, row.jobId), row);
  return row;
}
async function createSettlementJob(uid, { year, major, zipBase64 }, { root = JOB_ROOT } = {}) {
  const scope = scopeOf(year, major);
  if (!uid || typeof zipBase64 !== 'string' || zipBase64.length > 35 * 1024 * 1024 || !/^[A-Za-z0-9+/]+={0,2}$/.test(zipBase64)) throw Object.assign(Error('25MiB 이하 ZIP을 선택하세요.'), { statusCode: 400 });
  const zip = await inspectSettlementZip(Buffer.from(zipBase64, 'base64'));
  return withStoreLock(root, async () => {
    const records = [];
    for (const name of await fs.readdir(root)) if (/^[a-f0-9-]{36}\.json$/.test(name)) { const row = await readJob(root, name.slice(0, -5)); if (row) records.push(await expireOrRecover(root, row)); }
    const ownerHash = hash(uid);
    const existing = records.find(r => r.ownerHash === ownerHash && r.sourceHash === zip.sourceHash && r.year === scope.year && r.major === scope.major && Date.now() - r.createdAt < 86400000 && (r.status === 'QUEUED' || r.status === 'REVIEW_READY' && r.files.every(f => f.status === 'READY')));
    if (existing) return publicJob(existing);
    if (records.filter(r => r.status === 'QUEUED' && Date.now() - r.createdAt < 7200000).length >= 3) throw Object.assign(Error('정산 OCR 대기 작업이 많습니다. 잠시 후 다시 시도하세요.'), { statusCode: 429 });
    const row = { ...scope, jobId: randomUUID(), ownerHash, sourceHash: zip.sourceHash, createdAt: Date.now(), status: 'QUEUED', files: zip.files.map(f => ({ sourceHash: f.sourceHash, hint: f.hint, status: 'QUEUED' })) };
    await fs.mkdir(path.join(root, row.jobId), { mode: 0o700 });
    try {
      for (const source of zip.files) await fs.writeFile(rawPath(root, row.jobId, source.sourceHash), source.bytes, { flag: 'wx', mode: 0o600 });
      await writeAtomic(jobPath(root, row.jobId), row);
    } catch (e) { for (const source of zip.files) await fs.unlink(rawPath(root, row.jobId, source.sourceHash)).catch(()=>{}); await fs.rmdir(path.join(root, row.jobId)).catch(()=>{}); throw e; }
    return publicJob(row);
  });
}
async function getSettlementJob(uid, id, { root = JOB_ROOT } = {}) {
  const row = await readJob(root, id);
  if (!row || row.ownerHash !== hash(uid) || Date.now() - row.createdAt > 86400000) return null;
  return publicJob(row);
}
async function claimSettlementJob({ root = JOB_ROOT } = {}) {
  return withStoreLock(root, async () => {
    for (const name of (await fs.readdir(root)).sort()) {
      if (!/^[a-f0-9-]{36}\.json$/.test(name)) continue;
      let row = await readJob(root, name.slice(0, -5));
      if (row) row = await expireOrRecover(root, row);
      if (!row || row.status !== 'QUEUED') continue;
      const index = row.files.findIndex(f => f.status === 'QUEUED');
      if (index < 0) continue;
      const file = row.files[index]; file.status = 'RUNNING'; file.claimToken = randomUUID(); file.claimedAt = Date.now();file.attempts=(file.attempts||0)+1;
      const bytes = await fs.readFile(rawPath(root, row.jobId, file.sourceHash));
      if (bytes.length > 12 * 1024 * 1024 || require('node:crypto').createHash('sha256').update(bytes).digest('hex') !== file.sourceHash) throw Object.assign(Error('정산 PDF 원본 지문이 다릅니다.'), { statusCode: 409 });
      await writeAtomic(jobPath(root, row.jobId), row);
      return { jobId: row.jobId, index, sourceHash: file.sourceHash, claimToken: file.claimToken, pdfBase64: bytes.toString('base64'), firstPageOnly: true };
    }
    return null;
  });
}
async function finishSettlementJob({ jobId, index, sourceHash, claimToken, result, error }, { root = JOB_ROOT } = {}) {
  return withStoreLock(root, async () => {
    const row = await readJob(root, jobId), file = row?.files?.[index];
    if (!file || file.status !== 'RUNNING' || file.claimToken !== claimToken || file.sourceHash !== sourceHash) throw Object.assign(Error('정산 OCR 원본·실행권이 다릅니다.'), { statusCode: 409 });
    let receipt;
    if (!error) {
      if (result?.sourceHash !== sourceHash || !Array.isArray(result.pages) || result.pages.length !== 1 || result.pages[0]?.page !== 1 || !Number.isSafeInteger(result.pageCount) || result.pageCount < 1 || result.pageCount > 100) throw Object.assign(Error('첫 페이지 OCR 범위를 확인하지 못했습니다.'), { statusCode: 422 });
      const page = result.pages[0];
      if (!Array.isArray(page.items) || page.items.length > 2000 || page.items.some(i => typeof i.str !== 'string' || i.str.length > 100 || ![i.x, i.y, i.width, i.height].every(Number.isFinite) || i.y < page.height * .32 || i.y > page.height * .76)) throw Object.assign(Error('허용된 본문 OCR 범위를 벗어났습니다.'), { statusCode: 422 });
      try { receipt = parseSettlementPage(page, sourceHash); } catch { error = true; }
      file.pageCount = result.pageCount;
    }
    delete file.claimToken; delete file.claimedAt;
    file.status = receipt ? 'READY' : 'REVIEW';
    if (receipt) file.receipt = receipt;
    else file.error = '첫 페이지 식별·금액 검산이 보류되었습니다. 뒤 페이지는 자동 판독하지 않습니다.';
    if (row.files.every(f => ['READY', 'REVIEW'].includes(f.status))) row.status = 'REVIEW_READY';
    await writeAtomic(jobPath(root, jobId), row);
    await fs.unlink(rawPath(root, jobId, sourceHash)).catch(e => { if (e.code !== 'ENOENT') throw e; });
    return publicJob(row);
  });
}
async function touchWorker({root=JOB_ROOT}={}){await fs.mkdir(root,{recursive:true,mode:0o700});await writeAtomic(path.join(root,'worker-heartbeat.json'),{lastSeen:Date.now()});}
async function workerStatus({root=JOB_ROOT}={}){try{const r=JSON.parse(await fs.readFile(path.join(root,'worker-heartbeat.json'),'utf8'));return {lastSeen:r.lastSeen,connected:Date.now()-r.lastSeen<45000};}catch{return {lastSeen:null,connected:false};}}
async function recordRegistration(jobId,registration,{root=JOB_ROOT}={}){return withStoreLock(root,async()=>{const row=await readJob(root,jobId);if(!row)throw Error('Job absent');row.registration={...registration,at:Date.now()};await writeAtomic(jobPath(root,jobId),row);return publicJob(row);});}
async function pendingRegistration({root=JOB_ROOT}={}){
  await fs.mkdir(root,{recursive:true,mode:0o700});
  for(const name of await fs.readdir(root)){if(!/^[a-f0-9-]{36}\.json$/.test(name))continue;const row=await readJob(root,name.slice(0,-5));if(row?.status==='REVIEW_READY'&&(!row.registration||row.registration.state==='RETRY'&&Date.now()-row.registration.at>60000))return publicJob(row);}
  return null;
}
module.exports = { createSettlementJob, getSettlementJob, claimSettlementJob, finishSettlementJob,touchWorker,workerStatus,recordRegistration,pendingRegistration };
