// lib/workDrive.js
// 업무 드라이브 — 직원 PC 데몬(Orbit)이 자동 업로드한 업무 파일의 분류·저장·접근 규칙. 웹 전용 파일 저장(MSSQL 무관).
//
// 분류(실측 14일·62개 파일 근거): 업무 파일은 거의 전부 파일명에 "차수"를 달고 있고(38-2 / 3802 / 38차 / 38-02 / 38-2차 등
// 표기 5종), 부서·9단계 흐름에 정확히 매핑된다. 여기서 한 번만 정규화·분류하고 데몬은 "올릴지"만 정한다.
//   1축 차수(cycle)   2축 단계(stage)   3축 담당 부서(dept, 올린 사람 이름→부서표)   + 민감 태그(sensitive)
// 저장: data/drive/<cycle|_misc>/<sha8>_<filename>  색인: data/drive/index.jsonl (1줄 1파일, 추가만)
// 접근: 본인 전체 / 같은 부서 읽기 / 다른 부서는 인수인계 단계만 / 민감(금액) 파일은 경영지원+사장 / 사장 전체.
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { DEPARTMENTS } from './workManuals';
import { isOrbitReportViewer } from './orbitReportAccess';

export const STAGES = Object.freeze(['발주', '입고', '원가·운임', '출고', '견적·거래처', '송금·경영', '품질', '미분류']);
export const FILE_MAX = 25 * 1024 * 1024;
export const TOTAL_MAX = 5 * 1024 * 1024 * 1024;
const NAME_ALIAS = { 'ㅋㅋ': '조현욱', 'ᄏᄏ': '조현욱', 'jaeyong lim': '임재용', 'wbk': '김원빈' };
const USER_ID_ALIAS = { MN0B1204A46C4B8EAC: '정재훈' };

const root = () => path.join(process.cwd(), 'data', 'drive');
const indexFile = () => path.join(root(), 'index.jsonl');
const safeName = (s) => String(s || '').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 150) || 'file';

// ── 분류 ─────────────────────────────────────────────────────────────────────
// 차수 표기 통일: "38-2", "3802", "38차", "38-02주차", "38-2차", "40-1_Ecuador" → "38-2" / "40-1"
export function extractCycle(name) {
  const s = String(name || '');
  let m = s.match(/(?:^|[^\d])(\d{2})\s*[-_]\s*0?(\d)(?!\d)/);           // 38-2, 38_2, 38-02
  if (!m) m = s.match(/(?:^|[^\dA-Za-z])(\d{2})0?(\d)(?=차|_|\s|\.|$)/);   // 3802·3801 (세부차수 0 접두 허용). 영문 바로 뒤 숫자(무작위 ID 'G547')는 제외
  if (!m) { const c = s.match(/(?:^|[^\d])(\d{2})\s*차(?!수)/); if (c) return `${c[1]}`; } // 38차 → 회차만(세부차수 없음)
  if (!m) return '';
  const major = parseInt(m[1], 10), minor = parseInt(m[2], 10);
  if (major < 1 || major > 53 || minor < 1 || minor > 4) return '';
  return `${major}-${minor}`;
}

