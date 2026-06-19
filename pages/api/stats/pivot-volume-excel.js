// pages/api/stats/pivot-volume-excel.js
// Pivot 통계 기반 통합 물량표 다운로드

import XLSX from 'xlsx-js-style';
import { withAuth } from '../../../lib/auth';
import { getFarmDisplayName } from '../../../lib/farmKoreanNames';
import { customerDisplayLabel, getPivotStats, makePivotVolumeSheetName } from '../../../lib/pivotStats';
import { DAY_ORDER, extractDays, pickDataDay } from '../../../lib/pivotVolumeCustDays';
import { includePivotVolumeRow, sumIncomingQty, sumOrderQty } from '../../../lib/pivotVolumeRows';
const ALSTRO_DIVISOR = 16;
const CUSTOMER_COL_WCH = 4;
const COUNTRY_ONLY_SHEETS = new Set(['중국', '태국', '호주', '네덜란드']);
const PRODUCT_WORD_RE = /\b(spray\s+rose|rose|hydrangea|alstroe?meria)\b\s*\/?\s*/gi;
const BORDER = {
  top: { style: 'thin', color: { rgb: 'C8C8C8' } },
  bottom: { style: 'thin', color: { rgb: 'C8C8C8' } },
  left: { style: 'thin', color: { rgb: 'C8C8C8' } },
  right: { style: 'thin', color: { rgb: 'C8C8C8' } },
};
const STYLES = {
  title: {
    font: { bold: true, name: '맑은 고딕', sz: 10 },
    fill: { fgColor: { rgb: 'D9E6F2' } },
    alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
    border: BORDER,
  },
  header: {
    font: { bold: true, name: '맑은 고딕', sz: 9 },
    fill: { fgColor: { rgb: 'E8EEF4' } },
    alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
    border: BORDER,
  },
  text: {
    font: { name: '맑은 고딕', sz: 9 },
    alignment: { horizontal: 'left', vertical: 'center', wrapText: false },
    border: BORDER,
  },
  number: {
    font: { bold: true, name: '맑은 고딕', sz: 9 },
    alignment: { horizontal: 'center', vertical: 'center' },
    border: BORDER,
    numFmt: 'General',
  },
  summary: {
    font: { bold: true, name: '맑은 고딕', sz: 9 },
    fill: { fgColor: { rgb: 'B5D9C8' } },
    alignment: { horizontal: 'center', vertical: 'center' },
    border: BORDER,
    numFmt: 'General',
  },
  // 잔량 음수 빨강 하이라이트
  summaryRed: {
    font: { bold: true, name: '맑은 고딕', sz: 9, color: { rgb: '9C0006' } },
    fill: { fgColor: { rgb: 'FFC7CE' } },
    alignment: { horizontal: 'center', vertical: 'center' },
    border: BORDER,
    numFmt: 'General',
  },
  // 업체/농장 헤더 위쪽맞춤
  headerTop: {
    font: { bold: true, name: '맑은 고딕', sz: 9 },
    fill: { fgColor: { rgb: 'E8EEF4' } },
    alignment: { horizontal: 'center', vertical: 'top', wrapText: true },
    border: BORDER,
  },
};

function n(value) {
  const num = Number(value || 0);
  return Number.isFinite(num) ? num : 0;
}

function encodeCell(row, col) {
  return XLSX.utils.encode_cell({ r: row - 1, c: col - 1 });
}

function normalizeVolumeFlower(flower) {
  const raw = String(flower || '').trim();
  if (/루스커스|ruscus|수국|hydrangea/i.test(raw)) return '수국';
  return raw;
}

function normalizeCountryName(country) {
  return String(country || '').replace(/\s+/g, '').trim();
}

function isNetherlands(rowOrMeta) {
  return normalizeCountryName(rowOrMeta?.country) === '네덜란드' ||
    normalizeCountryName(rowOrMeta?.sheetName) === '네덜란드';
}

