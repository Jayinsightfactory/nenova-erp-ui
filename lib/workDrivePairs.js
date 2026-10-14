// lib/workDrivePairs.js
// 업무 드라이브 — 농장 인보이스 PDF ↔ 그걸 변환해 만든 결과 엑셀(원가자료·도착원가·Packing 입고 업로드) 자동 짝짓기.
// 목적: 인보이스→전산 업로드 직접 변환기의 골든테스트 정답 쌍(nenova-work-features/invoice/golden.py 가 내려받음).
// 직원 PC·업무 방식은 그대로 — 데몬이 이미 올린 data/drive/index.jsonl 메타만 읽는다(웹 전용 파일, MSSQL 무관).
// 저장: data/drive/pairs.json (일괄 재계산 결과 통째로 덮어씀, 원본 색인은 건드리지 않음)
//
// 짝 기준(점수 합, 100 상한):
//   같은 업로더 +25 · 시간 근접(엑셀이 PDF 뒤 0~12h +25 / ~72h +12 / 앞뒤 7일 이내 +5)
//   차수 일치(파일명 또는 엑셀 시트명) +30 · 농장명 겹침 +20 · 국가 겹침 +5 · 총액 일치(값이 있을 때, ±1%) +20
//   ≥70 확정(confirmed), 40~69 후보(candidate), 그 아래는 버림. 1:N 허용(한 PDF ↔ 여러 엑셀, 한 엑셀 ↔ 여러 PDF).
import fs from 'fs';
import path from 'path';

export const CONFIRM_SCORE = 70;
export const CANDIDATE_SCORE = 40;
const H = 3600 * 1000;

const INVOICE_RE = /invoice|factura|發票|发票|인보이스|proforma/i;
const NOT_INVOICE_RE = /검역|원산지|패킹리스트|packing\s*list|수출허[가거]|phyto|certificate|awb|b\/?l\b/i;
const RESULT_RE = /원가자료|도착원가|packing|패킹|입고\s*(?:업로드|상세|목록)?/i;

// 농장/공급사 별칭 → 정규 토큰 (실측 파일명: 홀렉스·홀랙스·Holex, 이지플라워·EZ, 프리미엄그린 …)
const FARM_ALIASES = [
  ['holex', /holex|홀[렉랙]스/i],
  ['ez', /이지\s*플라워|easy\s*flower|\bez\b/i],
  ['premiumgreen', /프리미엄\s*그린|premium\s*green/i],
  ['cloud', /cloud|클라우드/i],
  ['dongseo', /동서/i],
];
const COUNTRY_ALIASES = [
  ['NL', /네덜란드|\bnl\b|holland|netherlands|dutch/i],
  ['CO', /콜롬비아|colombia/i],
  ['EC', /에콰도르|ecuador/i],
  ['AU', /호주|australia/i],
  ['CN', /중국|china/i],
  ['KE', /케냐|kenya/i],
  ['ET', /에티오피아|ethiopia/i],
];

const ext = (n) => (String(n || '').split('.').pop() || '').toLowerCase();
const tokens = (s, table) => table.filter(([, re]) => re.test(String(s || ''))).map(([t]) => t);
const ts = (r) => { const t = Date.parse(r.mtime || r.uploadedAt || ''); return Number.isFinite(t) ? t : null; };
// 차수 정규화(파일명/시트명): "07-1", "09-2 ", "0901", "16-1(예시)" → "7-1" 형태로 맞춰 비교
export function normCycle(s) {
  const m = String(s || '').match(/(?:^|[^\d])(\d{1,2})\s*[-_]\s*0?(\d)(?!\d)/) || String(s || '').match(/(?:^|[^\d])(\d{2})0(\d)(?=차|_|\s|\.|$)/);
  return m ? `${Number(m[1])}-${Number(m[2])}` : '';
}

export function isInvoiceFile(r) {
  if (ext(r.filename) !== 'pdf') return false;
  const n = String(r.filename || '') + ' ' + String(r.pdfText || '').slice(0, 4000);
  if (INVOICE_RE.test(n)) return true;
  return /수입서류/.test(r.filename || '') && !NOT_INVOICE_RE.test(r.filename || ''); // "수입서류.pdf" 묶음본
}
export function isResultWorkbook(r) {
  return /^(xlsx|xlsm|xls)$/.test(ext(r.filename)) && RESULT_RE.test(String(r.filename || '')) && !/발주|송금|견적|거래명세/.test(r.filename || '');
}

