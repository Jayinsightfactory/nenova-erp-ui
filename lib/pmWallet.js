// lib/pmWallet.js — /pm 토큰 지갑·상점(서버 전용). 설계: docs/pm-theme-brainstorm.md '토큰·상점'.
//   적립 = lib/pmGrow 성장 점수(업무 1h=10·활동 1h=3·하루 60, 서버 계산) 를 그대로 쓴다 → 별도 적립 계산 없음.
//   잔액 = floor(적립 누적) − 구매 합계. 구매·장착 기록 = data/runtime/pm-shop.json(웹 전용 파일, MSSQL 무관).
//   가격은 서버의 public/pm-themes/manifest.json 에서만 읽는다(클라이언트 가격 무시). 급여·평가 무관.
import fs from 'fs';
import path from 'path';
import { DAILY_CAP, EXCLUDED, RATE_ACTIVE_PER_H, RATE_WORK_PER_H, kstDay } from './pmGrow';

export const PM_SHOP_MAX_PURCHASES = 5000;
// 테마는 화면 전체(보는 사람 설정)라 개인 지갑이 아니라 팀 누적 토큰으로 해금: 팀 적립 합계 ≥ 가격 × 이 배수.
export const THEME_UNLOCK_MULT = 5;
export const pmShopPath = () => path.join(process.cwd(), 'data', 'runtime', 'pm-shop.json');
export const pmManifestPath = () => path.join(process.cwd(), 'public', 'pm-themes', 'manifest.json');

export function readShop(file = pmShopPath()) {
  try { const d = JSON.parse(fs.readFileSync(file, 'utf8')); return { purchases: Array.isArray(d?.purchases) ? d.purchases : [] }; } catch { return { purchases: [] }; }
}
function writeShop(shop, file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ purchases: shop.purchases.slice(-PM_SHOP_MAX_PURCHASES) }, null, 1));
  fs.renameSync(tmp, file);
}

let _mf = null;
export function readManifest(file = pmManifestPath()) {
  try { const st = fs.statSync(file).mtimeMs; if (!_mf || _mf.st !== st || _mf.file !== file) _mf = { file, st, data: JSON.parse(fs.readFileSync(file, 'utf8')) }; return _mf.data; } catch { return null; }
}

// 상점 품목 = 캐릭터 + 꾸미기 아이템(개인) / 테마(팀 해금)
export function catalog(manifest) {
  const m = manifest || {};
  const list = [];
  for (const c of m.characters || []) list.push({ id: `char.${c.id}`, ref: c.id, kind: 'char', name: c.name, price: Number(c.price) || 0, rarity: c.rarity || 'basic' });
  for (const x of m.items || []) list.push({ id: x.id, ref: x.id, kind: 'item', name: x.name, price: Number(x.price) || 0, rarity: x.rarity || 'common' });
  // 스킬·탈것(lib/pmSkills·pmMounts) — API 가 withFx(manifest) 로 m.skills/m.mounts 를 붙여 넘긴다
  for (const x of [...(m.skills || []), ...(m.mounts || [])]) list.push({ id: x.id, ref: x.id, kind: 'item', name: x.name, price: Number(x.price) || 0, rarity: x.rarity || 'common', unlockStage: x.unlockStage || 1 });
  for (const t of m.themes || []) list.push({ id: `theme.${t.id}`, ref: t.id, kind: 'theme', name: t.name, price: Number(t.price) || 0, rarity: t.rarity || 'basic' });
  return list;
}

