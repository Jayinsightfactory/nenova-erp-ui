// ECOUNT 수집 공통 코어 (run.mjs 단발 / daemon.mjs 상주 공용). ⛔ 읽기 전용.
import XLSX from 'xlsx';
import recovery from '../../lib/ecountCollectorRecovery.cjs';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const PROFILE = process.env.ECOUNT_PROFILE_DIR || path.join(__dirname, 'ecount-profile');
const DL = path.join(__dirname, '_downloads');
export const ERP_ROOT = 'https://logincc.ecount.com/ec56/view/erp'; // 2026-10-08: 이카운트가 /ec5 → /ec56 으로 바뀜(옛 주소는 로그인 페이지로 튕겨 "만료" 오판)

// hash = ECOUNT SPA 메뉴 해시(브라우저 조사로 확보). 세션ID 유지한 채 이 해시로 앱내 이동해야 로그인 안 튕김.
export const DEFS = {
  cash: { prgId: 'E010205', form: false, hash: '#menuType=MENUTREE_000001&menuSeq=MENUTREE_002563&groupSeq=MENUTREE_002562&prgId=E010205&depth=3', map: { refDate: ['일자', '입출금일'], flow: ['구분'], account: ['계좌번호', '계좌'], custName: ['거래처명', '거래처'], amount: ['금액'], balance: ['원화잔액', '잔액'], counterBank: ['상대은행', '지점'] }, numFields: ['amount', 'balance'] },
  ar: { prgId: 'E040214', form: true, hash: '#menuType=MENUTREE_000004&menuSeq=MENUTREE_000500&groupSeq=MENUTREE_000030&prgId=E040214&depth=4', map: { custName: ['거래처명'], salesTotal: ['매출합계'], receiptTotal: ['수급합계', '수금합계'], etcDiff: ['기타할인', '기타'], balance: ['잔액'], agingMonth: ['미회수'] }, numFields: ['salesTotal', 'receiptTotal', 'etcDiff', 'balance'] },
  ap: { prgId: 'E040309', form: true, hash: '#menuType=MENUTREE_000004&menuSeq=MENUTREE_000517&groupSeq=MENUTREE_000031&prgId=E040309&depth=4', map: { custCode: ['거래처코드'], custName: ['거래처명'], openingDebt: ['기초채무'], stockBuy: ['재고매입'], acctBuy: ['회계매입'], payTotal: ['지급합계'], etcDiff: ['기타할인', '기타'], balance: ['잔액'], unbilled: ['미청구'] }, numFields: ['openingDebt', 'stockBuy', 'acctBuy', 'payTotal', 'etcDiff', 'balance', 'unbilled'] },
  sales: { prgId: 'E040207', form: true, hash: '#menuType=MENUTREE_000004&menuSeq=MENUTREE_000494&groupSeq=MENUTREE_000030&prgId=E040207&depth=4', map: { refDate: ['일자'], custName: ['거래처명'], prodName: ['품목명', '품목'], qty: ['수량'], unitPrice: ['단가'], supplyAmt: ['공급가액'], vat: ['부가세'], total: ['합계'], memo: ['적요'] }, numFields: ['qty', 'unitPrice', 'supplyAmt', 'vat', 'total'] },
  // 2026-10-22 사장님 결정 "수집에 넣어": 판매조회·회계거래조회. 두 화면 모두 기본 검색 기간이 전월+금월 이상(판매조회 9/1~11/30, 회계거래조회 9/1~오늘)이라
  //   검색 조건은 건드리지 않고 기본값으로 F8 → Excel(전체 결과, 페이지 무관)만 받는다. '일자-No.'/'전표번호' 칸의 '2026/10/20 -12' 를 sourceDateLabel 로 보낸다.
  saleQuery: { prgId: 'E040206', form: true, hash: '#menuType=MENUTREE_000004&menuSeq=MENUTREE_000492&groupSeq=MENUTREE_000030&prgId=E040206&depth=4', map: { sourceDateLabel: ['일자-No.', '일자'], custName: ['거래처명'], prodName: ['품목명'], amount: ['금액합계', '금액'], tradeType: ['거래유형'] }, numFields: ['amount'] },
  journal: { prgId: 'E010701', form: true, hash: '#menuType=MENUTREE_000001&menuSeq=MENUTREE_000098&groupSeq=MENUTREE_000016&prgId=E010701&depth=3', map: { sourceDateLabel: ['전표번호', '일자'], tradeType: ['거래유형'], amount: ['금액'], custName: ['거래처명'], memo: ['적요'] }, numFields: ['amount'] },
  // 2026-11-17 사장님 결정: 직원이 쓰는 견적서조회·구매조회·구매현황 매일 수집 추가. 검색 조건(기간·진행상태 등)은 건드리지 않고 기본값 그대로 F8 → Excel 만 받는다.
  //   머리글은 웹 워크벤치 화면 열 이름(QUOTE_COLUMNS·PURCHASE_COLUMNS·PURCHASE_STATUS_COLUMNS)과 업로드 별칭을 따랐다. 실제 엑셀 머리글은 미확인 → 첫 수집 로그로 확인 필요.
  //   견적서조회 '진행상태'는 quoteStatus 로 보내지 않는다(값 어휘·근거 미확인). 원문만 statusText 로 Payload 에 남기고 웹 작업본에는 반영되지 않는다.
  //   '금액합계'(구매조회)는 '외화금액합계'에도 부분일치하므로 화면 순서상 먼저 나오는 열이 잡힌다(금액합계 → 외화금액합계).
  quote: { prgId: 'E040202', form: true, hash: '#menuType=MENUTREE_000004&menuSeq=MENUTREE_000487&groupSeq=MENUTREE_000030&prgId=E040202&depth=4', map: { sourceDateLabel: ['일자-No.', '일자'], custName: ['거래처명'], prodName: ['품목명(요약)', '품목명'], estimateTotal: ['견적금액합계', '견적합계', '금액합계'], statusText: ['진행상태'] }, numFields: ['estimateTotal'] },
  purchase: { prgId: 'E040304', form: true, hash: '#menuType=MENUTREE_000004&menuSeq=MENUTREE_000511&groupSeq=MENUTREE_000031&prgId=E040304&depth=4', map: { sourceDateLabel: ['일자-No.', '일자'], custName: ['거래처명'], prodName: ['품목명(요약)', '품목명'], amountTotal: ['금액합계'], foreignTotal: ['외화금액합계'], exchangeRate: ['환율'] }, numFields: ['amountTotal', 'foreignTotal', 'exchangeRate'] },
  buyStatus: { prgId: 'E040305', form: true, hash: '#menuType=MENUTREE_000004&menuSeq=MENUTREE_000513&groupSeq=MENUTREE_000031&prgId=E040305&depth=4', map: { sourceDateLabel: ['일자-No.', '일자'], custName: ['거래처명'], prodName: ['품목명(규격)', '품목명'], qty: ['수량'], boxQty: ['박스수량'], unitPrice: ['단가'], foreignAmount: ['외화금액'], supplyAmt: ['공급가액'], exchangeRate: ['환율'], total: ['합계'], weight: ['Weight', 'WEIGHT', '중량'] }, numFields: ['qty', 'boxQty', 'unitPrice', 'foreignAmount', 'supplyAmt', 'exchangeRate', 'total', 'weight'] },
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
    if (isEcount && isWrite) { console.error(`🛑 [READ-ONLY GUARD] ECOUNT 쓰기 차단: ${m}`); return route.abort(); }
    return route.continue();
  });
}

