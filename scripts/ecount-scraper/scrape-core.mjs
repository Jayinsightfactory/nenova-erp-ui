// ECOUNT 수집 공통 코어 (run.mjs 단발 / daemon.mjs 상주 공용). ⛔ 읽기 전용.
import XLSX from 'xlsx';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const PROFILE = path.join(__dirname, 'ecount-profile');
const DL = path.join(__dirname, '_downloads');
export const ERP_ROOT = 'https://logincc.ecount.com/ec56/view/erp'; // 2026-10-08: 이카운트가 /ec5 → /ec56 으로 바뀜(옛 주소는 로그인 페이지로 튕겨 "만료" 오판)

// hash = ECOUNT SPA 메뉴 해시(브라우저 조사로 확보). 세션ID 유지한 채 이 해시로 앱내 이동해야 로그인 안 튕김.
export const DEFS = {
  cash: { prgId: 'E010205', form: false, hash: '#menuType=MENUTREE_000001&menuSeq=MENUTREE_002563&groupSeq=MENUTREE_002562&prgId=E010205&depth=3', map: { refDate: ['일자', '입출금일'], flow: ['구분'], account: ['계좌번호', '계좌'], custName: ['거래처명', '거래처'], amount: ['금액'], balance: ['원화잔액', '잔액'], counterBank: ['상대은행', '지점'] }, numFields: ['amount', 'balance'] },
  ar: { prgId: 'E040214', form: true, hash: '#menuType=MENUTREE_000004&menuSeq=MENUTREE_000500&groupSeq=MENUTREE_000030&prgId=E040214&depth=4', map: { custName: ['거래처명'], salesTotal: ['매출합계'], receiptTotal: ['수급합계', '수금합계'], etcDiff: ['기타할인', '기타'], balance: ['잔액'], agingMonth: ['미회수'] }, numFields: ['salesTotal', 'receiptTotal', 'etcDiff', 'balance'] },
  ap: { prgId: 'E040309', form: true, hash: '#menuType=MENUTREE_000004&menuSeq=MENUTREE_000517&groupSeq=MENUTREE_000031&prgId=E040309&depth=4', map: { custCode: ['거래처코드'], custName: ['거래처명'], openingDebt: ['기초채무'], stockBuy: ['재고매입'], acctBuy: ['회계매입'], payTotal: ['지급합계'], etcDiff: ['기타할인', '기타'], balance: ['잔액'], unbilled: ['미청구'] }, numFields: ['openingDebt', 'stockBuy', 'acctBuy', 'payTotal', 'etcDiff', 'balance', 'unbilled'] },
  sales: { prgId: 'E040207', form: true, hash: '#menuType=MENUTREE_000004&menuSeq=MENUTREE_000494&groupSeq=MENUTREE_000030&prgId=E040207&depth=4', map: { refDate: ['일자'], custName: ['거래처명'], prodName: ['품목명', '품목'], qty: ['수량'], unitPrice: ['단가'], supplyAmt: ['공급가액'], vat: ['부가세'], total: ['합계'], memo: ['적요'] }, numFields: ['qty', 'unitPrice', 'supplyAmt', 'vat', 'total'] },
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

// 앱 세션 부팅: 루트로 이동해 쿠키→세션 복원. 성공 시 세션ID 포함된 base URL(해시 제외) 반환, 실패 시 null.
export async function ensureBooted(page) {
  // 2026-10-08: 방금 로그인해 이미 /view/erp(세션ID 포함) 에 있으면 새로 goto 하지 않는다 — 세션ID 없는 루트로 다시 가면 로그인으로 튕긴다(base=null 원인).
  if (page.url().includes('logincc.ecount.com/') && page.url().includes('/view/erp')) { await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(2500); if (!isLoginPage(page)) return page.url().split('#')[0]; }
  await page.goto(ERP_ROOT, { waitUntil: 'networkidle' }).catch(() => {});
  await page.waitForTimeout(2500);
  if (isLoginPage(page)) return null;
  return page.url().split('#')[0];   // 예: https://logincc.ecount.com/ec5/view/erp?w_flag=1&ec_req_sid=CC-...
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
    // 소계/총계 행 판정: ECOUNT 는 거래처코드 칸에 '…계'(예 '/  계' 전체총계, '00134 / 박성수 계' 거래처소계)를 넣어
    // 값이 비어있지 않으므로 !custCode 가드로는 못 걸러진다 → 코드칸이 '계'로 끝나면 소계/총계로 간주(중복합산 방지).
    const codeStr = String(o.custCode ?? '').replace(/\s+/g, '');
    o.isSubtotal = (o.custCode && /계$/.test(codeStr)) || (/계$/.test(first) && !o.custCode);
    if (Object.entries(o).some(([k, v]) => def.numFields.includes(k) && v !== 0) || o.custName || o.custCode) rows.push(o);
  }
  return { rows, screenTotal };
}

