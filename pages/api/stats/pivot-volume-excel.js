// pages/api/stats/pivot-volume-excel.js
// Pivot 통계 기반 통합 물량표 다운로드

import XLSX from 'xlsx-js-style';
import { withAuth } from '../../../lib/auth';
import { getFarmDisplayName } from '../../../lib/farmKoreanNames';
import { customerDisplayLabel, getPivotStats, makePivotVolumeSheetName } from '../../../lib/pivotStats';

const FLOWER_PREFIX = {
  '카네이션': '카',
  '수국': '수',
  '장미': '장',
  '알스트로': '알',
  '중국': '중',
  '태국': '태',
};

const DAY_ORDER = { '목': 0, '금': 1, '토': 2, '일': 3, '화': 4, '수': 5, '월': 6 };
const ALSTRO_DIVISOR = 16;
const CUSTOMER_COL_WCH = 4;
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

function extractCustomerAbbr(customer) {
  const descr = String(customer?.custDescr || '').trim();
  if (descr) {
    const head = descr.split('/')[0]?.trim();
    if (head) return head;
  }
  return customerDisplayLabel(customer);
}

function extractDays(customer, flower) {
  const prefix = FLOWER_PREFIX[flower];
  if (!prefix) return [];
  const descr = String(customer?.custDescr || '').trim();
  if (!descr) return [];

  const days = [];
  const re = new RegExp(`${prefix}[-.\\s]*([일월화수목금토][,일월화수목금토]*)`, 'gi');
  for (const match of descr.matchAll(re)) {
    const dayText = String(match[1] || '');
    for (const dayMatch of dayText.matchAll(/[일월화수목금토]/g)) {
      const day = dayMatch[0];
      if (!days.includes(day)) days.push(day);
    }
  }
  return days.sort((a, b) => (DAY_ORDER[a] ?? 99) - (DAY_ORDER[b] ?? 99));
}

function pickDataDay(days) {
  if (!days.length) return '';
  if (days.includes('일')) return '일';
  return days[0] || '';
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
      aoa[0][idx] = `${meta.weekLabel}${meta.flower || ''}`;
      aoa[1][idx] = '';
      aoa[2][idx] = '';
    } else if (col.type === 'customer') {
      const isRegionStart = idx === 0 || colPlan[idx - 1]?.group !== col.group;
      aoa[0][idx] = isRegionStart ? col.group : '';
      aoa[1][idx] = col.day || '';
      aoa[2][idx] = col.label;
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
      if (col.type === 'product') line.push(cleanProductLabel(row.prodName));
      else if (col.type === 'customer') line.push(q(row, row.orders?.[col.customer.custName]) || '');
      else if (col.type === 'summary' && col.label === '주문') line.push(q(row, row.totalOrder) || '');
      else if (col.type === 'summary' && col.label === '입고') line.push(q(row, row.totalIncoming) || '');
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
    else if (col.type === 'customer') totals.push(rows.reduce((sum, row) => sum + q(row, row.orders?.[col.customer.custName]), 0) || '');
    else if (col.type === 'summary' && col.label === '주문') totals.push(rows.reduce((sum, row) => sum + q(row, row.totalOrder), 0) || '');
    else if (col.type === 'summary' && col.label === '입고') totals.push(rows.reduce((sum, row) => sum + q(row, row.totalIncoming), 0) || '');
    else if (col.type === 'summary' && col.label === '재고') totals.push(rows.reduce((sum, row) => sum + q(row, row.prevStock), 0) || '');
    else if (col.type === 'summary' && col.label === '잔량') totals.push(rows.reduce((sum, row) => sum + q(row, row.curStock), 0) || '');
    else if (col.type === 'farm') totals.push(rows.reduce((sum, row) => sum + q(row, row.incoming?.[col.farm]), 0) || '');
    else totals.push('');
  });
  aoa.push(totals);

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = colPlan.map(col => ({
    wch: col.type === 'product' ? 24 : col.type === 'summary' ? 8 : col.type === 'customer' ? CUSTOMER_COL_WCH : 5,
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
      ws[encodeCell(excelRow, summaryCols['주문'])] = {
        t: 'n',
        v: q(row, row.totalOrder),
        f: `SUM(${encodeCell(excelRow, 2)}:${encodeCell(excelRow, Math.max(2, summaryCols['주문'] - 1))})`,
        s: STYLES.summary,
      };
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

  ws.A1 = { t: 's', v: `${meta.orderYear} ${meta.weekLabel} ${meta.sheetName} 통합 물량표` };
  for (let r = 1; r <= totalRow; r += 1) {
    colPlan.forEach((col, idx) => {
      const addr = encodeCell(r, idx + 1);
      if (!ws[addr]) ws[addr] = { t: 's', v: '' };
      if (r <= 3) ws[addr].s = r === 1 ? STYLES.title : STYLES.header;
      else if (r === totalRow) ws[addr].s = STYLES.summary;
      else if (col.type === 'product') ws[addr].s = STYLES.text;
      else if (col.type === 'summary') ws[addr].s = STYLES.summary;
      else ws[addr].s = STYLES.number;
    });
  }
  return ws;
}

export default withAuth(async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();
  const { weekStart, weekEnd, orderYear } = req.query;

  try {
    const data = await getPivotStats({ weekStart, weekEnd, orderYear });
    const wb = XLSX.utils.book_new();
    const customers = data.customers || [];
    const farms = data.farms || [];
    const weekLabel = `${data.weekStart}${data.weekEnd !== data.weekStart ? `~${data.weekEnd}` : ''}`;

    const groups = new Map();
    (data.rows || [])
      .filter(row => n(row.totalOrder) > 0 || n(row.totalIncoming) > 0)
      .forEach(row => {
        const flower = normalizeVolumeFlower(row.flower);
        const key = `${row.country || ''}|${flower || ''}`;
        if (!groups.has(key)) groups.set(key, { country: row.country, flower, rows: [] });
        groups.get(key).rows.push(row);
      });

    const usedSheetNames = new Set();
    for (const group of groups.values()) {
      const sheetRows = group.rows
        .filter(row => n(row.totalOrder) > 0)
        .sort((a, b) => String(a.prodName).localeCompare(String(b.prodName)));
      if (!sheetRows.length) continue;
      const sheetName = makePivotVolumeSheetName(group.country, group.flower, usedSheetNames);
      const ws = makeSheet(sheetRows, customers, farms, {
        orderYear: data.orderYear,
        weekLabel,
        flower: group.flower,
        sheetName,
      });
      XLSX.utils.book_append_sheet(wb, ws, sheetName);
    }

    if (!wb.SheetNames.length) {
      const ws = XLSX.utils.aoa_to_sheet([['통합 물량표'], [], ['데이터 없음']]);
      XLSX.utils.book_append_sheet(wb, ws, '데이터없음');
    }

    const fileBase = `${data.orderYear}_${data.weekStart}${data.weekEnd !== data.weekStart ? `_${data.weekEnd}` : ''}_통합물량표.xlsx`;
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', compression: true });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(fileBase)}`);
    return res.status(200).send(buf);
  } catch (err) {
    const status = /필요|형식|범위/.test(err.message) ? 400 : 500;
    return res.status(status).json({ success: false, error: err.message });
  }
});