const STAGE_RULES = [
  ['송금·경영', /지출결의|결의서|송금|외화|수입비교|면장|세금계산|계산서|정산서|급여대장|예산|결산|매출이익|손익|보고서|위임장|월말재고|증빙|credito|credit|입금내역|사용내역|이익|결제|CNY|USD|EUR|\bsettle|매출액|매출표|매출파일|매출보고|목표 매출|사업자등록/i],
  ['품질', /불량|quality|claim|클레임|품질|하자|이슈|issue|defect|reclamo/i],
  ['원가·운임', /원가|운임|freight|arrival|도착원가|통관|관세|customs|물류비/i],
  ['견적·거래처', /견적|estimate|quotation|거래명세|명세서|invoice to|청구|판매현황|판매|가격표|단가표/i],
  ['입고', /입고|proforma|packing|awb|phyto|b\/l|bl\b|shipping|holex|선적|인보이스|invoice|\bci\b|\bco\b|콜카장|tiba|패킹리스트|패킹/i],
  ['출고', /출고|분배|shipment|배송|납품|차감내역|차감|\d+\s*박스|물량-\d+/i],
  ['발주', /발주|order|pedido|주문|물량표|취합|cloud|farm|농장|수국|장미|카네이션|알스트로|콜롬비아|에콰도르|ecua|colombia|rosas?\b|clavel|alstro|hortensia|hydrangea|컨펌|confirm/i], // 3802_콜롬비아수국 같은 농장 발주(품종·국가만 있는 이름)
];
// 농장·공급업체 사전(전산 Farm 마스터 144곳, 2026-09-21 추출) — 파일명에 농장명만 있는 인보이스·PL PDF(예: 'AYURA 17-1 HERMES.pdf')를 입고로 잡는다.
const FARM_NAMES = ['agri', 'agroinsumos saga s.a.s', 'agua clara', 'american flowers medellin s.a.s', 'antioquia', 'antioquia floral s.a.s', 'apollo', 'ayura', 'balverde', 'benchmark', 'benchmark growers', 'benchmark growers sas', 'c.i flores balverde s.a.s', 'c.i surandina de flores s.a.s', 'c.i. flores colon ltda.', 'c.i. sunshine bouquet sas', 'chaquiro', 'chaquiro colombian flowers sas', 'circasia', 'cloudland', 'colibri', 'conejera', 'construnorte', 'cultivos del norte sas', 'daflor', 'don eusebio', 'ecoflor', 'ecoflor ct s.a.s.', 'el cactus', 'el milagro', 'el moral', 'el redil', 'el zorro', 'elite', 'esperance', 'esperance roses', 'excel', 'ez flower', 'ez flowers', 'fillco', 'fiori colombia s.a.s.', 'floramar', 'florca', 'florentina', 'florentina export s.a.s', 'flores aurora sas', 'flores de aposentos', 'flores de funza', 'flores de la hacienda sas', 'flores el zorro', 'flores gambur sas', 'flores la linda s.a.s', 'flores san juan s.a.s', 'flores san juan s.a.s.', 'flores tiba', 'freightwise', 'freightwise ecuador', 'freshgarden', 'funza', 'gambur', 'geoflora', 'green land flowers s.a.s', 'greenland', 'grupo andes', 'grupo valores', 'grupo valores en accion', 'holex', 'hood canal', 'inverpalmas sas', 'invos', 'invos flowers', 'julieta flowers s.a.s', 'julieta flowers sas', 'kikuyal', 'krung', 'la gaitana', 'la rosaleda', 'lee and u', 'lorzate flowers s.a.s', 'magenta farms s.a.s', 'masterly', 'matina', 'maxiflores', 'milagro', 'minaye', 'monika', 'monika farms', 'multiflora', 'natuflora', 'pietrasanta', 'pietrasanta flores y follajes s.a.s', 'plazoleta', 'ponderosa', 'premium greens', 'presh tech s a s', 'prestige', 'prestige roses', 'princess', 'princess farms s.a.s', 'prisma', 'rainbow', 'redil', 'riscanevo', 'rosas aguaclara s.a.s', 'roshanara', 'royal base', 'san juan', 'santana', 'serrezuela', 'sky roses', 'sunshine flowers s.a.s', 'sunshine flowers s.a.s.', 'super fresh', 'superior blooms', 'surandina', 'tana', 'teucali', 'the elite flowers', 'the green genie', 'turflor', 'unique', 'unique flowers', 'utopia farms', 'varietta', 'verdnatura s.a.s', 'verdnatura sas', 'vuelven', 'vuelven s.a.s.', 'yunnan melody', '에콰도르 awb', '콜수국 awb', '콜카장 awb', '태국 awb'];
const hasFarm = (s) => { const l = String(s || '').toLowerCase(); return FARM_NAMES.some((f) => l.includes(f)); };
export function classifyStage(name) {
  const s = String(name || '');
  for (const [stage, re] of STAGE_RULES) if (re.test(s)) return stage;
  if (hasFarm(s)) return '입고';
  return '미분류';
}
// 민감: 금액·계약·개인정보 — 경영지원+사장만. 목록엔 뜨되 내려받기는 제한.
export function isSensitive(name, stage) {
  return stage === '송금·경영' || (stage === '입고' && /\.pdf$/i.test(String(name || '')) && hasFarm(name)) || /계약|contrato|contract|인보이스|invoice|proforma|단가|원가|급여|연봉|주민|여권|passport|통장|계좌/i.test(String(name || ''));
}
export function deptOfName(userName) {
  const n = NAME_ALIAS[String(userName || '').trim()] || String(userName || '').trim();
  const d = DEPARTMENTS.find((x) => x.members.includes(n));
  return { name: n, dept: d ? d.name : '', deptId: d ? d.id : '' };
}
// PC 이름으로 실제 사용자 지정 — 데몬이 다른 사람 토큰으로 설치된 PC(2026-09-21 실측: NENOVA2025는 설연주 토큰이나 파일 전부 정재훈 영업부 자료)
const HOST_ALIAS = { NENOVA2025: '정재훈' };
export function resolveUploader({ orbitUserId, userName, hostname }) {
  const nm = HOST_ALIAS[String(hostname || '').toUpperCase()] || USER_ID_ALIAS[String(orbitUserId || '')] || userName;
  return deptOfName(nm);
}
export function classify({ filename, orbitUserId, userName, hostname }) {
  const cycle = extractCycle(filename);
  const stage = classifyStage(filename);
  const who = resolveUploader({ orbitUserId, userName, hostname });
  const ext = (String(filename || '').split('.').pop() || '').toLowerCase();
  return { cycle, stage, dept: who.dept, deptId: who.deptId, uploaderName: who.name, sensitive: isSensitive(filename, stage), ext,
    confidence: (cycle ? 0.5 : 0) + (stage !== '미분류' ? 0.4 : 0) + (who.dept ? 0.1 : 0) };
}

