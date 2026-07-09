// ECOUNT 수집 공통 코어 (run.mjs 단발 / daemon.mjs 상주 공용). ⛔ 읽기 전용.
import XLSX from 'xlsx';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const PROFILE = path.join(__dirname, 'ecount-profile');
const DL = path.join(__dirname, '_downloads');
export const ERP_ROOT = 'https://logincc.ecount.com/ec5/view/erp';

export const DEFS = {
  cash: { prgId: 'E010205', form: false, map: { refDate: ['일자', '입출금일'], flow: ['구분'], account: ['계좌번호', '계좌'], custName: ['거래처명', '거래처'], amount: ['금액'], balance: ['원화잔액', '잔액'], counterBank: ['상대은행', '지점'] }, numFields: ['amount', 'balance'] },
  ar: { prgId: 'E040214', form: true, map: { custName: ['거래처명'], salesTotal: ['매출합계'], receiptTotal: ['수급합계', '수금합계'], etcDiff: ['기타할인', '기타'], balance: ['잔액'], agingMonth: ['미회수'] }, numFields: ['salesTotal', 'receiptTotal', 'etcDiff', 'balance'] },
  ap: { prgId: 'E040309', form: true, map: { custCode: ['거래처코드'], custName: ['거래처명'], openingDebt: ['기초채무'], stockBuy: ['재고매입'], acctBuy: ['회계매입'], payTotal: ['지급합계'], etcDiff: ['기타할인', '기타'], balance: ['잔액'], unbilled: ['미청구'] }, numFields: ['openingDebt', 'stockBuy', 'acctBuy', 'payTotal', 'etcDiff', 'balance', 'unbilled'] },
  sales: { prgId: 'E040207', form: true, map: { refDate: ['일자'], custName: ['거래처명'], prodName: ['품목명', '품목'], qty: ['수량'], unitPrice: ['단가'], supplyAmt: ['공급가액'], vat: ['부가세'], total: ['합계'], memo: ['적요'] }, numFields: ['qty', 'unitPrice', 'supplyAmt', 'vat', 'total'] },
};
const READONLY_PRGIDS = new Set(Object.values(DEFS).map(d => d.prgId));
const WRITE_RE = /(save|insert|update|delete|remove|regist|modify|submit|\/ins\b|\/upd\b|\/del\b)/i;
const READ_RE = /(excel|export|download|print|report|view|list|search|inquiry|getdata|cache|grid|menu|resource)/i;
const num = s => { const x = Number(String(s ?? '').replace(/[,\s₩원]/g, '')); return Number.isFinite(x) ? x : 0; };

export async function installGuard(ctx) {
  await ctx.route('**/*', route => {
    const u = route.request().url(); const m = route.request().method();
    let host = '', pathq = '';
    try { const url = new URL(u); host = url.hostname; pathq = url.pathname + url.search; } catch {}
    const isEcount = /(^|\.)ecount\.com$/i.test(host);
    const isWrite = (WRITE_RE.test(pathq) && !READ_RE.test(pathq)) || ['PUT', 'DELETE', 'PATCH'].includes(m);
    if (isEcount && isWrite) { console.error(`🛑 [READ-ONLY GUARD] ECOUNT 쓰기 차단: ${m} ${u.slice(0, 100)}`); return route.abort(); }
    return route.continue();
  });
}

export function isLoginPage(page) { return /login\.ecount\.com/i.test(page.url()); }

// 앱 세션 부팅: 루트로 이동해 쿠키→세션 복원 유도. 로그인 화면이면 false.
export async function ensureBooted(page) {
  await page.goto(ERP_ROOT, { waitUntil: 'networkidle' }).catch(() => {});
  await page.waitForTimeout(2500);
  return !isLoginPage(page);
}

