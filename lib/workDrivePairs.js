// lib/workDrivePairs.js
// 업무 드라이브 인보이스 ↔ 결과 엑셀 자동 짝짓기 (웹 전용, 파일만 — MSSQL 무관).
// 수입부가 받은 농장 인보이스 PDF 와 그걸 옮긴 결과 엑셀(원가자료·도착원가·Packing/입고 업로드)을
// 업로더·시간·차수·농장명·총액 근거로 묶는다. 용도: nenova-work-features/invoice/golden.py 골든테스트 정답 쌍.
// 저장: data/drive/pairs.json (결과)  ·  data/drive/pair-features.json (PDF 텍스트·엑셀 시트/합계 캐시, 스크립트가 채움)
// 직원 PC·업무 방식은 그대로 — 이미 올라온 index.jsonl 만 읽는다.
import fs from 'fs';
import path from 'path';

const root = () => path.join(process.cwd(), 'data', 'drive');
const pairsFile = () => path.join(root(), 'pairs.json');
const featuresFile = () => path.join(root(), 'pair-features.json');

export const CONFIRM_SCORE = 0.7;   // 이상이면 '확정', 아래(≥ CANDIDATE_SCORE)는 '후보'
export const CANDIDATE_SCORE = 0.35;
export const MAX_GAP_HOURS = 72;    // PDF 이후 이 시간 안에 올라온 엑셀만 본다(뒤로 1시간 여유)

const INVOICE_NAME_RE = /invoice|factura|发票|發票|인보이스|proforma|\binv[\s_-]?\d|commercial/i;
const INVOICE_TEXT_RE = /\binvoice\b|factura|发票|發票|commercial invoice|proforma/i;
const RESULT_NAME_RE = /원가자료|도착원가|packing|패킹|입고\s*(업로드|상세|목록)?|arrival/i;
const NOT_INVOICE_RE = /awb|phyto|원산지|수출허가|허거서|b\/l|certificate|packing\s*list/i;

// 차수: "42-01" "4201" "42-1차" "42차" → "42-1" / "42"
export function cyclesOf(text) {
  const s = String(text || '');
  const out = new Set();
  for (const m of s.matchAll(/(?:^|[^\d])(\d{2})\s*[-_]\s*0?([1-4])(?!\d)/g)) { const a = +m[1]; if (a >= 1 && a <= 53) out.add(`${a}-${+m[2]}`); }
  for (const m of s.matchAll(/(?:^|[^\dA-Za-z])(\d{2})0([1-4])(?=차|_|\s|\.|$)/g)) { const a = +m[1]; if (a >= 1 && a <= 53) out.add(`${a}-${+m[2]}`); }
  if (!out.size) for (const m of s.matchAll(/(?:^|[^\d])(\d{2})\s*차(?!수)/g)) { const a = +m[1]; if (a >= 1 && a <= 53) out.add(`${a}`); }
  return [...out];
}

// 농장/공급처 토큰(한글 표기 포함). 파일명·시트명 양쪽에서 같은 별칭 그룹이면 겹침으로 본다.
const FARM_GROUPS = [
  ['holex', '홀렉스', '홀랙스'], ['ez flower', 'ezflower', '이지플라워'], ['premium green', '프리미엄그린'],
  ['ayura', '아유라'], ['tiba', '티바'], ['florca', '플로르카'], ['benchmark', '벤치마크'], ['sunshine', '선샤인'],
  ['esperance', '에스페란스'], ['prestige', '프레스티지'], ['monika', '모니카'], ['princess', '프린세스'],
  ['julieta', '줄리에타'], ['gambur', '감부르'], ['colibri', '콜리브리'], ['elite', '엘리트'], ['unique', '유니크'],
  ['natuflora', '나투플로라'], ['multiflora', '멀티플로라'], ['daflor', '다플로르'], ['ecoflor', '에코플로르'],
  ['florentina', '플로렌티나'], ['verdnatura', '베르드나투라'], ['yunnan', '윈난', '운남'], ['royal base', '로얄베이스'],
  ['rainbow', '레인보우'], ['greenland', 'green land', '그린랜드'], ['teucali', '테우칼리'], ['milagro', '밀라그로'],
];
const COUNTRY_GROUPS = [['네덜란드', 'nl', 'holland', 'netherlands'], ['콜롬비아', 'colombia', 'col'], ['에콰도르', 'ecuador', 'ecua'], ['호주', 'australia', 'aus'], ['중국', 'china', 'cn'], ['태국', 'thailand'], ['케냐', 'kenya']];
function groupsIn(text, groups) {
  const s = ` ${String(text || '').toLowerCase().replace(/[_\-.()[\]]/g, ' ')} `;
  const hit = new Set();
  groups.forEach((g, i) => { for (const t of g) { const re = /^[a-z ]+$/.test(t) ? new RegExp(`[^a-z]${t}[^a-z]`) : null; if (re ? re.test(s) : s.includes(t)) { hit.add(i); break; } } });
  return hit;
}
export const farmsOf = (text) => groupsIn(text, FARM_GROUPS);
export const countriesOf = (text) => groupsIn(text, COUNTRY_GROUPS);

