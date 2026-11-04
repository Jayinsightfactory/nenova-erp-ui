// lib/pmFreePass.js — /pm 꾸미기 1주일 자유이용권(순수 계산 + 파일 저장). 토큰 잔액·구매 기록은 건드리지 않는다.
//   data/runtime/pm-freepass.json = { default: { start, days }, people: { [직원]: { start, days, by, at } } }
//   기본: 전 직원 2026-11-04 부터 7일. 관리자가 재지급(개인/전체)·기간 조정.
//   만료되면 산 적 없는 유료 품목은 화면에서만 해제(기본 복장 복귀) — 저장된 꾸미기 데이터는 보존.
import fs from 'fs';
import path from 'path';

export const DEFAULT_PASS = Object.freeze({ start: '2026-11-04', days: 7 });
export const pmFreePassPath = () => path.join(process.cwd(), 'data', 'runtime', 'pm-freepass.json');
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const kst = (ms) => new Date(ms + 9 * 3600 * 1000).toISOString().slice(0, 10);

export function readPasses(file = pmFreePassPath()) {
  try { const d = JSON.parse(fs.readFileSync(file, 'utf8')); return { default: d.default || { ...DEFAULT_PASS }, people: d.people || {} }; } catch { return { default: { ...DEFAULT_PASS }, people: {} }; }
}

// 시작일(KST 날짜) 포함 days 일 동안 유효. 끝 = start + days 일 00:00 KST
export function passOf(name, passes, nowMs) {
  const p = (passes && passes.people && passes.people[name]) || (passes && passes.default) || DEFAULT_PASS;
  const startMs = Date.parse(p.start + 'T00:00:00+09:00');
  const endMs = startMs + p.days * 86400000;
  const active = Number.isFinite(startMs) && nowMs >= startMs && nowMs < endMs;
  const daysLeft = active ? Math.ceil((endMs - nowMs) / 86400000) : 0;
  return { start: p.start, days: p.days, end: kst(endMs - 1), active, daysLeft, expired: nowMs >= endMs };
}

export function grantPass(passes, who, { start, days, by = '', nowIso = new Date().toISOString() }) {
  if (!DAY.test(String(start || ''))) return { ok: false, status: 400, error: '시작일 YYYY-MM-DD' };
  const d = Number(days);
  if (!Number.isInteger(d) || d < 0 || d > 60) return { ok: false, status: 400, error: '기간 0~60일' };
  const next = { default: { ...passes.default }, people: { ...passes.people } };
  if (who === '*') { next.default = { start, days: d }; next.people = {}; }
  else { const n = String(who || '').trim().slice(0, 40); if (!n) return { ok: false, status: 400, error: 'name 필요' }; next.people[n] = { start, days: d, by: String(by).slice(0, 40), at: nowIso }; }
  return { ok: true, passes: next };
}

export function writePasses(passes, file = pmFreePassPath()) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(passes, null, 1));
  fs.renameSync(tmp, file);
}

// 화면용 유효 꾸미기: 이용권 중이면 그대로, 아니면 잠긴(산 적 없는 유료) 품목만 뺀다. lockedIds = lib/pmWallet.lockedOf 결과
export function effectiveCfg(cfg, pass, lockedIds) {
  if (!cfg) return cfg;
  if (pass && pass.active) return { ...cfg, freeLocked: [] };
  const lock = new Set(lockedIds || []);
  const items = {};
  for (const [s, v] of Object.entries(cfg.items || {})) if (!lock.has(v)) items[s] = v;
  return { ...cfg, char: lock.has(`char.${cfg.char}`) ? 'human' : cfg.char, items, freeLocked: [...lock] };
}