function findHeaderRow(aoa, labels) {
  let best = -1, hit0 = 0; const flat = Object.values(labels).flat();
  for (let i = 0; i < Math.min(aoa.length, 20); i++) {
    const row = aoa[i].map(c => String(c ?? ''));
    const hit = flat.filter(lbl => row.some(c => c.includes(lbl))).length;
    if (hit > hit0) { hit0 = hit; best = i; }
  }
  return hit0 >= 2 ? best : -1;
}
function colIndexByLabel(headerRow, labels) {
  const idx = {}; const cells = headerRow.map(c => String(c ?? '').replace(/\s+/g, ''));
  for (const [field, cands] of Object.entries(labels)) for (const lbl of cands) { const j = cells.findIndex(c => c.includes(lbl.replace(/\s+/g, ''))); if (j >= 0) { idx[field] = j; break; } }
  return idx;
}
function parseExcel(buf, def) {
  const wb = XLSX.read(buf, { type: 'buffer' });
  const aoa = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false, defval: '' });
  const hr = findHeaderRow(aoa, def.map); if (hr < 0) return { rows: [], screenTotal: null };
  const idx = colIndexByLabel(aoa[hr], def.map);
  const rows = []; let screenTotal = null;
  for (let i = hr + 1; i < aoa.length; i++) {
    const r = aoa[i]; const first = String(r[0] ?? '').trim();
    if (/합계|총계|총\s*합/.test(r.map(x => String(x ?? '')).join(''))) { const t = idx.total ?? idx.balance ?? idx.amount ?? idx.supplyAmt; if (t != null) screenTotal = num(r[t]); continue; }
    const o = {}; for (const [f, j] of Object.entries(idx)) o[f] = def.numFields.includes(f) ? num(r[j]) : String(r[j] ?? '').trim();
    o.isSubtotal = /계$/.test(first) && !o.custCode;
    if (Object.entries(o).some(([k, v]) => def.numFields.includes(k) && v !== 0) || o.custName || o.custCode) rows.push(o);
  }
  return { rows, screenTotal };
}

// 한 화면 수집(Excel 내보내기). 로그인 만료면 throw.
export async function collectOne(page, ds) {
  const def = DEFS[ds];
  if (!READONLY_PRGIDS.has(def.prgId)) throw new Error(`조회 화면 아님: ${def.prgId}`);
  await page.goto(`${ERP_ROOT}#prgId=${def.prgId}`, { waitUntil: 'networkidle' }).catch(() => {});
  await page.waitForTimeout(2500);
  if (isLoginPage(page)) throw new Error('LOGIN_EXPIRED');
  if (def.form) { await page.keyboard.press('F8').catch(() => {}); await page.waitForTimeout(3000); }
  const dlP = page.waitForEvent('download', { timeout: 15000 }).catch(() => null);
  let clicked = false;
  for (const f of [page, ...page.frames()]) {
    for (const loc of [f.getByRole?.('button', { name: /^Excel$/i }), f.locator?.('button:has-text("Excel")'), f.locator?.('a:has-text("Excel")'), f.locator?.('text=Excel')]) {
      try { if (loc && await loc.first().isVisible({ timeout: 700 })) { await loc.first().click({ timeout: 1500 }); clicked = true; break; } } catch {}
    }
    if (clicked) break;
  }
  if (!clicked) throw new Error('Excel 버튼 못 찾음');
  const dl = await dlP; if (!dl) throw new Error('Excel 다운로드 미시작(형식선택 팝업?)');
  fs.mkdirSync(DL, { recursive: true });
  const file = path.join(DL, `${ds}.xlsx`); await dl.saveAs(file);
  const { rows, screenTotal } = parseExcel(fs.readFileSync(file), def);
  return { rows, screenTotal, screenRowCnt: rows.filter(r => !r.isSubtotal).length };
}

export async function postIngest(nenova, cookie, ds, payload) {
  const res = await fetch(`${nenova}/api/ecount/ingest`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify({ dataset: ds, source: 'owner-pc', ...payload }),
  });
  return await res.json().catch(() => ({ success: false, error: `HTTP ${res.status}` }));
}