export function isInvoiceFile(row, feat = {}) {
  const name = String(row?.filename || '');
  if (!/\.pdf$/i.test(name)) return false;
  if (INVOICE_NAME_RE.test(name)) return true;
  if (NOT_INVOICE_RE.test(name)) return false;
  return INVOICE_TEXT_RE.test(String(feat.text || '').slice(0, 20000));
}
export function isResultWorkbook(row, feat = {}) {
  const name = String(row?.filename || '');
  if (!/\.(xlsx|xlsm|xls)$/i.test(name)) return false;
  if (RESULT_NAME_RE.test(name)) return true;
  return (feat.sheets || []).some((s) => RESULT_NAME_RE.test(s) || cyclesOf(s).length > 0) && cyclesOf(name).length > 0;
}

const hoursBetween = (a, b) => (Date.parse(b) - Date.parse(a)) / 3600000;
const timeOf = (r) => r.mtime && !Number.isNaN(Date.parse(r.mtime)) ? r.mtime : r.uploadedAt;
const nearlyEqual = (a, b) => a > 0 && b > 0 && Math.abs(a - b) / Math.max(a, b) <= 0.005;

// 인보이스 1건 × 엑셀 1건 점수. 반환 { score, reasons[] } — reasons 는 사람이 읽는 근거.
export function scorePair(inv, xl, fInv = {}, fXl = {}) {
  const reasons = [];
  let score = 0;
  if (inv.uploaderName && inv.uploaderName === xl.uploaderName) { score += 0.2; reasons.push(`같은 업로더(${inv.uploaderName})`); }
  const gap = hoursBetween(timeOf(inv), timeOf(xl));
  if (Number.isFinite(gap)) {
    if (gap >= -1 && gap <= 6) { score += 0.2; reasons.push(`PDF 후 ${gap.toFixed(1)}시간 내 엑셀`); }
    else if (gap > 6 && gap <= 24) { score += 0.12; reasons.push(`PDF 후 ${gap.toFixed(0)}시간`); }
    else if (gap > 24 && gap <= MAX_GAP_HOURS) { score += 0.05; reasons.push(`PDF 후 ${gap.toFixed(0)}시간(먼 편)`); }
  }
  const invCycles = new Set([...cyclesOf(inv.filename), ...(inv.cycle ? [inv.cycle] : [])]);
  const xlCycles = new Set([...cyclesOf(xl.filename), ...(xl.cycle ? [xl.cycle] : []), ...(fXl.sheets || []).flatMap(cyclesOf)]);
  const sharedCycle = [...invCycles].find((c) => xlCycles.has(c));
  const sharedMajor = !sharedCycle && [...invCycles].find((c) => [...xlCycles].some((x) => x.split('-')[0] === c.split('-')[0]));
  if (sharedCycle) { score += 0.3; reasons.push(`차수 일치(${sharedCycle})`); }
  else if (sharedMajor) { score += 0.12; reasons.push(`회차 일치(${sharedMajor.split('-')[0]}차)`); }
  else if (invCycles.size && xlCycles.size) { score -= 0.25; reasons.push('차수 다름'); }
  const invFarms = farmsOf(`${inv.filename} ${String(fInv.text || '').slice(0, 3000)}`);
  const xlFarms = farmsOf(`${xl.filename} ${(fXl.sheets || []).join(' ')}`);
  const farm = [...invFarms].find((i) => xlFarms.has(i));
  if (farm !== undefined) { score += 0.2; reasons.push(`농장 일치(${FARM_GROUPS[farm][0]})`); }
  else if (invFarms.size && xlFarms.size) { score -= 0.1; reasons.push('농장 다름'); }
  else {
    const c = [...countriesOf(inv.filename)].find((i) => countriesOf(xl.filename).has(i));
    if (c !== undefined) { score += 0.08; reasons.push(`국가 일치(${COUNTRY_GROUPS[c][0]})`); }
  }
  const tot = (fInv.totals || []).find((t) => (fXl.totals || []).some((x) => nearlyEqual(t, x)));
  if (tot) { score += 0.25; reasons.push(`총액 일치(${tot})`); }
  return { score: Math.max(0, Math.min(1, +score.toFixed(3))), reasons };
}

