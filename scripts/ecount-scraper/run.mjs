// ECOUNT 4종 자동수집 — owner PC. 전용 크롬 프로필(ecount-profile) 로그인 재사용.
// 화면 그리드는 가상스크롤(보이는 행만 DOM)이라 → Excel 내보내기로 전체 데이터를 받아 파싱한다.
// 사용: node run.mjs [sales ar ap cash]  (인자 없으면 4종 전부)
// 환경변수: NENOVA_URL, NENOVA_COOKIE(nenovaweb 인증쿠키), SHOW=1(창 보이기)
//
// ⛔ ECOUNT 읽기 전용. 입력·수정·저장 절대 금지. 가드: prgId 화이트리스트 + 쓰기요청 abort.
import { chromium } from 'playwright';
import XLSX from 'xlsx';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROFILE = path.join(__dirname, 'ecount-profile');
const DL = path.join(__dirname, '_downloads');
const NENOVA = process.env.NENOVA_URL || 'https://nenovaweb.com';
const COOKIE = process.env.NENOVA_COOKIE || '';
const ERP = 'https://logincc.ecount.com/ec5/view/erp';

// 데이터셋: prgId(조회화면) + 헤더라벨→필드 매핑(엑셀 컬럼명 기준, 정렬 바뀌어도 안전) + 숫자필드
const DEFS = {
  cash: { prgId: 'E010205', form: false, map: { refDate: ['일자', '입출금일'], flow: ['구분'], account: ['계좌번호', '계좌'], custName: ['거래처명', '거래처'], amount: ['금액'], balance: ['원화잔액', '잔액'], counterBank: ['상대은행', '지점'] }, numFields: ['amount', 'balance'] },
  ar: { prgId: 'E040214', form: true, map: { custName: ['거래처명'], salesTotal: ['매출합계'], receiptTotal: ['수급합계', '수금합계'], etcDiff: ['기타할인', '기타'], balance: ['잔액'], agingMonth: ['미회수'] }, numFields: ['salesTotal', 'receiptTotal', 'etcDiff', 'balance'] },
  ap: { prgId: 'E040309', form: true, map: { custCode: ['거래처코드'], custName: ['거래처명'], openingDebt: ['기초채무'], stockBuy: ['재고매입'], acctBuy: ['회계매입'], payTotal: ['지급합계'], etcDiff: ['기타할인', '기타'], balance: ['잔액'], unbilled: ['미청구'] }, numFields: ['openingDebt', 'stockBuy', 'acctBuy', 'payTotal', 'etcDiff', 'balance', 'unbilled'] },
  sales: { prgId: 'E040207', form: true, map: { refDate: ['일자'], custName: ['거래처명'], prodName: ['품목명', '품목'], qty: ['수량'], unitPrice: ['단가'], supplyAmt: ['공급가액'], vat: ['부가세'], total: ['합계'], memo: ['적요'] }, numFields: ['qty', 'unitPrice', 'supplyAmt', 'vat', 'total'] },
};
const READONLY_PRGIDS = new Set(Object.values(DEFS).map(d => d.prgId));
// 쓰기 판정: save/insert/update/delete/remove 등 — 단 excel/export/download/report/view/list 등 조회·내보내기는 제외.
const WRITE_RE = /(save|insert|update|delete|remove|regist|modify|submit|\/ins\b|\/upd\b|\/del\b)/i;
const READ_RE = /(excel|export|download|print|report|view|list|search|inquiry|getdata|cache|grid|menu|resource)/i;
function num(s) { const x = Number(String(s ?? '').replace(/[,\s₩원]/g, '')); return Number.isFinite(x) ? x : 0; }

