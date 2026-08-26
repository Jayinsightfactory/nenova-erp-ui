// lib/profitReportExcelAudit.js — 확정 "매출원가 양식" 엑셀 ↔ 웹 매출이익 보고서 셀 단위 대조.
//
// 2026-08-26 사장님 지시: "매 차수 데이터에서 기존 엑셀과 오류값이 있는지 확인하는 API+LLM".
// 26~31차 수기 대조 세션에서 확정한 차이 원인 분류(차수귀속/재고 근사/전산우선 매입/통관비
// 미입력/포워딩 배분/환율 근사/매출 분류 위치)를 규칙으로 내장하고, LLM(claude-haiku-4-5)은
// 규칙 분류 결과를 사람이 읽는 소견으로 요약한다. ANTHROPIC_API_KEY 가 없거나 호출이 실패하면
// 규칙 기반 요약만 반환한다(기능은 항상 동작).
import * as XLSX from 'xlsx';

export const AUDIT_SHEET_NAME = '주차별 매출이익 보고서';
export const AUDIT_COLUMNS = ['C', 'E', 'F', 'G', 'H', 'I', 'J', 'L', 'N', 'O', 'Q', 'R', 'S'];
export const AUDIT_COLUMN_LABELS = {
  C: '매출액', E: '기초상품재고액', F: '기말상품재고액', G: '매입액(상품+포워딩)',
  H: '그외통관비', I: '매출원가', J: '매출이익', L: '불량금액',
  N: '순수매출액', O: '그 외 매출액', Q: '구매금액(외화)', R: '환율', S: '포워딩(USD)',
};
// 원본 양식의 열 배치 — 품명(B) 기준 상대 열은 고정이다(템플릿 재현 규칙).
const SHEET_COLUMN_OF_KEY = {
  C: 'C', D: 'D', E: 'E', F: 'F', G: 'G', H: 'H', I: 'I', J: 'J', K: 'K',
  L: 'L', M: 'M', N: 'N', O: 'O', P: 'P', Q: 'Q', R: 'R', S: 'S', T: 'T', U: 'U',
};

