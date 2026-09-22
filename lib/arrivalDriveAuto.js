import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { listVisible, getFile } from './workDrive';
import { query } from './db.js';
import { loadMappings } from './parseMappings.js';
import { parseArrivalCostWorkbook } from './arrivalCostExcel.js';
import { createArrivalCostImport } from './arrivalCost.js';
import { ARRIVAL_DRIVE_COUNTRIES, selectArrivalDriveCandidates, scopeArrivalDriveRows, arrivalDriveTiming } from './arrivalDrivePolicy.js';

const actor = { userId: 'nenovaSS3', userName: '업무드라이브 원가 자동반영' };
const dir = () => path.join(process.cwd(), 'data', 'arrival-drive-auto');
const stateFile = source => `${source.year}-${source.week}-${source.sha}.json`;
function read(name, fallback) {
  try { return JSON.parse(fs.readFileSync(path.join(dir(), name), 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return fallback; throw new Error('자동반영 설정/상태 파일 확인 필요'); }
}
function write(name, value) {
  fs.mkdirSync(dir(), { recursive: true });
  const target = path.join(dir(), name), temp = `${target}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2)); fs.renameSync(temp, target);
}
export function arrivalDriveConfig() {
  return read('config.json', { enabled: false, year: '2026', countries: ['네덜란드'] });
}
export function saveArrivalDriveConfig(input, user) {
  if (typeof input.enabled !== 'boolean' || !/^20\d{2}$/.test(String(input.year)) || !Array.isArray(input.countries)
    || !input.countries.length || input.countries.some(c => !ARRIVAL_DRIVE_COUNTRIES.includes(c))) throw new Error('연도·대상 국가·활성화 값을 확인하세요');
  const config = { enabled: input.enabled, year: String(input.year), countries: [...new Set(input.countries)], changedBy: user.userId, changedAt: new Date().toISOString() };
  write('config.json', config); return config;
}
export function arrivalDriveStatus() {
  const config = arrivalDriveConfig();
  const candidates = selectArrivalDriveCandidates(listVisible(actor), config);
  const results = candidates.map(c => {
    const state = read(stateFile(c), {}), timing = arrivalDriveTiming(c, state);
    return { ...c, ...state, eligibleAt: timing.eligibleAt, waiting: timing.waiting, reason: c.reason || timing.reason };
  });
  return { config, results };
}
export async function runArrivalDriveAuto() {
  if (global._arrivalDriveRunning) return;
  global._arrivalDriveRunning = true;
  try {
    const config = arrivalDriveConfig();
    if (!config.enabled) return;
    const candidates = selectArrivalDriveCandidates(listVisible(actor), config);
    for (const source of candidates) {
      const old = read(stateFile(source), {});
      if (!arrivalDriveTiming(source, old).ready) continue;
      const currentConfig = arrivalDriveConfig();
      if (!currentConfig.enabled || JSON.stringify(currentConfig) !== JSON.stringify(config)) break;
      const state = { filename: source.filename, week: source.week, country: source.country, at: new Date().toISOString(), status: 'processing' };
      write(stateFile(source), state);
      try {
        const file = getFile(actor, source.id);
        if (!file) throw new Error('원본이 삭제되었거나 접근할 수 없습니다');
        const bytes = fs.readFileSync(file.abs);
        if (crypto.createHash('sha256').update(bytes).digest('hex') !== source.sha) throw new Error('원본 파일 해시 불일치');
        const [products, farms] = await Promise.all([
          query('SELECT ProdKey,ProdCode,ProdName,DisplayName,FlowerName,CounName,OutUnit,BunchOf1Box,SteamOf1Box,BoxWeight,BoxCBM FROM Product WHERE isDeleted=0'),
          query('SELECT FarmKey,FarmName,CounKey FROM Farm WHERE isDeleted=0'),
        ]);
        const parsed = scopeArrivalDriveRows(parseArrivalCostWorkbook(bytes, { fileName: source.filename, orderYear: source.year,
          products: products.recordset, farms: farms.recordset, mappings: loadMappings() }), source);
        // Re-resolve the newest file after parsing; a newer arrival must win.
        const latest = selectArrivalDriveCandidates(listVisible(actor), config).find(c => c.country === source.country);
        if (latest?.sha !== source.sha || latest.reason) throw new Error('검증 중 최신 원본이 변경되었습니다');
        if (JSON.stringify(arrivalDriveConfig()) !== JSON.stringify(config)) break;
        if (!arrivalDriveTiming(latest).ready) continue;
        const saved = await createArrivalCostImport({ parsed, fileName: source.filename, user: actor, orderYear: source.year, driveSource: source });
        write(stateFile(source), { ...state, ...saved, rowCount: parsed.rows.length, unmatchedCount: parsed.unmatchedCount, status: 'complete', at: new Date().toISOString() });
      } catch (error) {
        const review = /확인|불일치|없습니다|보류|동일한|변경되었습니다/.test(error.message);
        write(stateFile(source), { ...state, status: review ? 'review' : 'error', error: String(error.message).slice(0, 500), at: new Date().toISOString() });
      }
    }
  } finally { global._arrivalDriveRunning = false; }
}
export function startArrivalDriveScheduler() {
  if (global._arrivalDriveScheduler || process.env.NODE_ENV !== 'production' || !process.env.DB_SERVER) return;
  const scheduler = { timer: null, running: false, pending: false, watchers: [] };
  global._arrivalDriveScheduler = scheduler;
  const arm = delay => {
    clearTimeout(scheduler.timer);
    scheduler.timer = setTimeout(tick, Math.max(100, Math.min(delay, 2147483647)));
    scheduler.timer.unref?.();
  };
  const changed = () => { if (scheduler.running) scheduler.pending = true; else arm(100); };
  async function tick() {
    scheduler.running = true;
    let next = null;
    try {
      await runArrivalDriveAuto();
      const config = arrivalDriveConfig();
      if (config.enabled) for (const source of selectArrivalDriveCandidates(listVisible(actor), config)) {
        const timing = arrivalDriveTiming(source, read(stateFile(source), {}));
        if (timing.wakeAt !== null) next = Math.min(next ?? Infinity, timing.wakeAt - Date.now());
      }
    } catch (e) { console.warn('[arrival-drive]', e.message); next = 300000; }
    finally {
      scheduler.running = false;
      if (scheduler.pending) { scheduler.pending = false; arm(100); }
      else if (next !== null) arm(next);
    }
  }
  // Watch the directories so atomic config replacement does not detach the watch.
  // Shared disk events also reach the scheduler when another server process uploads.
  for (const [folder, filename] of [[path.join(process.cwd(), 'data', 'drive'), 'index.jsonl'], [dir(), 'config.json']]) {
    fs.mkdirSync(folder, { recursive: true });
    const watcher = fs.watch(folder, (_, name) => { if (!name || String(name) === filename) changed(); });
    watcher.on('error', e => { console.warn('[arrival-drive-watch]', e.message); });
    watcher.unref?.(); scheduler.watchers.push(watcher);
  }
  changed(); // Restore due/pending work after restart, using persisted upload times.
}
