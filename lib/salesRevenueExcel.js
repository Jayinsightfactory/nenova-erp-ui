// lib/salesRevenueExcel.js
// ECOUNT 판매현황 엑셀(다운로드본) 파서.
//
// ECOUNT 판매현황 화면에서 내려받은 엑셀 구조:
//   0행: 회사명 + 조회기간   예) "회사명 : (주) 네노바 / 2025/06/15  ~ 2025/06/21"
//   1행: 헤더               일자-No. | 거래처명 | 품목명 | 수량 | 단가(vat포함) | 공급가액 | 부가세 | 합계 | 적요
//   2행~: 데이터
//   마지막 행: 출력 타임스탬프 푸터 (거래처명 비어 있음 → 스킵)
//
// 헤더 텍스트 기준으로 컬럼을 매핑하므로 컬럼 순서가 바뀌어도 동작한다.
// 이 파서는 ECOUNT 원본을 읽기만 한다(쓰기/전송 없음).

const NORM = s => String(s ?? '').replace(/\s+/g, '').replace(/[()（）]/g, '').toLowerCase();

const HEADER_RULES = [
  { field: 'ecountDateNo', keys: ['일자-no', '일자no', '일자'] },
  { field: 'ecountCustName', keys: ['거래처명', '거래처'] },
  { field: 'productName', keys: ['품목명', '품목'] },
  { field: 'quantity', keys: ['수량'] },
  { field: 'unitPriceVatIncluded', keys: ['단가vat포함', '단가vat', '단가'] },
  { field: 'supplyAmount', keys: ['공급가액', '공급가'] },
  { field: 'vat', keys: ['부가세', 'vat'] },
  { field: 'totalAmount', keys: ['합계'] },
  { field: 'remark', keys: ['적요', '비고'] },
];

function num(v) {
  if (v === undefined || v === null || v === '') return 0;
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const n = Number(String(v).replace(/[^\d.\-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function matchField(headerText) {
  const t = NORM(headerText);
  if (!t) return null;
  for (const rule of HEADER_RULES) {
    if (rule.keys.some(k => t === k || t.includes(k))) return rule.field;
  }
  return null;
}

// 조회기간 "2025/06/15 ~ 2025/06/21" → { dateFrom:'2025-06-15', dateTo:'2025-06-21' }
function parsePeriod(headerLine) {
  const m = String(headerLine || '').match(/(\d{4})[\/.\-](\d{1,2})[\/.\-](\d{1,2})\s*~\s*(\d{4})[\/.\-](\d{1,2})[\/.\-](\d{1,2})/);
  if (!m) return { dateFrom: '', dateTo: '' };
  const pad = (y, mo, d) => `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  return { dateFrom: pad(m[1], m[2], m[3]), dateTo: pad(m[4], m[5], m[6]) };
}

const SKIP_CUST = new Set(['합계', '총계', '소계', '계']);

// 'YYYY-MM-DD' → { year, week } (대차수). getCurrentWeek 과 동일 공식: ceil(연중일수/7), 최대 52.
// 기간 "시작일(dateFrom)" 기준이 차수 시작일과 일치한다(예: 2025-06-01 → 22차).
// Date.UTC 로 계산해 시간대 오차(자정 밀림)를 방지한다.
export function weekNumFromDate(dateStr) {
  const m = String(dateStr || '').match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  const dayOfYear = Math.floor((Date.UTC(y, mo - 1, d) - Date.UTC(y, 0, 1)) / 86400000) + 1;
  const week = Math.min(Math.ceil(dayOfYear / 7), 52);
  return { year: String(y), week: String(week) };
}

// aoa: XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false }) 결과 (배열의 배열)
// @returns { rows, dateFrom, dateTo, companyLine, headerRow, skipped }
export function parseEcountSalesAoa(aoa) {
  if (!Array.isArray(aoa) || aoa.length === 0) {
    return { rows: [], dateFrom: '', dateTo: '', companyLine: '', headerRow: -1, skipped: 0 };
  }

  // 헤더 행 찾기: '거래처명'과 '합계'를 모두 포함하는 행
  let headerRow = -1;
  for (let i = 0; i < Math.min(aoa.length, 15); i++) {
    const cells = (aoa[i] || []).map(NORM);
    if (cells.some(c => c.includes('거래처')) && cells.some(c => c === '합계' || c.includes('합계'))) {
      headerRow = i;
      break;
    }
  }
  if (headerRow === -1) {
    throw new Error('판매현황 엑셀에서 헤더(거래처명/합계)를 찾지 못했습니다. ECOUNT 판매현황 다운로드 엑셀이 맞는지 확인하세요.');
  }

  const companyLine = headerRow > 0 ? String((aoa[0] || [])[0] || '') : '';
  const { dateFrom, dateTo } = parsePeriod(companyLine);

  // 컬럼 매핑
  const colMap = {};
  (aoa[headerRow] || []).forEach((cell, idx) => {
    const field = matchField(cell);
    if (field && colMap[field] === undefined) colMap[field] = idx;
  });
  if (colMap.ecountCustName === undefined || colMap.totalAmount === undefined) {
    throw new Error('판매현황 엑셀 컬럼(거래처명/합계)을 매핑하지 못했습니다.');
  }

  const get = (row, field) => (colMap[field] === undefined ? undefined : row[colMap[field]]);

  const rows = [];
  let skipped = 0;
  for (let i = headerRow + 1; i < aoa.length; i++) {
    const row = aoa[i] || [];
    const custRaw = get(row, 'ecountCustName');
    const cust = String(custRaw ?? '').trim();
    const dateCell = String(get(row, 'ecountDateNo') ?? '');
    // 푸터/합계행 스킵: 거래처명이 비었거나, 일자 셀에 출력 타임스탬프(오전/오후), 합계/총계 라벨
    if (!cust || SKIP_CUST.has(cust) || /오전|오후/.test(dateCell)) {
      skipped++;
      continue;
    }
    const total = num(get(row, 'totalAmount'));
    const supply = num(get(row, 'supplyAmount'));
    const vat = num(get(row, 'vat'));
    const qty = num(get(row, 'quantity'));
    // 의미 없는 행(거래처는 있으나 금액/수량 전무) 스킵
    if (!total && !supply && !vat && !qty) {
      skipped++;
      continue;
    }
    rows.push({
      ecountDateNo: dateCell.trim(),
      ecountCustName: cust,
      productName: String(get(row, 'productName') ?? '').trim(),
      quantity: qty,
      unitPriceVatIncluded: num(get(row, 'unitPriceVatIncluded')),
      supplyAmount: supply,
      vat,
      totalAmount: total,
      remark: String(get(row, 'remark') ?? '').trim(),
    });
  }

  return { rows, dateFrom, dateTo, companyLine, headerRow, skipped };
}

export default { parseEcountSalesAoa };