const num = (v) => {
  if (v == null || v === '') return null;
  const n = Number(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
};

/** 업로드된 workbook에서 본표를 추출한다.
 * 반환: { sheetName, rows: { 품명: {C..U} }, total: {C..U}|null } — 품명 행이 없으면 rows 빈 객체. */
export function parseProfitWorkbookSheet(workbook) {
  const sheetName = workbook.SheetNames.includes(AUDIT_SHEET_NAME)
    ? AUDIT_SHEET_NAME
    : workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  if (!sheet || !sheet['!ref']) return { sheetName, rows: {}, total: null };
  const range = XLSX.utils.decode_range(sheet['!ref']);
  const cell = (col, row1) => sheet[`${col}${row1}`]?.v;
  // 헤더 행: B열이 '품명'
  let headerRow = null;
  for (let r = range.s.r + 1; r <= Math.min(range.e.r + 1, 30); r += 1) {
    if (String(cell('B', r) || '').trim() === '품명') { headerRow = r; break; }
  }
  if (!headerRow) return { sheetName, rows: {}, total: null };
  const rows = {};
  let total = null;
  for (let r = headerRow + 1; r <= range.e.r + 1; r += 1) {
    const label = String(cell('B', r) || '').trim();
    const values = {};
    for (const key of Object.keys(SHEET_COLUMN_OF_KEY)) {
      values[key] = num(cell(SHEET_COLUMN_OF_KEY[key], r));
    }
    if (!label) {
      // 품명 없는 행에 매출액이 있으면 합계행(원본 23행), 그 뒤는 비고 영역 — 종료.
      if (values.C != null && total == null) { total = values; continue; }
      if (total != null) break;
      continue;
    }
    if (label === '비고사항' || label.includes(':')) break; // 비고 텍스트 행
    rows[label] = values;
  }
  return { sheetName, rows, total };
}

const isClose = (col, a, b) => {
  const d = Math.abs(a - b);
  if (col === 'R') return d <= 0.5;
  if (col === 'Q' || col === 'S') return d <= 1 || (Math.abs(a) > 0 && d / Math.abs(a) <= 0.001);
  return d <= 1000 || (Math.abs(a) > 0 && d / Math.abs(a) <= 0.0005);
};

/** 차이 1건의 원인 분류 — 26~31차 수기 대조(2026-08-25~26)에서 확정된 분류 체계.
 * severity: 'expected'(정상으로 확정된 구조적 차이) | 'review'(사람 확인 필요) */
export function classifyDiffCause({ col, category, webRow, dExcelMinusWeb, pair }) {
  const srcF = webRow?.stockSourceKind?.end || webRow?.source?.F || '';
  const srcE = webRow?.stockSourceKind?.begin || webRow?.source?.E || '';
  const srcH = webRow?.source?.H || '';
  const srcR = webRow?.source?.R || '';
  const isColombiaAlloc = ['콜롬비아 카네이션', '콜롬비아 장미', '콜롬비아 루스커스', '콜롬비아 알스트로'].includes(category);
  if ((col === 'N' || col === 'O') && pair?.offsetting) {
    return { cause: 'sales_reclass_display', severity: 'expected', label: '매출 분류 위치 차이(순수매출↔그외매출 상쇄, 합계 무영향)' };
  }
  if (col === 'C') {
    return { cause: 'revenue_attribution', severity: 'review', label: '매출 차수귀속 차이 — 확정이면 보고서의 매출조정(AC) 칸에 입력' };
  }
  if (col === 'J') {
    return { cause: 'derived_profit', severity: 'review', label: '이익 차이(구성 항목 차이의 합) — 이익만 다르면 이익조정(AJ) 후보' };
  }
  if (col === 'I') {
    return { cause: 'derived_cost', severity: 'expected', label: '매출원가(파생값) — 구성 항목(E/G/H/F) 차이의 결과' };
  }
  if (col === 'E' || col === 'F') {
    const src = col === 'E' ? srcE : srcF;
    if (src === 'missing_price_evidence' || src === 'missing_stock_snapshot') {
      return { cause: 'stock_missing_evidence', severity: 'review', label: '재고 단가 근거 부족 — 재고 매입단가 입력 필요' };
    }
    if (['category_average_fallback', 'carried_category_unit_cost'].includes(src)) {
      return { cause: 'stock_valuation_approx', severity: 'expected', label: '재고 근사치(원본공식 확대/단가 이월) vs 엑셀 실사 차이' };
    }
    return { cause: 'stock_valuation_diff', severity: 'review', label: '재고 평가 차이(웹 검증근거 vs 엑셀) — 실사값 확인' };
  }
  if (col === 'G' || col === 'Q') {
    if (dExcelMinusWeb < 0) {
      return { cause: 'erp_only_purchase', severity: 'expected', label: '전산에만 있는 매입(엑셀 미기재) — 전산 우선 방침' };
    }
    return { cause: 'purchase_mismatch', severity: 'review', label: '매입 차이(엑셀에만 있거나 금액 상이) — 입고 등록 확인' };
  }
  if (col === 'H') {
    if (['gw_auto', 'partial', 'missing'].includes(srcH)) {
      return { cause: 'customs_not_entered', severity: 'review', label: '그외통관비 실측(관세·선율) 미입력 — 그외통관비 입력 화면에서 저장' };
    }
    if (isColombiaAlloc) {
      return { cause: 'customs_allocation', severity: 'expected', label: '콜롬비아 무게배분 근사 차이(박스수 ±1 수준)' };
    }
    return { cause: 'customs_mismatch', severity: 'review', label: '그외통관비 저장값과 엑셀 확정값 상이 — 입력 화면 재확인' };
  }
  if (col === 'S') {
    if (isColombiaAlloc) {
      return { cause: 'forwarding_allocation', severity: 'expected', label: '콜롬비아 항공료 배분 근사 차이' };
    }
    return { cause: 'forwarding_source', severity: 'expected', label: '포워딩 원천 차이(전산 운송료 라인 vs 포워더 청구서) — 전산 우선 방침' };
  }
  if (col === 'R') {
    if (srcR === 'approximate_currency_master') {
      return { cause: 'rate_approx', severity: 'review', label: '환율 근사치 적용 중 — 통관 신고 환율 확인 후 수정' };
    }
    return { cause: 'rate_source_diff', severity: 'expected', label: '환율 원천 차이(관세청 인보이스별 vs 엑셀 주간 단일)' };
  }
  if (col === 'L') {
    return { cause: 'defect_mismatch', severity: 'review', label: '불량금액 차이 — 불량차감 등록 확인' };
  }
  return { cause: 'unclassified', severity: 'review', label: '분류되지 않은 차이 — 직접 확인 필요' };
}

/** 웹 계산행(rows[*].calc 포함)·합계와 파싱된 엑셀을 대조한다. */
export function diffProfitReportAgainstWorkbook({ webRows, webTotals, workbookRows, workbookTotal }) {
  const diffs = [];
  const webByCategory = Object.fromEntries((webRows || []).map((row) => [row.category, row]));
  for (const [category, excelValues] of Object.entries(workbookRows || {})) {
    const webRow = webByCategory[category];
    if (!webRow) {
      diffs.push({
        category, col: '*', label: '행 없음', excel: null, web: null, diff: null,
        cause: 'category_missing', severity: 'review', causeLabel: '웹 보고서에 없는 품명 행',
      });
      continue;
    }
    const dN = num(excelValues.N) != null ? Number(excelValues.N) - Number(webRow.calc.N || 0) : 0;
    const dO = num(excelValues.O) != null ? Number(excelValues.O) - Number(webRow.calc.O || 0) : 0;
    const offsetting = Math.abs(dN + dO) <= 1000 && Math.abs(dN) > 1000;
    for (const col of AUDIT_COLUMNS) {
      const excelValue = num(excelValues[col]);
      const webValue = webRow.calc[col];
      const a = excelValue == null ? 0 : excelValue;
      const b = webValue == null ? 0 : Number(webValue);
      if (isClose(col, a, b)) continue;
      const classified = classifyDiffCause({
        col, category, webRow, dExcelMinusWeb: a - b, pair: { offsetting },
      });
      diffs.push({
        category, col, label: AUDIT_COLUMN_LABELS[col],
        excel: a, web: b, diff: b - a,
        cause: classified.cause, severity: classified.severity, causeLabel: classified.label,
      });
    }
  }
  const totalDiffs = [];
  if (workbookTotal && webTotals) {
    for (const col of AUDIT_COLUMNS) {
      if (col === 'R') continue;
      const a = num(workbookTotal[col]) ?? 0;
      const b = Number(webTotals[col] ?? 0);
      if (!isClose(col, a, b)) totalDiffs.push({ col, label: AUDIT_COLUMN_LABELS[col], excel: a, web: b, diff: b - a });
    }
  }
  const counts = {
    review: diffs.filter((d) => d.severity === 'review').length,
    expected: diffs.filter((d) => d.severity === 'expected').length,
  };
  return { diffs, totalDiffs, counts };
}

/** 규칙 기반 요약 — LLM 불가 시에도 항상 제공되는 소견. */
export function formatRuleBasedSummary({ major, diffs, totalDiffs, counts }) {
  if (!diffs.length && !totalDiffs.length) {
    return `${Number(major)}차 확정 엑셀과 웹 보고서가 허용오차(1,000원/0.05%) 안에서 전부 일치합니다.`;
  }
  const byCause = {};
  for (const d of diffs) {
    if (d.col === 'I' || d.col === 'J') continue; // 파생값은 요약에서 원인 항목으로 세지 않음
    byCause[d.causeLabel] = (byCause[d.causeLabel] || 0) + 1;
  }
  const lines = [
    `${Number(major)}차 대조 결과: 확인 필요 ${counts.review}건 · 확정된 구조적 차이 ${counts.expected}건.`,
    ...Object.entries(byCause).sort((x, y) => y[1] - x[1]).map(([label, n]) => `· ${label}: ${n}건`),
  ];
  if (totalDiffs.length) {
    lines.push(`합계 차이: ${totalDiffs.map((t) => `${t.label} ${Math.round(t.diff).toLocaleString()}원`).join(', ')}`);
  }
  return lines.join('\n');
}

const OPINION_SYSTEM_PROMPT = `너는 꽃 수입 도매 ERP의 "주차별 매출이익 보고서" 감사 보조자다.
대표가 확정한 엑셀 보고서와 웹 자동계산을 셀 단위로 대조한 결과(JSON)를 받아,
대표가 30초 안에 읽을 소견을 한국어로 작성한다.

이 회사의 확정된 대조 방침(2026-08 대표 결정):
- 전산(ERP)이 정답이다. 전산에만 있는 매입/포워딩 차이는 정상이며 엑셀이 따라와야 한다.
- 순수매출↔그외매출이 같은 금액으로 상쇄되는 차이는 표시 위치 차이라 무시한다.
- 매출 차수귀속 차이는 확정 시 보고서의 매출조정(AC)/이익조정(AJ) 칸에 입력해 해소한다.
- 재고는 원본공식 근사를 쓰므로 엑셀 실사값과 수십~수백만원 차이는 예상 범위다.
- 그외통관비(관세·선율)와 환율 근사는 입력 화면에서 실측으로 채우는 것이 정석이다.

작성 규칙:
- 6문장 이내. '확인 필요' 항목을 금액 큰 순서로 먼저, 구조적(정상) 차이는 한 문장으로 묶는다.
- 금액은 만원 단위 반올림으로 읽기 쉽게. 조치가 있으면 어느 화면에서 하는지 명시한다.
- 차이가 없으면 일치한다고 한 문장으로 끝낸다. JSON/표/마크다운 헤더 금지, 평문만.`;

/** LLM 소견 — 실패/키 없음이면 null (호출부는 규칙 요약만 사용). */
export async function buildExcelAuditOpinion({ major, diffs, totalDiffs, counts }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  try {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const { trackLLMCall } = await import('./chat/costTracker.js');
    const client = new Anthropic({ apiKey });
    const compact = {
      major,
      counts,
      totalDiffs: totalDiffs.map((t) => ({ 항목: t.label, 엑셀: Math.round(t.excel), 웹: Math.round(t.web) })),
      diffs: diffs
        .filter((d) => d.col !== 'I')
        .sort((a, b) => Math.abs(b.diff || 0) - Math.abs(a.diff || 0))
        .slice(0, 40)
        .map((d) => ({
          품명: d.category, 항목: d.label, 엑셀: d.excel == null ? null : Math.round(d.excel),
          웹: d.web == null ? null : Math.round(d.web), 분류: d.causeLabel, 상태: d.severity,
        })),
    };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    const resp = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 700,
      system: OPINION_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: `대조 결과 JSON:\n${JSON.stringify(compact)}` }],
    }, { signal: controller.signal });
    clearTimeout(timer);
    trackLLMCall({
      userId: null, model: 'claude-haiku-4-5',
      inputTokens: resp?.usage?.input_tokens || 0,
      outputTokens: resp?.usage?.output_tokens || 0,
      purpose: 'profit-excel-audit',
    });
    const text = (resp.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
    return text ? { opinion: text, model: 'claude-haiku-4-5' } : null;
  } catch {
    return null;
  }
}
