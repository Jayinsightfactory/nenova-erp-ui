// 이카운트 엑셀 버퍼 → { headers, rows, screenTotal }. scripts/ecount-scraper/scrape-core.mjs 의 파싱 아이디어를 복제(import 금지).
// 원본 그대로 보존이 목적이라 열 매핑·숫자 변환을 하지 않는다(문자열 그대로).
import XLSX from 'xlsx';
import crypto from 'node:crypto';

const NUM_RE = /^[-+(]?[\d,]+(\.\d+)?\)?%?$/;
const AMOUNT_HEADERS = ['합계', '잔액', '금액', '공급가액'];

const cell = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
const isNumeric = (s) => NUM_RE.test(s);

function stats(row) {
  const cells = row.map(cell);
  const filled = cells.filter(Boolean);
  const text = filled.filter((s) => !isNumeric(s));
  return { cells, filled: filled.length, textRatio: filled.length ? text.length / filled.length : 0, numeric: filled.length - text.length };
}

// 헤더 행 탐지: 앞 30행 중 채워진 칸 2개 이상 + 문자열 비율 0.8 이상인 첫 행
export function findHeaderRowIndex(aoa) {
  for (let i = 0; i < Math.min(aoa.length, 30); i += 1) {
    const s = stats(aoa[i] || []);
    if (s.filled >= 2 && s.textRatio >= 0.8) return i;
  }
  return -1;
}

// 병합 2단 헤더: 위 행에 빈 칸이 있고(병합 흔적), 아래 행이 숫자 없는 문자열 행이면 "상위_하위"
function combineTwoLevel(top, bottom) {
  const t = top.map(cell);
  const b = bottom.map(cell);
  const width = Math.max(t.length, b.length);
  const out = [];
  let parent = '';
  for (let j = 0; j < width; j += 1) {
    if (t[j]) parent = t[j];
    else if (!b[j]) parent = '';
    const lower = b[j] || '';
    if (lower && (t[j] || parent) && lower !== (t[j] || parent)) out.push(`${t[j] || parent}_${lower}`);
    else out.push(t[j] || lower || parent);
  }
  return out;
}

export function parseEcountAoa(aoa) {
  const hr = findHeaderRowIndex(aoa);
  if (hr < 0) return { headers: [], rows: [], screenTotal: null };
  let headers = (aoa[hr] || []).map(cell);
  let start = hr + 1;
  const next = aoa[hr + 1];
  if (next) {
    const top = stats(aoa[hr]);
    const nx = stats(next);
    const hasGap = top.cells.some((c, j) => !c && j > 0 && top.cells.slice(0, j).some(Boolean) && nx.cells[j]);
    if (nx.filled >= 2 && nx.numeric === 0 && nx.textRatio === 1 && hasGap) {
      headers = combineTwoLevel(aoa[hr], next);
      start = hr + 2;
    }
  }
  // 오른쪽 끝의 완전히 빈 헤더 칸은 제거(데이터도 비어있을 때만)
  let width = headers.length;
  const data = [];
  for (let i = start; i < aoa.length; i += 1) {
    const r = (aoa[i] || []).map(cell);
    if (!r.some(Boolean)) continue;
    data.push(r);
    width = Math.max(width, 0);
  }
  while (width > 0 && !headers[width - 1] && data.every((r) => !r[width - 1])) width -= 1;
  headers = headers.slice(0, width);
  const rows = data.map((r) => headers.map((_, j) => r[j] ?? ''));

  // 화면 합계: 합계|총계 행에서 금액 열 값
  let screenTotal = null;
  const amtIdx = AMOUNT_HEADERS.map((h) => headers.findIndex((x) => x.replace(/\s+/g, '') === h)).find((j) => j >= 0);
  for (const r of rows) {
    if (/합계|총계/.test(r.join('')) && amtIdx !== undefined) {
      const n = Number(String(r[amtIdx]).replace(/[,\s₩원]/g, ''));
      if (Number.isFinite(n) && String(r[amtIdx]).trim() !== '') screenTotal = n;
    }
  }
  return { headers, rows, screenTotal };
}

export function parseEcountXlsx(buf) {
  const wb = XLSX.read(buf, { type: 'buffer' });
  const aoa = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false, defval: '' });
  return { ...parseEcountAoa(aoa), sha256: crypto.createHash('sha256').update(buf).digest('hex') };
}
