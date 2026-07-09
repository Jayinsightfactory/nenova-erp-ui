// ECOUNT 4종 자동수집 — owner PC 에서 실행. storageState.json(로그인 세션) 필요.
// 사용: node run.mjs [sales ar ap cash]  (인자 없으면 4종 전부)
// 환경변수: NENOVA_URL(기본 https://nenovaweb.com), NENOVA_COOKIE(nenovaweb 인증 쿠키)
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE = path.join(__dirname, 'storageState.json');
const NENOVA = process.env.NENOVA_URL || 'https://nenovaweb.com';
const COOKIE = process.env.NENOVA_COOKIE || '';
const ERP = 'https://logincc.ecount.com/ec5/view/erp';

// 데이터셋별 화면 정보 (prgId + 파서). 컬럼 순서는 화면 그리드 기준.
const DEFS = {
  cash:  { prgId: 'E010205', form: false, parse: parseCash },
  ar:    { prgId: 'E040214', form: true,  parse: parseAR },
  ap:    { prgId: 'E040309', form: true,  parse: parseAP },
  sales: { prgId: 'E040207', form: true,  parse: parseSales },
};

function num(s) { const x = Number(String(s ?? '').replace(/[,\s₩]/g, '')); return Number.isFinite(x) ? x : 0; }

async function gridRows(page) {
  // ECOUNT listx 그리드: 데이터 행 텍스트를 2차원으로. 화면 구조가 바뀌면 여기만 조정.
  return await page.evaluate(() => {
    const out = [];
    const rows = document.querySelectorAll('table tr, .gridRow, [role="row"]');
    for (const tr of rows) {
      const cells = [...tr.querySelectorAll('td, [role="gridcell"]')].map(td => td.innerText.trim());
      if (cells.length) out.push(cells);
    }
    return out;
  });
}
async function screenMeta(page) {
  // 기간(2026/06/01 ~ 2026/07/09)과 "총 N건" 텍스트 추출 시도
  const txt = await page.evaluate(() => document.body.innerText);
  const per = txt.match(/(\d{4}\/\d{2}\/\d{2})\s*~\s*(\d{4}\/\d{2}\/\d{2})/);
  const cnt = txt.match(/총\s*([\d,]+)\s*건/);
  return {
    periodFrom: per ? per[1].replace(/\//g, '-') : null,
    periodTo: per ? per[2].replace(/\//g, '-') : null,
    screenRowCnt: cnt ? Number(cnt[1].replace(/,/g, '')) : null,
  };
}

// ── 파서 (컬럼 매핑은 화면 컬럼 순서 기준; 실제 실행 시 1회 검증 필요)
function parseCash(c) { return { refDate: c[0], flow: c[1], account: c[2], custName: c[5] || c[4], amount: num(c[6]), balance: num(c[9]), counterBank: c[10] }; }
function parseAR(c)   { return { custName: c[0], salesTotal: num(c[1]), receiptTotal: num(c[2]), etcDiff: num(c[3]), balance: num(c[4]), agingMonth: c[5], isSubtotal: /계$/.test((c[0]||'').trim()) }; }
function parseAP(c)   { return { custCode: c[0], custName: c[1], openingDebt: num(c[2]), stockBuy: num(c[3]), acctBuy: num(c[4]), payTotal: num(c[5]), etcDiff: num(c[6]), balance: num(c[7]), unbilled: num(c[8]) }; }
function parseSales(c){ return { refDate: c[0], custName: c[1], prodName: c[2], qty: num(c[3]), unitPrice: num(c[4]), supplyAmt: num(c[5]), vat: num(c[6]), total: num(c[7]), memo: c[8] }; }

async function collect(page, ds) {
  const def = DEFS[ds];
  await page.goto(`${ERP}#prgId=${def.prgId}`, { waitUntil: 'networkidle' }).catch(() => {});
  await page.waitForTimeout(1500);
  if (def.form) {
    // 검색(F8) — 폼형 화면
    await page.keyboard.press('F8').catch(() => {});
    await page.waitForTimeout(2500);
  }
  const raw = await gridRows(page);
  const meta = await screenMeta(page);
  // 헤더/합계 행 제거: 숫자 컬럼이 전혀 없는 행은 스킵
  const rows = raw.map(def.parse).filter(r => r && (r.custName || r.custCode || r.amount || r.balance));
  const screenTotal = rows.filter(r => !r.isSubtotal).reduce((s, r) => s + num(r.amount ?? r.total ?? r.supplyAmt ?? r.balance), 0);
  return { rows, ...meta, screenTotal: null }; // screenTotal 은 화면 합계행을 못 읽으면 null (서버가 자기검증 스킵)
}

async function postIngest(ds, payload) {
  const res = await fetch(`${NENOVA}/api/ecount/ingest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(COOKIE ? { Cookie: COOKIE } : {}) },
    body: JSON.stringify({ dataset: ds, source: 'owner-pc', ...payload }),
  });
  return await res.json().catch(() => ({ success: false, error: `HTTP ${res.status}` }));
}

(async () => {
  if (!fs.existsSync(STATE)) { console.error('storageState.json 없음 — 먼저 login-save.mjs 로 로그인하세요.'); process.exit(1); }
  const targets = process.argv.slice(2).filter(a => DEFS[a]);
  const list = targets.length ? targets : ['sales', 'ar', 'ap', 'cash'];
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ storageState: STATE });
  const page = await ctx.newPage();
  for (const ds of list) {
    try {
      const data = await collect(page, ds);
      const r = await postIngest(ds, data);
      console.log(`[${ds}] rows=${data.rows.length} → ${r.success ? `${r.status} ${r.score}점 (#${r.snapshotKey})` : '실패: ' + r.error}`);
    } catch (e) { console.error(`[${ds}] 오류:`, e.message); }
  }
  await browser.close();
})();
