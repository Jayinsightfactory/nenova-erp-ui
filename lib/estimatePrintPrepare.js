// 견적서/거래명세표 인쇄 — 행 준비(합산·정렬·금액) 공통

import {
  formatEstimatePrintDescr,
  isEstimateDeductionRow,
  isPrintableEstimateRow,
} from './estimateInvariants';
import {
  applyStatementPrintAmounts,
  getEstimateOriginCountry,
  getEstimateSpecLabel,
  getStatementProductName,
  isStatementPrintFormat,
} from './estimatePrintFormats';

const ESTIMATE_TYPE_MAP = {
  fee01: '단가차감', fee02: '검역차감', fee03: '불량차감',
  fee04: '부족차감', fee05: '출하오류차감', fee06: '샘플',
  kr0010: '불량차감', kr0011: '검역차감', kr0012: '단가차감',
};

function isAlstroRow(row) {
  const text = `${row?.FlowerName || ''} ${row?.ProdName || ''}`.toUpperCase();
  return text.includes('ALSTRO') || text.includes('알스트로');
}

function normalizeEstimatePrintRow(row) {
  if (!isAlstroRow(row)) return row;
  const rawSteam = Number(row?.RawSteamQuantity) || 0;
  const rawBunch = Number(row?.RawBunchQuantity) || 0;
  const currentQty = Number(row?.Quantity) || 0;
  const steamQty = rawSteam > 0 ? rawSteam : (rawBunch > 0 ? rawBunch * 10 : currentQty);
  if (steamQty <= 0) return row;
  const total = (Number(row?.Amount) || 0) + (Number(row?.Vat) || 0);
  const displayCost = total > 0 ? Math.round(total / steamQty) : row?.Cost;
  return { ...row, Quantity: steamQty, Unit: '송이', Cost: displayCost };
}

export function mapEstimateType(t) {
  if (!t) return '';
  if (/^[a-z0-9-]+$/i.test(t)) {
    const parts = t.toLowerCase().split('-');
    for (const p of parts) {
      if (ESTIMATE_TYPE_MAP[p]) return ESTIMATE_TYPE_MAP[p];
    }
    return '차감';
  }
  return t.replace(/\/(박스|단|송이)$/, '');
}

export function estimateTypeLabel(t) {
  if (!t || t === '정상출고') return '';
  return `[${mapEstimateType(t)}] `;
}

function printRowPriority(row) {
  const isDed = isEstimateDeductionRow(row);
  const country = row.CounName || '';
  const flower = row.FlowerName || '';
  const prod = row.ProdName || '';
  if (!isDed) {
    if (/콜롬비아/.test(country)) {
      if (/수국/.test(flower)) return 1;
      if (/알스트로/.test(flower)) return 2;
      if (/루스커스/.test(flower)) return 3;
      if (/카네이션/.test(flower)) return 4;
      if (/장미/.test(flower)) return 5;
      return 6;
    }
    if (/네덜란드/.test(country)) return 10;
    if (/호주/.test(country)) return 11;
    if (/중국/.test(country)) return 12;
    if (/에콰도르/.test(country)) return 13;
    return 50;
  }
  if (/운송/.test(prod)) return 79;
  if (/운임/.test(prod)) return 80;
  return 99;
}

function sortPrintRows(rows) {
  return [...rows].sort((a, b) => {
    const pa = printRowPriority(a);
    const pb = printRowPriority(b);
    if (pa !== pb) return pa - pb;
    return (a.ProdName || '').localeCompare(b.ProdName || '', 'en', { numeric: true, sensitivity: 'base' });
  });
}

/**
 * 인쇄·엑셀 공통 — 합산·정렬·거래명세표 금액 적용
 */