export function walletOf(name, growState, shop) {
  const p = growState?.people?.[name];
  const earned = p ? Math.floor(p.points) : 0;
  const mine = shop.purchases.filter((x) => x.name === name);
  const spent = mine.reduce((a, x) => a + (Number(x.price) || 0), 0);
  const today = p && p.today && p.today.day === kstDay(Date.now()) ? p.today : null;
  const history = [...(p?.history || []), ...(today && today.base > 0 ? [{ day: today.day, points: Math.round(today.base * 10) / 10, reasons: today.reasons, today: true }] : [])]
    .reverse().map((h) => ({ day: h.day, points: h.points, today: !!h.today, reasons: Object.entries(h.reasons || {}).map(([label, minutes]) => ({ label, minutes: Math.round(minutes) })).sort((a, b) => b.minutes - a.minutes).slice(0, 5) }));
  return { name, earned, spent, balance: Math.max(0, earned - spent), owned: [...new Set(mine.flatMap((x) => (PM_ITEM_ALIASES[x.id] ? [x.id, PM_ITEM_ALIASES[x.id]] : [x.id])))], purchases: mine.slice().reverse(), history, rule: { workPerH: RATE_WORK_PER_H, activePerH: RATE_ACTIVE_PER_H, dailyCap: DAILY_CAP } };
}

export function teamEarned(growState) {
  return Object.values(growState?.people || {}).reduce((a, p) => a + Math.floor(p.points || 0), 0);
}

export function themeUnlocks(manifest, growState) {
  const team = teamEarned(growState);
  return (manifest?.themes || []).map((t) => ({ id: t.id, price: Number(t.price) || 0, need: (Number(t.price) || 0) * THEME_UNLOCK_MULT, unlocked: (Number(t.price) || 0) === 0 || team >= (Number(t.price) || 0) * THEME_UNLOCK_MULT }));
}

// 원자 처리: 동기 read→검증→write 는 Node 단일 이벤트 루프에서 끼어들 틈이 없다(await 없음).
export function buy({ name, id, by }, { growState, manifest, file = pmShopPath(), now = new Date() }) {
  const n = String(name || '').trim().slice(0, 40);
  if (!n || EXCLUDED.includes(n)) return { ok: false, status: 400, error: '대상 직원 없음' };
  if (!growState?.people?.[n]) return { ok: false, status: 404, error: '적립 기록 없는 직원' };
  const item = catalog(manifest).find((x) => x.id === String(id || ''));
  if (!item || item.kind === 'theme') return { ok: false, status: 400, error: '살 수 없는 품목' };
  const shop = readShop(file);
  const w = walletOf(n, growState, shop);
  if (item.price === 0 || w.owned.includes(item.id)) return { ok: true, duplicate: true, wallet: w };
  if (w.balance < item.price) return { ok: false, status: 409, error: `토큰 부족(잔액 ${w.balance} / 가격 ${item.price})` };
  shop.purchases.push({ name: n, id: item.id, kind: item.kind, price: item.price, by: String(by || '').slice(0, 40), at: now.toISOString() });
  writeShop(shop, file);
  return { ok: true, wallet: walletOf(n, growState, shop) };
}

// 캐릭터 v2 이전 품목 id → 새 id(책상 소품 desk.* → 상판 top.*). 예전에 산 것은 새 id 로도 보유 인정.
export const PM_ITEM_ALIASES = Object.freeze({ 'desk.vase': 'top.vase', 'desk.coffee': 'top.coffee', 'desk.plant': 'top.cactus', 'desk.calc': 'top.calc', 'desk.globe': 'top.globe', 'desk.box': 'top.box', 'desk.trophy': 'top.trophy' });

// 장착 검증: 무료이거나 산 것만. (char 는 'char.<id>' 로 대조)
export function lockedOf(name, cfg, manifest, shop) {
  const owned = new Set(shop.purchases.filter((x) => x.name === name).map((x) => x.id));
  for (const [o, n] of Object.entries(PM_ITEM_ALIASES)) if (owned.has(o)) owned.add(n);
  const cat = new Map(catalog(manifest).map((x) => [x.id, x]));
  const want = [cfg?.char ? `char.${cfg.char}` : null, ...Object.values(cfg?.items || {})].filter(Boolean);
  return want.filter((id) => { const it = cat.get(id); return it && it.price > 0 && !owned.has(id); });
}
