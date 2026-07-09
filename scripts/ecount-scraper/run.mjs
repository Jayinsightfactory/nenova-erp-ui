// ECOUNT 4종 자동수집 — owner PC 에서 실행. 전용 크롬 프로필(ecount-profile) 로그인 상태 재사용.
// 사용: node run.mjs [sales ar ap cash]  (인자 없으면 4종 전부)
// 환경변수: NENOVA_URL(기본 https://nenovaweb.com), NENOVA_COOKIE(nenovaweb 인증 쿠키), SHOW=1(창 보이기)
//
// ⛔⛔ 절대 원칙: ECOUNT 는 읽기 전용. 입력·수정·저장·삭제 절대 금지. ⛔⛔
//   조회(검색/F8)와 화면 읽기만 한다. 2중 하드가드:
//   1) prgId 화이트리스트: 조회 4화면 외 이동 거부(입력화면 접근 불가).
//   2) 네트워크 가드: Save/Insert/Update/Delete/Write 요청은 abort(전송 차단).
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROFILE = path.join(__dirname, 'ecount-profile');
const NENOVA = process.env.NENOVA_URL || 'https://nenovaweb.com';
const COOKIE = process.env.NENOVA_COOKIE || '';
const ERP = 'https://logincc.ecount.com/ec5/view/erp';

const DEFS = {
  cash:  { prgId: 'E010205', form: false, parse: parseCash },  // 입/출금계좌 조회
  ar:    { prgId: 'E040214', form: true,  parse: parseAR },    // 거래처별채권(조회)
  ap:    { prgId: 'E040309', form: true,  parse: parseAP },    // 거래처별채무(조회)
  sales: { prgId: 'E040207', form: true,  parse: parseSales }, // 판매현황(조회)
};
const READONLY_PRGIDS = new Set(Object.values(DEFS).map(d => d.prgId));
const WRITE_URL_RE = /(save|insert|update|delete|remove|write|regist|create|modify|\/ins|\/upd|\/del|submit)/i;
function num(s) { const x = Number(String(s ?? '').replace(/[,\s₩]/g, '')); return Number.isFinite(x) ? x : 0; }

// 모든 프레임(iframe 포함)에서 그리드 행 추출 — 가장 행이 많은 프레임 채택
async function gridRowsAllFrames(page) {
  let best = [];
  for (const f of page.frames()) {
    try {
      const rows = await f.evaluate(() => {
        const o = [];
        for (const tr of document.querySelectorAll('table tr, [role="row"], .cell-row, tr.gridRow')) {
          const cells = [...tr.querySelectorAll('td, [role="gridcell"], .cell')].map(td => (td.innerText || '').trim());
          if (cells.filter(Boolean).length >= 3) o.push(cells);
        }
        return o;
      });
      if (rows.length > best.length) best = rows;
    } catch { /* cross-origin frame skip */ }
  }
  return best;
}
async function screenMeta(page) {
  let txt = '';
  for (const f of page.frames()) { try { txt += '\n' + await f.evaluate(() => document.body.innerText); } catch {} }
  const per = txt.match(/(\d{4}\/\d{2}\/\d{2})\s*~\s*(\d{4}\/\d{2}\/\d{2})/);
  const cnt = txt.match(/총\s*([\d,]+)\s*건/);
  return {
    periodFrom: per ? per[1].replace(/\//g, '-') : null,
    periodTo: per ? per[2].replace(/\//g, '-') : null,
    screenRowCnt: cnt ? Number(cnt[1].replace(/,/g, '')) : null,
  };
}

function parseCash(c) { return { refDate: c[0], flow: c[1], account: c[2], custName: c[5] || c[4], amount: num(c[6]), balance: num(c[9]), counterBank: c[10] }; }
function parseAR(c)   { return { custName: c[0], salesTotal: num(c[1]), receiptTotal: num(c[2]), etcDiff: num(c[3]), balance: num(c[4]), agingMonth: c[5], isSubtotal: /계$/.test((c[0]||'').trim()) }; }
function parseAP(c)   { return { custCode: c[0], custName: c[1], openingDebt: num(c[2]), stockBuy: num(c[3]), acctBuy: num(c[4]), payTotal: num(c[5]), etcDiff: num(c[6]), balance: num(c[7]), unbilled: num(c[8]) }; }
function parseSales(c){ return { refDate: c[0], custName: c[1], prodName: c[2], qty: num(c[3]), unitPrice: num(c[4]), supplyAmt: num(c[5]), vat: num(c[6]), total: num(c[7]), memo: c[8] }; }

async function collect(page, ds) {
  const def = DEFS[ds];
  if (!READONLY_PRGIDS.has(def.prgId)) throw new Error(`조회 화면이 아닌 prgId 접근 차단: ${def.prgId}`);
  await page.goto(`${ERP}#menuType=MENUTREE&prgId=${def.prgId}`, { waitUntil: 'networkidle' }).catch(() => {});
  await page.waitForTimeout(2500);
  if (/login\.ecount\.com/i.test(page.url())) throw new Error('ECOUNT 로그인 만료 — login-save.mjs 재실행 필요');
  if (def.form) { await page.keyboard.press('F8').catch(() => {}); await page.waitForTimeout(3000); }
  const raw = await gridRowsAllFrames(page);
  const meta = await screenMeta(page);
  const rows = raw.map(def.parse).filter(r => r && (r.custName || r.custCode || r.amount || r.balance || r.total));
  return { rows, ...meta, screenTotal: null };
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
  if (!fs.existsSync(PROFILE)) { console.error('ecount-profile 없음 — 먼저 login-save.mjs 로 로그인하세요.'); process.exit(1); }
  const targets = process.argv.slice(2).filter(a => DEFS[a]);
  const list = targets.length ? targets : ['sales', 'ar', 'ap', 'cash'];
  const ctx = await chromium.launchPersistentContext(PROFILE, { headless: !process.env.SHOW, viewport: { width: 1600, height: 900 } });
  await ctx.route('**/*', route => {
    const u = route.request().url(); const m = route.request().method();
    if (/ecount\.com/i.test(u) && (WRITE_URL_RE.test(u) || ['PUT', 'DELETE', 'PATCH'].includes(m))) {
      console.error(`🛑 [READ-ONLY GUARD] 차단: ${m} ${u.slice(0, 110)}`); return route.abort();
    }
    return route.continue();
  });
  const page = ctx.pages()[0] || await ctx.newPage();
  for (const ds of list) {
    try {
      const data = await collect(page, ds);
      if (!data.rows.length) { console.log(`[${ds}] 0행 — 화면 구조/세션 확인 필요(SHOW=1 로 창 띄워 점검)`); continue; }
      const r = COOKIE || NENOVA ? await postIngest(ds, data) : { success: false, error: 'NENOVA 미설정' };
      console.log(`[${ds}] rows=${data.rows.length} 기간=${data.periodFrom}~${data.periodTo} → ${r.success ? `${r.status} ${r.score}점 (#${r.snapshotKey})` : '전송실패: ' + r.error}`);
    } catch (e) { console.error(`[${ds}] 오류:`, e.message); }
  }
  await ctx.close(); process.exit(0);
})();