// 중국·네덜란드 시트는 업체명 아래에 CL(OrderCode)을 함께 표시
function showsCustomerCL(meta) {
  if (isNetherlands(meta)) return true;
  const c = normalizeCountryName(meta?.country || meta?.species || meta?.sheetName);
  return c === '중국';
}

function countryOnlySheetName(country) {
  const normalized = normalizeCountryName(country);
  return COUNTRY_ONLY_SHEETS.has(normalized) ? normalized : '';
}

function isAlstroRow(row) {
  return /알스트로|alstro/i.test(`${row?.flower || ''} ${row?.prodName || ''}`);
}

function q(row, value) {
  const amount = n(value);
  return isAlstroRow(row) ? amount / ALSTRO_DIVISOR : amount;
}

function cleanProductLabel(name) {
  return String(name || '')
    .replace(/mini\s*carnation/gi, 'Mini ')
    .replace(/\bcarnation\b\s*\/?\s*/gi, ' ')
    .replace(PRODUCT_WORD_RE, ' ')
    .replace(/^[\s/／-]+|[\s/／-]+$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// 수국 특이 고정매칭 (원본명 기준 → 고정 표기). 식별: mojito=진, (bw)/화이트베이스=연.
const HYDRANGEA_FIXED = [
  { test: /mojito|모히또/i, to: '미니그린모히또(진)' },
  { test: /\(bw\)|화이트\s*베이스|white\s*base/i, to: '미니그린(연)' },
];

// flower별 품목명: 수국=한글 색상명만(괄호/슬래시/공백 제거), 장미=cm 제거
function volumeProdLabel(row) {
  const raw = String(row?.prodName || '');
  const fl = String(row?.flower || '');
  const isHydra = /수국|hydrangea|루스커스|ruscus/i.test(fl);
  // 수국 특이 고정매칭 (원본명 기준 — mojito/화이트베이스 등 영어 토큰으로 식별)
  if (isHydra) {
    const fixed = HYDRANGEA_FIXED.find(m => m.test.test(raw));
    if (fixed) return fixed.to;
  }
  let name = cleanProductLabel(raw);
  if (isHydra) {
    const korean = (name.match(/[가-힣][가-힣\s]*/g) || []).join(' ').trim();
    if (korean) {
      // 한글 색상명: 내부 공백 제거 (미니 그린 베이스 → 미니그린베이스, 블루, 진그린 …)
      name = korean.replace(/\s+/g, '');
    } else {
      // 한글 없음(Ruscus 등): 괄호/슬래시/점 제거, 숫자 앞에만 한 칸 유지 (Ruscus Green→RuscusGreen, rusucus 70 유지)
      name = name.replace(/[()[\]<>\/／.]/g, ' ')
        .replace(/\s+/g, ' ').trim()
        .replace(/\s+(?=\D)/g, '')
        .replace(/\s+(?=\d)/g, ' ')
        .trim() || name;
    }
  } else if (/장미|rose/i.test(fl)) {
    // "cm" 글자만 제거, 숫자(50/60)는 유지 (예: "프라우드 60cm" → "프라우드 60")
    name = name.replace(/\s*cm\b/gi, '').replace(/\s{2,}/g, ' ').trim() || name;
  }
  return name;
}

function dutchColorLabel(descr) {
  const head = String(descr || '').split(/[\/／]/)[0]?.trim() || '';
  if (!head || !/[가-힣]/.test(head)) return '';
  if (/[0-9]|\bmoq\b|시즌|월|단색|단당|박스|스템|길이|원산지|최소|주문|포장/i.test(head)) return '';
  return head.replace(/\s{2,}/g, ' ');
}

function extractCustomerAbbr(customer) {
  const descr = String(customer?.custDescr || '').trim();
  if (descr) {
    const head = descr.split('/')[0]?.trim();
    if (head) return head;
  }
  return customerDisplayLabel(customer);
}

function makeCustomerGroups(rows, customers, flower) {
  const active = customers
    .filter(customer => rows.some(row => n(row.orders?.[customer.custName]) > 0))
    .map(customer => {
      const days = extractDays(customer, flower);
      return {
        customer,
        region: customer.area || '기타',
        label: extractCustomerAbbr(customer) || customer.custName,
        day: pickDataDay(days),
      };
    });

  const labelCounts = new Map();
  active.forEach(col => {
    const key = String(col.label || '').trim();
    if (key) labelCounts.set(key, (labelCounts.get(key) || 0) + 1);
  });
  active.forEach(col => {
    if ((labelCounts.get(col.label) || 0) > 1) col.label = col.customer.custName;
  });

  const regions = [];
  const seen = new Set();
  active.forEach(col => {
    if (!seen.has(col.region)) {
      seen.add(col.region);
      regions.push(col.region);
    }
  });
  if (regions.includes('경부선_주광')) {
    regions.splice(regions.indexOf('경부선_주광'), 1);
    regions.unshift('경부선_주광');
  }

  return regions.map(region => ({
    region,
    cols: active
      .filter(col => col.region === region)
      .sort((a, b) => {
        const pa = a.label === '주광' ? 0 : a.label === '주광여분' ? 1 : 2;
        const pb = b.label === '주광' ? 0 : b.label === '주광여분' ? 1 : 2;
        return pa - pb ||
          (DAY_ORDER[a.day] ?? 99) - (DAY_ORDER[b.day] ?? 99) ||
          String(a.label).localeCompare(String(b.label));
      }),
  }));
}

function activeFarms(rows, farms) {
  return farms.filter(farm => rows.some(row => n(row.incoming?.[farm]) > 0));
}

function makeColumnPlan(rows, customers, farms, meta) {
  const customerGroups = makeCustomerGroups(rows, customers, meta.flower);
  const customerColCount = customerGroups.reduce((sum, group) => sum + group.cols.length, 0);
  const farmNames = activeFarms(rows, farms);
  const colPlan = [{ type: 'product', section: 'left' }];
  if (isNetherlands(meta)) colPlan.push({ type: 'color' });

  for (const group of customerGroups) {
    if (customerColCount > 10 && group.region === '지방' && colPlan.filter(col => col.type === 'product').length === 1) {
      colPlan.push({ type: 'product', section: 'middle' });
    }
    group.cols.forEach(col => colPlan.push({ type: 'customer', group: group.region, ...col }));
  }

  ['주문', '입고', '재고', '잔량'].forEach(label => colPlan.push({ type: 'summary', label }));
  colPlan.push({ type: 'product', section: 'farm' });
  farmNames.forEach(farm => colPlan.push({ type: 'farm', farm }));
  return colPlan;
}

function makeSheet(rows, customers, farms, meta) {
  const colPlan = makeColumnPlan(rows, customers, farms, meta);
  const aoa = [[], [], []];

  colPlan.forEach((col, idx) => {
    if (col.type === 'product') {
      aoa[0][idx] = `차수(${String(meta.weekLabel || '').replace(/-/g, '')}) 품종(${meta.species || meta.flower || ''})`;
      aoa[1][idx] = '';
      aoa[2][idx] = '';
    } else if (col.type === 'color') {
      aoa[0][idx] = '';
      aoa[1][idx] = '';
      aoa[2][idx] = '칼라';
    } else if (col.type === 'customer') {
      const isRegionStart = idx === 0 || colPlan[idx - 1]?.group !== col.group;
      aoa[0][idx] = isRegionStart ? col.group : '';
      aoa[1][idx] = col.day || '';
      // 중국·네덜란드 시트: 업체명 아래 줄에 CL(OrderCode) 추가 표시
      const cl = String(col.customer?.orderCode || '').trim();
      aoa[2][idx] = (showsCustomerCL(meta) && cl) ? `${col.label}\n${cl}` : col.label;
    } else if (col.type === 'summary') {
      aoa[0][idx] = '';
      aoa[1][idx] = '';
      aoa[2][idx] = col.label;
    } else if (col.type === 'farm') {
      aoa[0][idx] = '';
      aoa[1][idx] = '';
      aoa[2][idx] = getFarmDisplayName(col.farm);
    }
  });

  rows.forEach(row => {
    const line = [];
    colPlan.forEach(col => {
      if (col.type === 'product') line.push(volumeProdLabel(row));
      else if (col.type === 'color') line.push(isNetherlands(row) ? dutchColorLabel(row.productDescr) : '');
      else if (col.type === 'customer') line.push(q(row, row.orders?.[col.customer.custName]) || '');
      else if (col.type === 'summary' && col.label === '주문') line.push(q(row, sumOrderQty(row)) || '');
      else if (col.type === 'summary' && col.label === '입고') line.push(q(row, sumIncomingQty(row)) || '');
      else if (col.type === 'summary' && col.label === '재고') line.push(q(row, row.prevStock) || '');
      else if (col.type === 'summary' && col.label === '잔량') line.push(q(row, row.curStock) || '');
      else if (col.type === 'farm') line.push(q(row, row.incoming?.[col.farm]) || '');
      else line.push('');
    });
    aoa.push(line);
  });

  const totals = [];
  colPlan.forEach(col => {
    if (col.type === 'product') totals.push('합계');
    else if (col.type === 'color') totals.push('');
    else if (col.type === 'customer') totals.push(rows.reduce((sum, row) => sum + q(row, row.orders?.[col.customer.custName]), 0) || '');
    else if (col.type === 'summary' && col.label === '주문') totals.push(rows.reduce((sum, row) => sum + q(row, sumOrderQty(row)), 0) || '');
    else if (col.type === 'summary' && col.label === '입고') totals.push(rows.reduce((sum, row) => sum + q(row, sumIncomingQty(row)), 0) || '');
    else if (col.type === 'summary' && col.label === '재고') totals.push(rows.reduce((sum, row) => sum + q(row, row.prevStock), 0) || '');
    else if (col.type === 'summary' && col.label === '잔량') totals.push(rows.reduce((sum, row) => sum + q(row, row.curStock), 0) || '');
    else if (col.type === 'farm') totals.push(rows.reduce((sum, row) => sum + q(row, row.incoming?.[col.farm]), 0) || '');
    else totals.push('');
  });
  aoa.push(totals);

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = colPlan.map(col => ({
    wch: col.type === 'product' ? 24 : col.type === 'color' ? 8 : col.type === 'summary' ? 8 : col.type === 'customer' ? CUSTOMER_COL_WCH : 5,
  }));
  ws['!rows'] = [{ hpt: 22 }, { hpt: 20 }, { hpt: 44 }];
  ws['!freeze'] = { xSplit: 1, ySplit: 3 };

  const dataStart = 4;
  const totalRow = dataStart + rows.length;
  const summaryCols = {};
  colPlan.forEach((col, idx) => {
    if (col.type === 'summary') summaryCols[col.label] = idx + 1;
  });

  rows.forEach((row, idx) => {
    const excelRow = dataStart + idx;
    if (summaryCols['주문']) {
      // 거래처 컬럼이 1개 이상일 때만 SUM(거래처범위). 입고전용 시트(거래처 없음)면 값만 — 자기참조(순환) 방지.
      const lastCustCol = summaryCols['주문'] - 1;
      const cell = { t: 'n', v: q(row, sumOrderQty(row)), s: STYLES.summary };
      if (lastCustCol >= 2) cell.f = `SUM(${encodeCell(excelRow, 2)}:${encodeCell(excelRow, lastCustCol)})`;
      ws[encodeCell(excelRow, summaryCols['주문'])] = cell;
    }
    if (summaryCols['잔량']) {
      const inCell = encodeCell(excelRow, summaryCols['입고']);
      const orderCell = encodeCell(excelRow, summaryCols['주문']);
      const stockCell = encodeCell(excelRow, summaryCols['재고']);
      ws[encodeCell(excelRow, summaryCols['잔량'])] = {
        t: 'n',
        v: q(row, row.curStock),
        f: `SUM(${inCell})-SUM(${orderCell})+SUM(${stockCell})`,
        s: STYLES.summary,
      };
    }
  });

  colPlan.forEach((col, idx) => {
    if (col.type === 'product') return;
    const colNo = idx + 1;
    const value = totals[idx];
    ws[encodeCell(totalRow, colNo)] = typeof value === 'number'
      ? { t: 'n', v: value, f: `SUM(${encodeCell(dataStart, colNo)}:${encodeCell(totalRow - 1, colNo)})`, s: STYLES.summary }
      : { t: 's', v: String(value || ''), s: STYLES.summary };
  });

  const weekNum = String(meta.weekLabel || '').replace(/-/g, '');
  ws.A1 = { t: 's', v: `차수(${weekNum}) 품종(${meta.species || meta.flower || ''})` };
  for (let r = 1; r <= totalRow; r += 1) {
    colPlan.forEach((col, idx) => {
      const addr = encodeCell(r, idx + 1);
      if (!ws[addr]) ws[addr] = { t: 's', v: '' };
      const cellVal = typeof ws[addr].v === 'number' ? ws[addr].v : null;
      const remainNeg = col.type === 'summary' && col.label === '잔량' && cellVal != null && cellVal < 0;
      if (r <= 3) {
        ws[addr].s = r === 1 ? STYLES.title
          : (r === 3 && (col.type === 'customer' || col.type === 'farm')) ? STYLES.headerTop  // #5 업체/농장 위쪽맞춤
          : STYLES.header;
      } else if (r === totalRow) ws[addr].s = remainNeg ? STYLES.summaryRed : STYLES.summary;
      else if (col.type === 'product') ws[addr].s = STYLES.text;
      else if (col.type === 'color') ws[addr].s = STYLES.text;
      else if (col.type === 'summary') ws[addr].s = remainNeg ? STYLES.summaryRed : STYLES.summary;  // #4 잔량 음수 빨강
      else ws[addr].s = STYLES.number;
    });
  }

  // 재업로드(출고분배) 정확 매칭용 키맵: 셀 "텍스트"(업체명/품목명)→키.
  // 위치(컬럼/행 index)가 아니라 실제 셀 텍스트로 매칭 → 중간 품목열 삽입 등 레이아웃 변화에도 안 깨짐.
  const keymap = [];
  colPlan.forEach((col, idx) => {
    if (col.type === 'customer' && col.customer?.custKey) {
      keymap.push({ kind: 'cust', label: String(aoa[2][idx] ?? ''), key: Number(col.customer.custKey) });
    }
  });
  rows.forEach((row) => {
    if (row?.prodKey) keymap.push({ kind: 'prod', label: volumeProdLabel(row), key: Number(row.prodKey) });
  });

  return { ws, keymap };
}

export default withAuth(async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();
  const { weekStart, weekEnd, orderYear } = req.query;
  const onlyKey = req.query.species ? String(req.query.species) : null;   // 시트별 별도파일: 이 품종만
  const listMode = req.query.list === '1' || req.query.list === 'true';   // 품종 목록만 반환

  try {
    const data = await getPivotStats({ weekStart, weekEnd, orderYear });
    const wb = XLSX.utils.book_new();
    const customers = data.customers || [];
    const farms = data.farms || [];
    const weekLabel = `${data.weekStart}${data.weekEnd !== data.weekStart ? `~${data.weekEnd}` : ''}`;

    const groups = new Map();
    (data.rows || [])
      .filter(includePivotVolumeRow)
      .forEach(row => {
        const countrySheet = countryOnlySheetName(row.country);
        const flower = normalizeVolumeFlower(row.flower);
        const key = countrySheet ? `country:${countrySheet}` : `${row.country || ''}|${flower || ''}`;
        if (!groups.has(key)) {
          groups.set(key, {
            country: row.country,
            flower: countrySheet || flower,
            sheetNameBase: countrySheet,
            countryOnly: !!countrySheet,
            rows: [],
          });
        }
        groups.get(key).rows.push(row);
      });

    const weekNum = String(data.weekStart || '').replace(/-/g, '');
    const speciesOf = (g) => g.countryOnly ? g.country : `${g.country || ''}${g.flower || ''}`;

    // 시트별 별도파일: 품종 목록만 반환 (페이지가 이걸 받아 품종마다 개별 다운로드)
    if (listMode) {
      const items = [...groups.entries()]
        .filter(([, g]) => g.rows.some(includePivotVolumeRow))
        .map(([key, g]) => ({ key, species: speciesOf(g), fileName: `${weekNum}_${speciesOf(g)}.xlsx` }));
      return res.status(200).json({ success: true, weekNum, items });
    }

    const usedSheetNames = new Set();
    const globalKeymap = [];   // 재업로드 정확 매칭용: { sheet, kind, idx, key }
    for (const [key, group] of groups) {
      if (onlyKey && key !== onlyKey) continue;
      const sheetRows = group.rows
        // 주문만·입고만 있는 품목 모두 포함 (totalOrder/totalIncoming 0 이어도 orders/incoming 맵 확인)
        .filter(includePivotVolumeRow)
        .sort((a, b) => group.countryOnly
          ? `${normalizeVolumeFlower(a.flower)}${a.prodName}`.localeCompare(`${normalizeVolumeFlower(b.flower)}${b.prodName}`)
          : String(a.prodName).localeCompare(String(b.prodName)));
      if (!sheetRows.length) continue;
      const sheetName = group.sheetNameBase
        ? makePivotVolumeSheetName(group.sheetNameBase, '', usedSheetNames)
        : makePivotVolumeSheetName(group.country, group.flower, usedSheetNames);
      const { ws, keymap } = makeSheet(sheetRows, customers, farms, {
        orderYear: data.orderYear,
        weekLabel,
        country: group.country,
        flower: group.flower,
        species: group.countryOnly ? group.country : `${group.country || ''}${group.flower || ''}`,
        sheetName,
      });
      XLSX.utils.book_append_sheet(wb, ws, sheetName);
      (keymap || []).forEach(k => globalKeymap.push({ sheet: sheetName, kind: k.kind, label: k.label, key: k.key }));
    }

    if (!wb.SheetNames.length) {
      const ws = XLSX.utils.aoa_to_sheet([['통합 물량표'], [], ['데이터 없음']]);
      XLSX.utils.book_append_sheet(wb, ws, '데이터없음');
    }

    // 숨김 키맵 시트: 재업로드(출고분배) 시 셀 텍스트(label)→키로 정확 매칭 → 업체/품목 누락 방지
    if (globalKeymap.length) {
      const kmAoa = [['type', 'sheet', 'label', 'key'],
        ...globalKeymap.map(k => [k.kind, k.sheet, k.label, k.key])];
      const kmWs = XLSX.utils.aoa_to_sheet(kmAoa);
      XLSX.utils.book_append_sheet(wb, kmWs, '_keymap');
      if (!wb.Workbook) wb.Workbook = {};
      wb.Workbook.Sheets = wb.SheetNames.map(name => ({ Hidden: name === '_keymap' ? 1 : 0 }));
    }

    const fileBase = (onlyKey && groups.get(onlyKey))
      ? `${weekNum}_${speciesOf(groups.get(onlyKey))}.xlsx`
      : `${data.orderYear}_${data.weekStart}${data.weekEnd !== data.weekStart ? `_${data.weekEnd}` : ''}_통합물량표.xlsx`;
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', compression: true });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(fileBase)}`);
    return res.status(200).send(buf);
  } catch (err) {
    const status = /필요|형식|범위/.test(err.message) ? 400 : 500;
    return res.status(status).json({ success: false, error: err.message });
  }
});