function findHeaderRow(aoa, labels) {
  // 헤더 후보: dataset 라벨을 가장 많이 포함한 행
  let best = -1, bestHit = 0;
  const flat = Object.values(labels).flat();
  for (let i = 0; i < Math.min(aoa.length, 15); i++) {
    const row = aoa[i].map(c => String(c ?? ''));
    const hit = flat.filter(lbl => row.some(c => c.includes(lbl))).length;
    if (hit > bestHit) { bestHit = hit; best = i; }
  }
  return bestHit >= 2 ? best : -1;
}
function colIndexByLabel(headerRow, labels) {
  const idx = {};
  const cells = headerRow.map(c => String(c ?? '').replace(/\s+/g, ''));
  for (const [field, cands] of Object.entries(labels)) {
    for (const lbl of cands) { const j = cells.findIndex(c => c.includes(lbl.replace(/\s+/g, ''))); if (j >= 0) { idx[field] = j; break; } }
  }
  return idx;
}
function parseExcel(buf, def) {
  const wb = XLSX.read(buf, { type: 'buffer' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' });
  const hr = findHeaderRow(aoa, def.map);
  if (hr < 0) return { rows: [], screenTotal: null };
  const idx = colIndexByLabel(aoa[hr], def.map);
  const rows = []; let screenTotal = null;
  for (let i = hr + 1; i < aoa.length; i++) {
    const r = aoa[i]; const first = String(r[0] ?? '').trim();
    // 합계/총계 행 → screenTotal(금액계열 최댓값 컬럼)
    if (/합계|총계|총\s*합/.test(r.map(x => String(x ?? '')).join(''))) {
      const tot = idx.total ?? idx.balance ?? idx.amount ?? idx.supplyAmt;
      if (tot != null) screenTotal = num(r[tot]); continue;
    }
    const obj = {};
    for (const [field, j] of Object.entries(idx)) obj[field] = def.numFields.includes(field) ? num(r[j]) : String(r[j] ?? '').trim();
    obj.isSubtotal = /계$/.test(first) && !obj.custCode; // 담당자 소계행(채권)
    const hasData = Object.entries(obj).some(([k, v]) => def.numFields.includes(k) && v !== 0) || obj.custName || obj.custCode;
    if (hasData) rows.push(obj);
  }
  return { rows, screenTotal };
}

async function collect(ctx, page, ds) {
  const def = DEFS[ds];
  if (!READONLY_PRGIDS.has(def.prgId)) throw new Error(`조회 화면 아님: ${def.prgId}`);
  await page.goto(`${ERP}#prgId=${def.prgId}`, { waitUntil: 'networkidle' }).catch(() => {});
  await page.waitForTimeout(2500);
  if (/login\.ecount\.com/i.test(page.url())) throw new Error('ECOUNT 로그인 만료 — login-save.mjs 재실행');
  if (def.form) { await page.keyboard.press('F8').catch(() => {}); await page.waitForTimeout(3000); }
  // Excel 버튼 클릭 → 다운로드 대기 (여러 프레임/셀렉터 시도)
  const clickExcel = async () => {
    for (const f of [page, ...page.frames()]) {
      for (const loc of [f.getByRole?.('button', { name: /^Excel$/i }), f.locator?.('button:has-text("Excel")'), f.locator?.('a:has-text("Excel")'), f.locator?.('text=Excel')]) {
        try { if (loc && await loc.first().isVisible({ timeout: 800 })) { await loc.first().click({ timeout: 1500 }); return true; } } catch {}
      }
    }
    return false;
  };
  const dlPromise = page.waitForEvent('download', { timeout: 15000 }).catch(() => null);
  const clicked = await clickExcel();
  if (!clicked) throw new Error('Excel 버튼을 찾지 못함 (SHOW=1 로 화면 확인 필요)');
  const dl = await dlPromise;
  if (!dl) throw new Error('Excel 다운로드가 시작되지 않음(팝업/형식선택 가능 — SHOW=1 확인)');
  fs.mkdirSync(DL, { recursive: true });
  const file = path.join(DL, `${ds}.xlsx`);
  await dl.saveAs(file);
  const buf = fs.readFileSync(file);
  const { rows, screenTotal } = parseExcel(buf, def);
  return { rows, screenTotal, screenRowCnt: rows.filter(r => !r.isSubtotal).length };
}

async function postIngest(ds, payload) {
  const res = await fetch(`${NENOVA}/api/ecount/ingest`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(COOKIE ? { Cookie: COOKIE } : {}) },
    body: JSON.stringify({ dataset: ds, source: 'owner-pc', ...payload }),
  });
  return await res.json().catch(() => ({ success: false, error: `HTTP ${res.status}` }));
}

(async () => {
  if (!fs.existsSync(PROFILE)) { console.error('ecount-profile 없음 — login-save.mjs 먼저.'); process.exit(1); }
  const targets = process.argv.slice(2).filter(a => DEFS[a]);
  const list = targets.length ? targets : ['sales', 'ar', 'ap', 'cash'];
  const ctx = await chromium.launchPersistentContext(PROFILE, { headless: !process.env.SHOW, viewport: { width: 1600, height: 900 }, acceptDownloads: true });
  await ctx.route('**/*', route => {
    const u = route.request().url(); const m = route.request().method();
    let host = '', pathq = '';
    try { const url = new URL(u); host = url.hostname; pathq = url.pathname + url.search; } catch {}
    const isEcount = /(^|\.)ecount\.com$/i.test(host);
    const isWrite = (WRITE_RE.test(pathq) && !READ_RE.test(pathq)) || ['PUT', 'DELETE', 'PATCH'].includes(m);
    if (isEcount && isWrite) { console.error(`🛑 [READ-ONLY GUARD] ECOUNT 쓰기 차단: ${m} ${u.slice(0, 100)}`); return route.abort(); }
    return route.continue();
  });
  const page = ctx.pages()[0] || await ctx.newPage();
  for (const ds of list) {
    try {
      const data = await collect(ctx, page, ds);
      if (!data.rows.length) { console.log(`[${ds}] 0행 — 엑셀 파싱 실패(헤더 못 찾음). SHOW=1 로 점검.`); continue; }
      const r = await postIngest(ds, data);
      console.log(`[${ds}] rows=${data.rows.length} 화면합계=${data.screenTotal ?? '?'} → ${r.success ? `${r.status} ${r.score}점 (#${r.snapshotKey})` : '전송실패: ' + r.error}`);
    } catch (e) { console.error(`[${ds}] 오류:`, e.message); }
  }
  await ctx.close(); process.exit(0);
})();