export function prepareEstimatePrintRows(rawRows, {
  printFormat,
  showDistribDesc = false,
} = {}) {
  const statementFormat = isStatementPrintFormat(printFormat);
  const fmtN = (n) => Number(n || 0).toLocaleString();
  const descLabel = (r) => formatEstimatePrintDescr(r, { showDistribDesc });

  let rows = (rawRows || []).map(normalizeEstimatePrintRow).filter(isPrintableEstimateRow);
  rows.sort((a, b) => {
    const pa = printRowPriority(a);
    const pb = printRowPriority(b);
    if (pa !== pb) return pa - pb;
    const adt = a.outDate || '';
    const bdt = b.outDate || '';
    if (adt !== bdt) return adt.localeCompare(bdt);
    return (a.ProdName || '').localeCompare(b.ProdName || '');
  });

  const groups = {};
  rows.forEach((r) => {
    const costKey = Number(r.Cost || 0).toFixed(4);
    const key = `${r.EstimateType || '정상출고'}|${r.ProdKey || r.ProdName}|${r.Unit || ''}|${costKey}|${r.outDate || ''}`;
    if (!groups[key]) {
      groups[key] = {
        ...r, Quantity: 0, BoxQty: 0, Amount: 0, Vat: 0, _breakdown: {}, _outDates: new Set(),
      };
    }
    const g = groups[key];
    g.Quantity += Number(r.Quantity) || 0;
    g.BoxQty += Number(r.BoxQty) || 0;
    g.Amount += Number(r.Amount) || 0;
    g.Vat += Number(r.Vat) || 0;
    const ow = r.OrderWeek || '';
    const subM = ow.match(/-(\d+)$/);
    const subLabel = subM ? `${parseInt(subM[1], 10)}차` : (ow || '');
    if (subLabel) g._breakdown[subLabel] = (g._breakdown[subLabel] || 0) + (Number(r.Quantity) || 0);
    if (r.outDate) g._outDates.add(r.outDate);
  });

  rows = Object.values(groups).map((g) => {
    const qty = Number(g.Quantity) || 0;
    const supply = Number(g.Amount) || 0;
    const vat = Number(g.Vat) || 0;
    if (qty > 0 && (supply + vat) > 0) g.Cost = Math.round((supply + vat) / qty);
    const parts = Object.entries(g._breakdown)
      .filter(([, v]) => v > 0)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k} ${fmtN(v)}${g.Unit || ''}`);
    g._distribDesc = parts.join(', ');
    return g;
  }).filter(isPrintableEstimateRow);

  if (statementFormat) rows = rows.map(applyStatementPrintAmounts);
  rows = sortPrintRows(rows);

  const supply = rows.reduce((a, r) => a + (Number(r.Amount) || 0), 0);
  const vat = rows.reduce((a, r) => a + (Number(r.Vat) || 0), 0);

  return {
    rows,
    statementFormat,
    totals: { supply, vat, total: supply + vat },
    descLabel,
    estimateTypeLabel,
  };
}

/** 인쇄·엑셀용 시트 데이터 (aoa) */
export function buildEstimatePrintSheetAoa({
  custName,
  week,
  printDate,
  serialNo,
  printFormat,
  rows,
  showBoxQty = true,
  showDistribDesc = false,
  bigoLabel = '',
}) {
  const prepared = prepareEstimatePrintRows(rows, { printFormat, showDistribDesc });
  const { rows: printRows, totals, statementFormat, descLabel } = prepared;
  const title = statementFormat ? '거래명세표' : '견적서';
  const aoa = [
    [`${title} — ${custName}`, week ? `${week}차` : ''],
    [`출력일자: ${printDate || ''}`, serialNo ? `일련번호: ${serialNo}` : '', bigoLabel ? `비고: ${bigoLabel}` : ''],
    [],
  ];

  if (statementFormat) {
    aoa.push(['번호', '품목', '원산지', '단위', '규격', '수량', '단가', '금액', '세액', '비고']);
    printRows.forEach((r, i) => {
      aoa.push([
        i + 1,
        `${estimateTypeLabel(r.EstimateType)}${getStatementProductName(r)}`,
        getEstimateOriginCountry(r),
        r.Unit || '',
        getEstimateSpecLabel(r),
        Number(r.Quantity) || 0,
        Number(r.Cost) || 0,
        Number(r.Amount) || 0,
        Number(r.Vat) || 0,
        descLabel(r),
      ]);
    });
    aoa.push([]);
    aoa.push(['', '', '', '', '', '', '합계', totals.supply, totals.vat, totals.total]);
    return aoa;
  }

  const headers = ['순번', '품목명[규격]', '수량', '단위'];
  if (showBoxQty) headers.push('박스');
  headers.push('단가', '공급가액', '부가세', '적요');
  aoa.push(headers);

  printRows.forEach((r, i) => {
    const line = [
      i + 1,
      `${estimateTypeLabel(r.EstimateType)}${r.ProdName || ''}`,
      Number(r.Quantity) || 0,
      r.Unit || '',
    ];
    if (showBoxQty) line.push(Number(r.BoxQty) || 0);
    line.push(Number(r.Cost) || 0, Number(r.Amount) || 0, Number(r.Vat) || 0, descLabel(r));
    aoa.push(line);
  });
  aoa.push([]);
  const foot = ['', '공급가액 합계', '', ''];
  if (showBoxQty) foot.push('');
  foot.push('', totals.supply, totals.vat, totals.total);
  aoa.push(foot);
  return aoa;
}

export function sanitizeExcelSheetName(name) {
  const s = String(name || 'sheet').replace(/[\\/?*[\]:]/g, '_').slice(0, 28);
  return s || 'sheet';
}