// 한 화면 수집(Excel 내보내기). base=ensureBooted 가 준 세션포함 URL. 로그인 만료면 throw.
export async function collectOne(page, base, ds) {
  const def = DEFS[ds];
  if (!READONLY_PRGIDS.has(def.prgId)) throw new Error(`조회 화면 아님: ${def.prgId}`);
  // 세션ID 유지: base(세션query 포함) + 정확한 메뉴 해시로 앱내 이동. full goto 로 딥링크 접속 금지.
  await page.goto(base + def.hash, { waitUntil: 'networkidle' }).catch(() => {});
  await page.waitForTimeout(2800);
  if (isLoginPage(page)) { console.log(`   (collectOne ${ds}: base=${String(base).slice(0, 90)} → ${page.url().slice(0, 120)})`); throw new Error('LOGIN_EXPIRED'); }
  if (def.form) { await page.keyboard.press('F8').catch(() => {}); await page.waitForTimeout(3000); }
  const dlP = page.waitForEvent('download', { timeout: ds === 'sales' ? 60000 : 15000 }).catch(() => null);
  let clicked = false;
  for (let attempt = 0; attempt < 2 && !clicked; attempt++) { if (attempt) await page.waitForTimeout(5000); // 2026-10-08: 그리드 로딩 지연·공지 팝업으로 Excel 버튼이 늦게 보이는 경우 1회 재시도
  for (const f of [page, ...page.frames()]) {
    for (const loc of [f.getByRole?.('button', { name: /^Excel$/i }), f.locator?.('button:has-text("Excel")'), f.locator?.('a:has-text("Excel")'), f.locator?.('text=Excel')]) {
      try { if (loc && await loc.first().isVisible({ timeout: 700 })) { await loc.first().click({ timeout: 1500 }); clicked = true; break; } } catch {}
    }
    if (clicked) break;
  }
  }
  if (!clicked) throw new Error('Excel 버튼 못 찾음');
  const dl = await dlP;
  if (!dl) { // 2026-10-08 진단: 실패 시점 화면·보이는 팝업 텍스트를 남긴다(조회 전용, 아무것도 누르지 않음)
    fs.mkdirSync(DL, { recursive: true });
    const shot = path.join(DL, `${ds}-fail.png`); await page.screenshot({ path: shot, fullPage: false }).catch(() => {});
    let dlg = ''; for (const f of [page, ...page.frames()]) { try { const t = await f.locator('[role=dialog], .ui-dialog, .modal, .popup, .layer').allInnerTexts(); if (t.length) dlg += t.join(' | ').replace(/\s+/g, ' ').slice(0, 400); } catch {} }
    fs.writeFileSync(path.join(DL, `${ds}-fail.txt`), `url=${page.url()}\nframes=${page.frames().length}\ndialog=${dlg}\n`);
    throw new Error(`Excel 다운로드 미시작(화면 ${shot}${dlg ? ', 팝업: ' + dlg.slice(0, 120) : ''})`);
  }
  fs.mkdirSync(DL, { recursive: true });
  const file = path.join(DL, `${ds}.xlsx`); await dl.saveAs(file);
  const { rows, screenTotal } = parseExcel(fs.readFileSync(file), def);
  return { rows, screenTotal, screenRowCnt: rows.filter(r => !r.isSubtotal).length };
}

// auth: 토큰(권장, 상주 데몬) 또는 로그인쿠키. 토큰이 있으면 Authorization 헤더로 전송.
export async function postIngest(nenova, auth, ds, payload) {
  const token = process.env.NENOVA_TOKEN || '';
  const cookie = typeof auth === 'string' ? auth : '';
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  else if (cookie) headers.Cookie = cookie;
  const res = await fetch(`${nenova}/api/ecount/ingest`, {
    method: 'POST', headers,
    body: JSON.stringify({ dataset: ds, source: 'owner-pc', ...payload }),
  });
  return await res.json().catch(() => ({ success: false, error: `HTTP ${res.status}` }));
}