// ── 저장 ─────────────────────────────────────────────────────────────────────
function readIndex() {
  try { return fs.readFileSync(indexFile(), 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return []; }
}
function appendIndex(row) { fs.mkdirSync(root(), { recursive: true }); fs.appendFileSync(indexFile(), JSON.stringify(row) + '\n'); }

// buffer + 메타를 받아 저장. 같은 sha 는 중복 저장 안 함(기존 항목에 seen 기록만). 같은 파일명·같은 사람의 새 sha = 새 버전.
export function ingestFile({ buffer, filename, orbitUserId, userName, hostname, dir, mtime, eventType }) {
  if (!buffer || !buffer.length) return { ok: false, status: 400, error: '빈 파일' };
  if (buffer.length > FILE_MAX) return { ok: false, status: 413, error: '25MB 초과' };
  const fn = safeName(filename);
  const sha = crypto.createHash('sha256').update(buffer).digest('hex');
  const c = classify({ filename: fn, orbitUserId, userName, hostname });
  const idx = fileRows();
  const dup = idx.find((r) => r.sha === sha);
  if (dup) return { ok: true, duplicate: true, id: dup.id, classification: c };
  const total = idx.reduce((a, r) => a + (r.size || 0), 0);
  if (total + buffer.length > TOTAL_MAX) return { ok: false, status: 507, error: '드라이브 용량 상한(5GB)' };
  const folder = c.cycle || '_misc';
  const rel = path.join(folder, `${sha.slice(0, 8)}_${fn}`);
  fs.mkdirSync(path.join(root(), folder), { recursive: true });
  fs.writeFileSync(path.join(root(), rel), buffer);
  const prev = idx.filter((r) => r.filename === fn && r.uploaderName === c.uploaderName && !r.deleted);
  const row = { id: `${Date.now().toString(36)}-${sha.slice(0, 6)}`, filename: fn, rel, sha, size: buffer.length, ext: c.ext,
    cycle: c.cycle, stage: c.stage, dept: c.dept, deptId: c.deptId, uploaderName: c.uploaderName, orbitUserId: String(orbitUserId || ''), hostname: String(hostname || ''),
    sourceDir: String(dir || ''), mtime: mtime || null, eventType: String(eventType || ''), sensitive: c.sensitive, confidence: c.confidence,
    version: prev.length + 1, uploadedAt: new Date().toISOString(), deleted: false };
  appendIndex(row);
  return { ok: true, duplicate: false, id: row.id, classification: c, version: row.version };
}

export function reclassify(user, id, patch) { // 사장 또는 올린 본인이 차수·단계 수동 교정 — 색인에 교정 행 추가(원본 보존)
  const latest = new Map(); for (const x of fileRows()) latest.set(x.id, x); const r = latest.get(id); if (!r) return { ok: false, status: 404, error: '없음' };
  if (!(canAdmin(user) || sameUser(user, r))) return { ok: false, status: 403, error: '권한 없음' };
  const out = { ...r, ...(patch.cycle !== undefined ? { cycle: String(patch.cycle || '') } : {}), ...(patch.stage && STAGES.includes(patch.stage) ? { stage: patch.stage } : {}), ...(patch.deleted !== undefined ? { deleted: !!patch.deleted } : {}), correctedAt: new Date().toISOString(), correctedBy: String(user.userId || '') };
  appendIndex(out); return { ok: true, item: out };
}

// 분류 규칙을 고친 뒤 기존 파일에 재적용(사장만). 차수 없음·미분류·민감 판정이 달라진 행만 교정 행을 추가한다(원본 보존).
export function reclassifyAll(user) {
  if (!canAdmin(user)) return { ok: false, status: 403, error: '권한 없음' };
  const latest = new Map(); for (const x of fileRows()) latest.set(x.id, x);
  let changed = 0, scanned = 0;
  for (const r of latest.values()) {
    if (r.deleted || (r.correctedBy && r.correctedBy !== 'auto-reclassify')) continue; // 사람이 손으로 고친 건 건드리지 않는다(자동 재분류 행은 다시 적용)
    scanned++;
    const c = classify({ filename: r.filename, orbitUserId: r.orbitUserId, userName: r.uploaderName, hostname: r.hostname });
    if (c.cycle === (r.cycle || '') && c.stage === r.stage && !!c.sensitive === !!r.sensitive && c.uploaderName === r.uploaderName) continue;
    appendIndex({ ...r, cycle: c.cycle, stage: c.stage, sensitive: c.sensitive, confidence: c.confidence, uploaderName: c.uploaderName, dept: c.dept, deptId: c.deptId, correctedAt: new Date().toISOString(), correctedBy: 'auto-reclassify' });
    changed++;
  }
  return { ok: true, scanned, changed };
}

// ── 접근 ─────────────────────────────────────────────────────────────────────
// 업무 드라이브 관리자(전 부서 열람·재분류·다운로드 기록): 사장 계정 + 명시 추가 계정. 직원 관측 리포트(orbit-report) 권한과는 분리.
export const WORK_DRIVE_ADMIN_USER_IDS = Object.freeze(['nenova1']); // 김원영 (2026-09-22 사장 지시)
const canAdmin = (user) => isOrbitReportViewer(user) || WORK_DRIVE_ADMIN_USER_IDS.includes(String(user?.userId ?? user?.UserID ?? '').trim());
const sameUser = (user, r) => !!user && String(user.userName || '').trim() === r.uploaderName;
const deptOfUser = (user) => deptOfName(user?.userName).dept;
// 다른 부서가 볼 수 있는 인수인계 단계: 영업지원↔수입부(입고·발주), 영업부(출고·견적), 경영지원(원가·송금 근거 전부)
const HANDOFF = { '영업지원': ['발주', '입고', '출고', '견적·거래처', '원가·운임', '품질'], '수입부': ['발주', '입고', '원가·운임', '품질'], '영업부': ['발주', '출고', '견적·거래처', '품질'], '경영지원': ['원가·운임', '송금·경영', '견적·거래처', '입고', '발주', '출고', '품질'] };
export function canView(user, r) {
  if (!user) return false;
  if (canAdmin(user)) return true;
  const my = deptOfUser(user);
  if (r.sensitive) return sameUser(user, r) || my === '경영지원';
  if (sameUser(user, r) || (my && my === r.dept)) return true;
  return !!(my && (HANDOFF[my] || []).includes(r.stage));
}
export function canDownload(user, r) { return canView(user, r) && (!r.sensitive || canAdmin(user) || sameUser(user, r) || deptOfUser(user) === '경영지원'); }

// 최신 상태(교정 행이 있으면 마지막 행이 이김) → 접근 필터 → 목록. 다운로드 기록 행(type:'download')은 파일이 아니므로 제외.
const fileRows = () => readIndex().filter((r) => r.type !== 'download');
export function listVisible(user) {
  const latest = new Map(); for (const r of fileRows()) latest.set(r.id, r);
  return [...latest.values()].filter((r) => !r.deleted && canView(user, r)).sort((a, b) => (b.uploadedAt > a.uploadedAt ? 1 : -1))
    .map((r) => ({ ...r, canDownload: canDownload(user, r) }));
}
export function getFile(user, id) {
  const latest = new Map(); for (const r of fileRows()) latest.set(r.id, r);
  const r = latest.get(id); if (!r || r.deleted || !canDownload(user, r)) return null;
  const abs = path.join(root(), r.rel); if (!abs.startsWith(root()) || !fs.existsSync(abs)) return null;
  appendIndex({ id: `dl-${Date.now().toString(36)}`, type: 'download', fileId: id, by: String(user.userId || ''), byName: String(user.userName || ''), at: new Date().toISOString() });
  return { row: r, abs };
}
export function downloadLog(user, id) { return canAdmin(user) ? readIndex().filter((r) => r.type === 'download' && r.fileId === id) : []; }