// rows: index 최신 행들(삭제 제외). features: { [fileId]: { text?, sheets?, totals? } }
// 1:N 허용 — 인보이스마다 기준 이상 엑셀 전부(최고점 순). 엑셀 하나가 여러 인보이스(같은 차수 여러 농장)에 걸릴 수도 있다.
export function computePairs(rows, features = {}) {
  const live = rows.filter((r) => r && !r.deleted && !r.egressSnapshot && r.type !== 'download');
  const invoices = live.filter((r) => isInvoiceFile(r, features[r.id]));
  const books = live.filter((r) => isResultWorkbook(r, features[r.id]));
  const pairs = [];
  for (const inv of invoices) {
    const matches = [];
    for (const xl of books) {
      const gap = hoursBetween(timeOf(inv), timeOf(xl));
      const s = scorePair(inv, xl, features[inv.id], features[xl.id]);
      // 시간창 밖이면 차수+농장 근거가 둘 다 있을 때만(나중에 정리해 올린 경우)
      if (!(gap >= -1 && gap <= MAX_GAP_HOURS) && !(s.reasons.some((x) => x.startsWith('차수 일치')) && s.reasons.some((x) => x.startsWith('농장 일치')))) continue;
      if (s.score < CANDIDATE_SCORE) continue;
      matches.push({ excelId: xl.id, excelName: xl.filename, excelUploader: xl.uploaderName, excelAt: timeOf(xl), confidence: s.score, status: s.score >= CONFIRM_SCORE ? 'confirmed' : 'candidate', reasons: s.reasons });
    }
    if (!matches.length) continue;
    matches.sort((a, b) => b.confidence - a.confidence);
    pairs.push({ invoiceId: inv.id, invoiceName: inv.filename, uploaderName: inv.uploaderName, invoiceAt: timeOf(inv), cycle: inv.cycle || cyclesOf(inv.filename)[0] || '',
      status: matches[0].status, confidence: matches[0].confidence, matches });
  }
  pairs.sort((a, b) => (b.invoiceAt > a.invoiceAt ? 1 : -1));
  const summary = { invoices: invoices.length, workbooks: books.length, paired: pairs.length,
    confirmed: pairs.filter((p) => p.status === 'confirmed').length, candidate: pairs.filter((p) => p.status === 'candidate').length,
    links: pairs.reduce((a, p) => a + p.matches.length, 0) };
  return { summary, pairs };
}

// ── 파일 저장(드라이브 색인 → pairs.json) ────────────────────────────────
function readJson(file, fallback) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } }
export function readFeatures() { return readJson(featuresFile(), {}); }
export function writeFeatures(f) { fs.mkdirSync(root(), { recursive: true }); fs.writeFileSync(featuresFile(), JSON.stringify(f)); }
export function latestDriveRows() {
  let lines = [];
  try { lines = fs.readFileSync(path.join(root(), 'index.jsonl'), 'utf8').split('\n').filter(Boolean); } catch { return []; }
  const latest = new Map();
  for (const l of lines) { try { const r = JSON.parse(l); if (r && r.type !== 'download' && r.id) latest.set(r.id, r); } catch { /* 깨진 줄 무시 */ } }
  return [...latest.values()];
}
export function recomputePairs({ rows = latestDriveRows(), features = readFeatures() } = {}) {
  const out = { generatedAt: new Date().toISOString(), ...computePairs(rows, features) };
  fs.mkdirSync(root(), { recursive: true });
  fs.writeFileSync(pairsFile(), JSON.stringify(out, null, 1));
  return out;
}
// 신규 업로드 직후 호출: PDF/엑셀일 때만 재계산(파일명 근거 + 캐시된 내용 근거). 실패해도 업로드는 성공.
export function onDriveFileIngested(filename) {
  if (!/\.(pdf|xlsx|xlsm|xls)$/i.test(String(filename || ''))) return null;
  try { return recomputePairs().summary; } catch (e) { console.error('[workDrivePairs] recompute failed:', e.message); return null; }
}
export function readPairs() { return readJson(pairsFile(), null); }
