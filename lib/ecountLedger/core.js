// ecount 스키마 적재 순수 함수(DB 의존 없음). 식별자 정화·헤더 정규화·RowHash·합계행 판정.
import crypto from 'node:crypto';

export const ECOUNT_SCHEMA = 'ecount';
export const FIXED_COLUMNS = ['RowKey', 'BatchKey', 'RowNo', 'RowHash', 'IsSubtotal'];
export const MAX_VALUE_LEN = 400;
export const MAX_IDENT_LEN = 100;

const PRGID_RE = /^[A-Za-z0-9]{3,20}$/;
// 열 이름 화이트리스트: 문자·숫자·공백·_ - . ( ) % / · 만. 그 외(특히 [ ] ' ; 제어문자)는 '_' 로 치환.
const IDENT_BAD_RE = /[^\p{L}\p{N} _\-.()%/·]/gu;

export function assertPrgId(prgId) {
  const s = String(prgId || '');
  if (!PRGID_RE.test(s)) throw new Error(`잘못된 PrgId: ${s}`);
  return s;
}

export function rawTableName(prgId) {
  return `Raw_${assertPrgId(prgId)}`;
}

// [ecount].[Raw_E040207] — 화이트리스트를 통과한 PrgId 만 허용
export function qualifiedRaw(prgId) {
  return `[${ECOUNT_SCHEMA}].[${rawTableName(prgId)}]`;
}

// 대괄호 이스케이프(']' → ']]'). sanitizeColumnName 을 거친 이름에는 ']' 가 없지만 이중 방어.
export function quoteIdent(name) {
  const s = String(name);
  if (!s || s.length > 128 || /[\u0000-\u001f]/.test(s)) throw new Error(`잘못된 식별자: ${JSON.stringify(s)}`);
  return `[${s.replace(/]/g, ']]')}]`;
}

export function sanitizeColumnName(raw) {
  return String(raw ?? '')
    .normalize('NFC')
    .replace(/\s+/g, ' ')
    .replace(IDENT_BAD_RE, '_')
    .trim()
    .slice(0, MAX_IDENT_LEN)
    .trim();
}

// 원본 헤더 배열 → 열 이름 배열(같은 길이). 빈 헤더는 열N, 중복·고정열 충돌은 접미사.
export function normalizeHeaders(headers) {
  const used = new Set(FIXED_COLUMNS.map((c) => c.toLowerCase()));
  return (headers || []).map((h, i) => {
    let name = sanitizeColumnName(h);
    if (!name) name = `열${i + 1}`;
    let cand = name;
    let n = 2;
    while (used.has(cand.toLowerCase())) { cand = `${name}_${n}`; n += 1; }
    used.add(cand.toLowerCase());
    return cand;
  });
}

export function normalizeValue(v) {
  if (v === null || v === undefined) return '';
  return String(v).replace(/\s+/g, ' ').trim();
}

// PrgId + 값이 있는 열만 (열 이름 정렬순) 해시 → 열 순서·나중에 추가된 빈 열에 영향받지 않음. BatchKey 무관.
export function computeRowHash(prgId, names, values) {
  const pairs = [];
  names.forEach((n, i) => {
    const v = normalizeValue(values[i]);
    if (v !== '') pairs.push(`${n.toLowerCase()}=${v}`);
  });
  pairs.sort();
  return crypto.createHash('sha256').update(`${prgId}\u0001${pairs.join('\u0002')}`, 'utf8').digest('hex');
}

const SUBTOTAL_RE = /합계|총계|소계/;
const SUBTOTAL_CELL_RE = /(^|[\s/])계$/;
export function isSubtotalValues(values) {
  const vals = (values || []).map(normalizeValue).filter(Boolean);
  if (!vals.length) return false;
  if (vals.some((v) => SUBTOTAL_RE.test(v) && v.length <= 30)) return true;
  return SUBTOTAL_CELL_RE.test(vals[0]);
}

export function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// rows: 값 배열 또는 {헤더: 값} 객체 → 값 배열(headers 순서)
export function rowToValues(row, headers) {
  if (Array.isArray(row)) return headers.map((_, i) => row[i]);
  return headers.map((h) => (row ? row[h] : undefined));
}