export function isLoginPage(page) { return recovery.isSourceLoginUrl(page.url()); }

// 앱 세션 부팅: 루트로 이동해 쿠키→세션 복원. 성공 시 세션ID 포함된 base URL(해시 제외) 반환, 실패 시 null.
export async function ensureBooted(page) {
  // Login redirects may never become network-idle. Bound DOM readiness, then pin the real ERP path.
  if(recovery.isSourceErpUrl(page.url())){
    await page.waitForLoadState('domcontentloaded',{timeout:15000}).catch(()=>{});
    await page.waitForTimeout(2500);
    if(recovery.isSourceErpUrl(page.url()))return page.url().split('#')[0];
  }
  await page.goto(ERP_ROOT,{waitUntil:'domcontentloaded',timeout:30000}).catch(()=>{});
  await page.waitForTimeout(2500);
  return recovery.isSourceErpUrl(page.url())?page.url().split('#')[0]:null;
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
  if (isLoginPage(page)) throw new Error('LOGIN_EXPIRED');
  if (def.form) { await page.keyboard.press('F8').catch(() => {}); await page.waitForTimeout(3000); }
  // 2026-11-16: Excel 이 새 창에서 내려받는 화면도 잡도록 page 가 아닌 context 단위로 다운로드를 기다린다. 판매현황은 6천 행 이상이라 로딩이 길어 대기 180초.
  const dlP = page.context().waitForEvent('download', { timeout: ds === 'sales' ? 180000 : 15000 }).catch(() => null);
  let clicked = false;
  for (let attempt = 0; attempt < 4 && !clicked; attempt++) { if (attempt) await page.waitForTimeout(8000); // 2026-10-08: 그리드 로딩 지연·공지 팝업으로 Excel 버튼이 늦게 보이는 경우 재시도(10/9 야간 3회 '버튼 못 찾음' → 3회·8초로 확대)
  for (const f of [page, ...page.frames()]) {
    for (const loc of [f.getByRole?.('button', { name: /^Excel$/i }), f.locator?.('button:has-text("Excel")'), f.locator?.('a:has-text("Excel")'), f.locator?.('text=Excel')]) {
      try { if (loc && await loc.first().isVisible({ timeout: 700 })) { await loc.first().click({ timeout: 1500 }); clicked = true; break; } } catch {}
    }
    if (clicked) break;
  }
  }
  if (!clicked) throw new Error('Excel 버튼 못 찾음');
  // 2026-11-16: Excel 버튼이 선택 메뉴(Excel(데이터))를 여는 화면 — 다운로드가 바로 시작되지 않으면 그 메뉴의 데이터 항목을 눌러 내보낸다(조회 전용 내보내기).
  await page.waitForTimeout(1500);
  for (const f of [page, ...page.frames()]) {
    try { const item = f.getByText(/^Excel\(데이터\)$/).first(); if (await item.isVisible({ timeout: 500 })) { await item.click({ timeout: 1500 }); break; } } catch {}
  }
  let dl = null;
  if (ds === 'sales') { // 판매현황: 로딩 중 눌린 Excel 은 무시될 수 있어 45초마다 다시 누른다(최대 3회). 이미 받기 시작했으면 중복 클릭 안 함.
    let done = false; dlP.then(() => { done = true; });
    for (let r = 0; r < 4 && !done; r++) {
      await Promise.race([dlP, page.waitForTimeout(45000)]);
      if (done) break;
      if (r === 1) { // 판매현황: Excel(화면)이 6천 행에서 안 내려가면 옆 ▲ 메뉴의 Excel(데이터)를 눌러 본다. 메뉴 항목을 못 찾으면 메뉴 캡처(sales-menu.png)를 남긴다(조회 전용).
        try {
          for (const f of [page, ...page.frames()]) {
            const arrow = f.locator('button:has-text("Excel(화면)") + button, a:has-text("Excel(화면)") + a, button:has-text("Excel(화면)") ~ button').first();
            if (await arrow.isVisible({ timeout: 500 })) {
              await arrow.click({ timeout: 1500 }); await page.waitForTimeout(800);
              const item = f.getByText(/Excel\(데이터\)/).first();
              if (await item.isVisible({ timeout: 800 })) await item.click({ timeout: 1500 });
              else { fs.mkdirSync(DL, { recursive: true }); await page.screenshot({ path: path.join(DL, 'sales-menu.png') }).catch(() => {}); }
              break;
            }
          }
        } catch {}
      }
      for (const f of [page, ...page.frames()]) { try { const b = f.getByRole?.('button', { name: /^Excel/i }).first(); if (b && await b.isVisible({ timeout: 500 })) { await b.click({ timeout: 1500 }); break; } } catch {} }
    }
  }
  dl = await dlP;
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
