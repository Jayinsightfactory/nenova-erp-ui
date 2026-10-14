// Web-only audit journal. No ERP writes. No automatic retention/deletion.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const KINDS = new Set(['click', 'change', 'submit', 'navigation', 'api', 'desktop']);
const text = (v, n) => typeof v === 'string' ? v.replace(/[\x00-\x1f\x7f]/g, ' ').slice(0, n) : '';
const root = () => process.env.NENOVA_ACTIVITY_DIR || path.join(process.cwd(), 'data', 'user-activity');
const HEALTH = Symbol.for('nenova.userActivity.health');
const healthState = () => globalThis[HEALTH] ||= { lastFailure: null, lastSuccessAt: null };
function getHealth() {
  const state = healthState();
  if (!state.diskCheckedAt || Date.now() - state.diskCheckedAt > 60000) {
    state.diskCheckedAt = Date.now();
    try {
      let folder = root(); while (!fs.existsSync(folder) && path.dirname(folder) !== folder) folder = path.dirname(folder);
      const stat = fs.statfsSync(folder);
      state.disk = { freeBytes: stat.bavail * stat.bsize, freeInodes: stat.files > 0 ? stat.ffree : null };
      state.disk.warning = state.disk.freeBytes < 1073741824 || state.disk.freeInodes !== null && state.disk.freeInodes < 10000;
    } catch { state.disk = { warning: true, unavailable: true }; }
  }
  const retry = globalThis[Symbol.for('nenova.userActivity.retry')];
  return { ...state, pending: retry?.queue?.length || 0, dropped: retry?.dropped || 0, healthy: !state.disk?.warning && !(retry?.queue?.length || retry?.dropped) && (!state.lastFailure || !!state.lastSuccessAt && state.lastSuccessAt >= state.lastFailure.at) };
}
const kst = date => new Date(new Date(date).getTime() + 9 * 3600000).toISOString();
function syncDirectory(directory) { if (process.platform !== 'win32') { const fd = fs.openSync(directory, 'r'); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); } } }
const rowKey = row => row.receivedAt + '|' + row.id + '|' + crypto.createHash('sha256').update(row.userId).digest('hex');
function cleanPath(value) { return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') ? text(value.split(/[?#]/)[0], 300) : '/'; }
function sourceFromRequest(req) { return /NenovaDesktop|NenovaWorkspace|Electron\//i.test(req?.headers?.['user-agent'] || '') ? 'desktop' : 'web'; }
function normalizeEvent(user, input, source, now = new Date()) {
  if (!user?.userId || !input || !UUID.test(input.id || '') || !KINDS.has(input.kind)) throw new Error('INVALID_EVENT');
  const row = { id: input.id.toLowerCase(), userId: text(String(user.userId), 100), userName: text(user.userName || '', 100), receivedAt: now.toISOString(), clientAt: null, source: source === 'desktop' ? 'desktop' : 'web', kind: input.kind, path: cleanPath(input.path) };
  if (typeof input.clientAt === 'string' && Number.isFinite(Date.parse(input.clientAt))) row.clientAt = new Date(input.clientAt).toISOString();
  if (input.pagePath) row.pagePath = cleanPath(input.pagePath);
  for (const key of ['actionId', 'sessionId']) if (UUID.test(input[key] || '')) row[key] = input[key].toLowerCase();
  for (const key of ['control', 'label']) if (input[key]) row[key] = text(input[key], key === 'control' ? 100 : 160);
  if (/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/.test(input.method)) row.method = input.method;
  if (Number.isInteger(input.status) && input.status >= 100 && input.status <= 599) row.status = input.status;
  row.outcome = ['success', 'failure', 'unknown'].includes(input.outcome) ? input.outcome : 'unknown';
  if (Number.isFinite(input.duration)) row.duration = Math.max(0, Math.min(86400000, Math.round(input.duration)));
  return row;
}
function appendEventsInner(user, events, source, options = {}) {
  if (!Array.isArray(events) || !events.length || events.length > 50) throw new Error('INVALID_BATCH');
  const now = options.now instanceof Date ? options.now : new Date();
  const rows = events.map(e => ({ ...normalizeEvent(user, e, source, now), recordedBy: options.recordedBy === 'server' ? 'server' : 'client' }));
  fs.mkdirSync(path.join(root(), 'ids'), { recursive: true });
  const syncFolders = new Set();
  let written = 0;
  for (const row of rows) {
    const key = crypto.createHash('sha256').update(row.userId + '\0' + row.id).digest('hex');
    const idsDirectory = path.join(root(), 'ids', key.slice(0, 2));
    fs.mkdirSync(idsDirectory, { recursive: true });
    const target = path.join(idsDirectory, key + '.jsonl');
    const temp = path.join(idsDirectory, '.' + crypto.randomUUID() + '.tmp');
    let fd;
    try {
      fd = fs.openSync(temp, 'wx', 0o600);
      fs.writeFileSync(fd, JSON.stringify(row) + '\n');
      fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined;
      try { fs.linkSync(temp, target); written++; } catch (error) { if (error.code !== 'EEXIST') throw error; }
      // A second hard link indexes by received hour without duplicating file data.
      // Retries repair an interrupted index publication using the original event time.
      const saved = JSON.parse(fs.readFileSync(target, 'utf8'));
      const savedKst = kst(saved.receivedAt);
      const directory = path.join(root(), savedKst.slice(0, 10));
      const hourDirectory = path.join(directory, savedKst.slice(11, 13));
      fs.mkdirSync(hourDirectory, { recursive: true });
      try { fs.linkSync(target, path.join(hourDirectory, key + '.jsonl')); } catch (error) { if (error.code !== 'EEXIST') throw error; }
      for (const folder of [idsDirectory, path.join(root(), 'ids'), hourDirectory, directory, root()]) syncFolders.add(folder);
    } finally { if (fd !== undefined) fs.closeSync(fd); try { fs.unlinkSync(temp); } catch {} }
  }
  for (const folder of syncFolders) syncDirectory(folder);
  return { accepted: rows.length, acceptedIds: rows.map(row => row.id), written };
}
function appendEvents(user, events, source, options = {}) {
  try { const result = appendEventsInner(user, events, source, options); healthState().lastSuccessAt = new Date().toISOString(); return result; }
  catch (error) { if (!String(error.message).startsWith('INVALID_')) healthState().lastFailure = { at: new Date().toISOString(), code: /^[A-Z_0-9]+$/.test(error.code || '') ? error.code : 'STORE_ERROR' }; throw error; }
}
function day(value) { const parsed = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(value + 'T00:00:00Z') : null; return parsed && Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : null; }
async function listEvents(filters = {}) {
  const today = kst(new Date()).slice(0, 10);
  const from = day(filters.from || filters.date || today), to = day(filters.to || filters.date || today);
  if (!from || !to || from > to || Date.parse(to) - Date.parse(from) > 30 * 86400000) throw new Error('INVALID_DATE_RANGE');
  const limit = Math.max(1, Math.min(200, Number(filters.limit) || 100));
  const hours = filters.hour == null || filters.hour === '' ? Array.from({ length: 24 }, (_, n) => String(n).padStart(2, '0')) : [String(filters.hour).padStart(2, '0')];
  if (hours.some(hour => !/^(0\d|1\d|2[0-3])$/.test(hour))) throw new Error('INVALID_HOUR');
  let cursor = '';
  if (filters.cursor) { cursor = Buffer.from(String(filters.cursor), 'base64url').toString(); if (!/^\d{4}-\d\d-\d\dT[^|]+\|[0-9a-f-]{36}\|[0-9a-f]{64}$/.test(cursor)) throw new Error('INVALID_CURSOR'); }
  const rows = [];
  let scanned = 0;
  for (let date = Date.parse(from); date <= Date.parse(to); date += 86400000) {
    for (const hour of hours) {
    const directory = path.join(root(), new Date(date).toISOString().slice(0, 10), hour);
    let files; try { files = await fs.promises.readdir(directory); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    for (const file of files) {
      if (!/^[a-f0-9]{64}\.jsonl$/.test(file)) continue;
      if (++scanned > 100000) throw Object.assign(new Error('QUERY_TOO_LARGE'), { code: 'ACTIVITY_QUERY_TOO_LARGE' });
      const row = JSON.parse(await fs.promises.readFile(path.join(directory, file), 'utf8'));
      if (['userId', 'source', 'kind', 'outcome'].some(key => filters[key] && row[key] !== String(filters[key]))) continue;
      if (filters.path && row.path !== cleanPath(filters.path)) continue;
      if (cursor && rowKey(row) >= cursor) continue;
      rows.push(row);
    }
    }
  }
  rows.sort((a, b) => rowKey(b).localeCompare(rowKey(a)));
  const items = rows.slice(0, limit), last = items[items.length - 1];
  return { items, nextCursor: rows.length > limit ? Buffer.from(rowKey(last)).toString('base64url') : null, from, to };
}
module.exports = { appendEvents, listEvents, normalizeEvent, cleanPath, sourceFromRequest, getHealth };