// 한 쌍 점수 + 근거
export function scorePair(inv, wb) {
  const reasons = [];
  let score = 0;
  if (inv.uploaderName && inv.uploaderName === wb.uploaderName) { score += 25; reasons.push(`같은 업로더(${inv.uploaderName})`); }
  const ti = ts(inv), tw = ts(wb);
  if (ti != null && tw != null) {
    const d = tw - ti;
    if (d >= 0 && d <= 12 * H) { score += 25; reasons.push(`PDF 뒤 ${(d / H).toFixed(1)}시간 내 엑셀`); }
    else if (d >= 0 && d <= 72 * H) { score += 12; reasons.push(`PDF 뒤 ${(d / H).toFixed(0)}시간 엑셀`); }
    else if (Math.abs(d) <= 7 * 24 * H) { score += 5; reasons.push('7일 이내'); }
  }
  const ic = normCycle(inv.cycle) || normCycle(inv.filename);
  const wc = normCycle(wb.cycle) || normCycle(wb.filename);
  const sheetCycles = (wb.sheetNames || []).map(normCycle).filter(Boolean);
  let sheet = '';
  if (ic && ic === wc) { score += 30; reasons.push(`차수 일치(${ic})`); }
  else if (ic && sheetCycles.includes(ic)) { score += 30; sheet = (wb.sheetNames || []).find((s) => normCycle(s) === ic) || ''; reasons.push(`엑셀 시트 차수 일치(${sheet.trim()})`); }
  else if (ic && wc && ic !== wc && !sheetCycles.length) { score -= 20; reasons.push(`차수 다름(${ic}≠${wc})`); }
  const wbText = `${wb.filename} ${(wb.sheetNames || []).join(' ')}`;
  const farm = tokens(inv.filename, FARM_ALIASES).filter((t) => tokens(wbText, FARM_ALIASES).includes(t));
  if (farm.length) { score += 20; reasons.push(`농장명 겹침(${farm.join(',')})`); }
  const ctry = tokens(inv.filename, COUNTRY_ALIASES).filter((t) => tokens(wbText, COUNTRY_ALIASES).includes(t));
  if (ctry.length) { score += 5; reasons.push(`국가 겹침(${ctry.join(',')})`); }
  const a = Number(inv.totalAmount), b = Number(wb.totalAmount);
  if (a > 0 && b > 0) {
    if (Math.abs(a - b) / a <= 0.01) { score += 20; reasons.push(`총액 일치(${a}≈${b})`); }
    else { score -= 10; reasons.push(`총액 다름(${a}≠${b})`); }
  }
  score = Math.max(0, Math.min(100, score));
  return { score, sheet, reasons };
}

// rows: 드라이브 파일 행(삭제 제외) → pairs[]
export function computePairs(rows) {
  const live = (rows || []).filter((r) => r && !r.deleted && !r.egressSnapshot && r.type !== 'download');
  const invoices = live.filter(isInvoiceFile);
  const workbooks = live.filter(isResultWorkbook);
  const pairs = [];
  for (const inv of invoices) {
    for (const wb of workbooks) {
      const s = scorePair(inv, wb);
      if (s.score < CANDIDATE_SCORE) continue;
      pairs.push({
        id: `${inv.id}__${wb.id}`,
        status: s.score >= CONFIRM_SCORE ? 'confirmed' : 'candidate',
        confidence: s.score / 100,
        score: s.score,
        reasons: s.reasons,
        cycle: normCycle(inv.cycle) || normCycle(inv.filename),
        sheet: s.sheet,
        invoice: brief(inv),
        workbook: brief(wb),
      });
    }
  }
  pairs.sort((x, y) => y.score - x.score || String(x.id).localeCompare(String(y.id)));
  return { invoices: invoices.length, workbooks: workbooks.length, pairs };
}
const brief = (r) => ({ id: r.id, filename: r.filename, sha: r.sha, size: r.size, uploaderName: r.uploaderName, uploadedAt: r.uploadedAt, mtime: r.mtime || null, cycle: r.cycle || '', sourceDir: r.sourceDir || '' });

// ── 파일 IO (data/drive) ───────────────────────────────────────────────────────
const root = () => path.join(process.cwd(), 'data', 'drive');
const pairsFile = () => path.join(root(), 'pairs.json');

// index.jsonl 은 추가만 → 같은 id 는 마지막 행이 현재 상태
export function readDriveFiles() {
  let lines = [];
  try { lines = fs.readFileSync(path.join(root(), 'index.jsonl'), 'utf8').split('\n').filter(Boolean); } catch { return []; }
  const byId = new Map();
  for (const l of lines) { try { const r = JSON.parse(l); if (r && r.id && r.type !== 'download' && r.filename) byId.set(r.id, r); } catch {} }
  return [...byId.values()];
}

// 엑셀 시트명(차수가 시트에만 있는 "Holex 2026 원가자료.xlsx" 대비). xlsxLib 미주입이면 생략.
function withSheetNames(rows, xlsxLib) {
  if (!xlsxLib) return rows;
  return rows.map((r) => {
    if (!isResultWorkbook(r) || !r.rel) return r;
    const abs = path.join(root(), r.rel);
    if (!abs.startsWith(root()) || !fs.existsSync(abs)) return r;
    try { const wb = xlsxLib.read(fs.readFileSync(abs), { type: 'buffer', bookSheets: true }); return { ...r, sheetNames: wb.SheetNames || [] }; } catch { return r; }
  });
}

export function recomputePairs({ xlsxLib = null } = {}) {
  const rows = withSheetNames(readDriveFiles(), xlsxLib);
  const out = computePairs(rows);
  const doc = { generatedAt: new Date().toISOString(), confirmScore: CONFIRM_SCORE, candidateScore: CANDIDATE_SCORE, ...out,
    counts: { confirmed: out.pairs.filter((p) => p.status === 'confirmed').length, candidate: out.pairs.filter((p) => p.status === 'candidate').length } };
  fs.mkdirSync(root(), { recursive: true });
  fs.writeFileSync(pairsFile(), JSON.stringify(doc, null, 1));
  return doc;
}
export function readPairs() { try { return JSON.parse(fs.readFileSync(pairsFile(), 'utf8')); } catch { return null; } }

// 새 파일 수신 시: 인보이스/결과 엑셀일 때만 재계산(그 외 파일은 비용 0)
export function onFileIngested(row, opts) {
  if (!row || !(isInvoiceFile(row) || isResultWorkbook(row))) return null;
  return recomputePairs(opts);
}
