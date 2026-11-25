import XLSX from 'xlsx-js-style';
import { generatePedidosFromMatrix, resolveEcuadorBoxDivisor } from './importPedidos.js';
import { prepareCountryOrderPedidos } from './countryOrderPedidosAdapter.js';
import { importCountryLabel, importUnitLabel } from './importToolsDisplay.js';

export const FARM_SPLIT_COUNTRIES = Object.freeze(['China', 'Ecuador']);
export const DEFAULT_SPLIT_FARMS = Object.freeze({
  China: ['Melody', 'CLOUD'],
  Ecuador: ['La Rosaleda', 'Fagua Flowers'],
});
const SINGLE_FILE_MULTI_UNIT_COUNTRIES = new Set(['China', 'Ecuador', 'NewZealand', 'Japan', 'USA', 'Israel', 'Ethiopia']);

const prefixes = /^(?:(?:SPRAY\s+ROSE|ROSE|Hydrangea|CARNATION|ALSTROMERIA|Ruscus|MiniCarnation)(?:\s+CHINA)?|CHINA)\s*(?:\/\s*|\s+)/i;
export function countryOrderShortName(row) {
  const full = String(row.label ?? row.name ?? '');
  return full.replace(prefixes, '').trim() || full;
}
export function countryOrderGroup(matrix, row) {
  return `${importCountryLabel(matrix.scope.country)} · ${row.flower || '기타'}`;
}
export function countryOrderIssue(message) {
  return String(message).replace(/DUPLICATE_CUSTOMER_CODE/g, '업체 코드 중복').replace(/DUPLICATE_PRODUCT_NAME/g, '품목명 중복')
    .replace(/DUPLICATE_MATRIX_IDENTITY/g, '업체·품목 식별값 중복').replace(/MISSING_CUSTOMER_CODE/g, '업체 코드 미등록')
    .replace(/UNRECOGNIZED_CUSTOMER_CODE/g, '업체 코드 형식 확인 필요')
    .replace(/STEM_QUANTITY_UNAVAILABLE/g, '송이 수량 확인 필요')
    .replace(/BUNCH_QUANTITY_UNAVAILABLE/g, '단 수량 확인 필요')
    .replace(/REQUIRED_QUANTITY_UNAVAILABLE/g, '발주 수량 확인 필요')
    .replace(/UNKNOWN_CUSTOMER_CODE/g, '업체 코드 확인 필요')
    .replace(/UNSUPPORTED_UNIT/g, '지원하지 않는 단위').replace(/DUPLICATE/gi, '중복').replace(/MISSING/gi, '미등록');
}

export function splitCountryOrderFarms(matrix, options = {}) {
  prepareCountryOrderPedidos(matrix); // Same scope, completeness and quantity validation as legacy exports.
  const country = matrix.scope.country;
  if (!FARM_SPLIT_COUNTRIES.includes(country)) return [{ matrix, farm: '' }];
  const defaults = DEFAULT_SPLIT_FARMS[country];
  const farms = (options.farms ?? defaults).map(value => String(value).trim());
  if (farms.length !== 2 || farms.some(value => !value || value.length > 80 || /[<>:"/\\|?*\x00-\x1f]/.test(value)) || farms[0].toLowerCase() === farms[1].toLowerCase()) throw new Error('서로 다른 수신 농장 두 곳을 선택하세요. 파일명에 쓸 수 없는 문자는 제외하세요.');
  const selected = options.selected ?? {};
  const keys = new Set(matrix.rows.map(row => String(row.prodKey)));
  if (Object.entries(selected).some(([key, value]) => !keys.has(key) || typeof value !== 'boolean')) throw new Error('이전 조회의 농장 선택이 남아 있습니다. 다시 선택하세요.');
  if (options.split !== true) return [{ matrix, farm: country === 'China' ? farms[0] : '' }];
  return farms.map((farm, index) => ({ farm, matrix: { ...matrix, rows: matrix.rows.filter(row => (selected[String(row.prodKey)] === true ? 0 : 1) === index) } })).filter(entry => entry.matrix.rows.length);
}

function ecuadorRowBoxes(row) {
  if (row.boxesOverride != null && Number.isFinite(row.boxesOverride)) return { value: row.boxesOverride, divisor: null, isManual: true };
  const divisor = resolveEcuadorBoxDivisor(row.unit, row.unitBasis ?? null);
  return { value: row.total / divisor, divisor, isManual: false };
}

function matrixSheet(matrix, farm) {
  const isEcuador = matrix.scope.country === 'Ecuador';
  const headers = ['품목', '단위', ...matrix.customers.map(customer => customer.label), '합계', ...(isEcuador ? ['박스'] : [])];
  const rows = [...matrix.rows].sort((a, b) => countryOrderGroup(matrix, a).localeCompare(countryOrderGroup(matrix, b), 'ko') || a.name.localeCompare(b.name, 'en'));
  const titleFarm = farm ? ` ${farm}` : '';
  const data = [[`${importCountryLabel(matrix.scope.country)}${titleFarm} 발주서 · ${matrix.scope.year} | Semana ${matrix.scope.orderWeek}차`], [], headers];
  let group;
  const rowMeta = new Map();
  for (const row of rows) {
    const next = countryOrderGroup(matrix, row);
    if (next !== group) { data.push([next]); group = next; }
    const boxInfo = isEcuador ? ecuadorRowBoxes(row) : null;
    const rowIndex = data.length;
    rowMeta.set(rowIndex, { row, boxInfo });
    data.push([
      countryOrderShortName(row),
      importUnitLabel(row.unit),
      ...matrix.customers.map(customer => row.quantities[customer.key] ?? 0),
      row.total,
      ...(isEcuador ? [boxInfo.value] : []),
    ]);
  }
  const lastDataRow = data.length; // 1-based Excel row index of last product row
  const unitsPresent = [...new Set(rows.map(row => row.unit))];
  const totalColIndex = 2 + matrix.customers.length;
  const boxColIndex = isEcuador ? totalColIndex + 1 : -1;
  const totalRows = [];
  if (rows.length > 0) {
    if (unitsPresent.length === 1) {
      const unitLabel = importUnitLabel(unitsPresent[0]);
      const customerTotals = matrix.customers.map(c => rows.reduce((sum, r) => sum + (r.quantities[c.key] ?? 0), 0));
      const grandTotal = rows.reduce((sum, r) => sum + r.total, 0);
      const boxTotal = isEcuador ? rows.reduce((sum, r) => sum + ecuadorRowBoxes(r).value, 0) : null;
      totalRows.push({ rowIndex: data.length, unitLabel: null, label: 'TOTAL' });
      data.push(['TOTAL', unitLabel, ...customerTotals, grandTotal, ...(isEcuador ? [boxTotal] : [])]);
    } else {
      for (const unit of unitsPresent) {
        const unitLabel = importUnitLabel(unit);
        const matching = rows.filter(r => r.unit === unit);
        const customerTotals = matrix.customers.map(c => matching.reduce((sum, r) => sum + (r.quantities[c.key] ?? 0), 0));
        const grandTotal = matching.reduce((sum, r) => sum + r.total, 0);
        const boxTotal = isEcuador ? matching.reduce((sum, r) => sum + ecuadorRowBoxes(r).value, 0) : null;
        totalRows.push({ rowIndex: data.length, unitLabel, label: `TOTAL (${unitLabel})` });
        data.push([`TOTAL (${unitLabel})`, unitLabel, ...customerTotals, grandTotal, ...(isEcuador ? [boxTotal] : [])]);
      }
    }
  }
  const sheet = XLSX.utils.aoa_to_sheet(data);
  sheet['!cols'] = [{ wch: 48 }, { wch: 8 }, ...matrix.customers.map(() => ({ wch: 12 })), { wch: 14 }, ...(isEcuador ? [{ wch: 12 }] : [])];
  sheet['!rows'] = data.map((_, index) => ({ hpt: index === 0 ? 60 : 23 }));
  sheet['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: headers.length - 1 } }];
  sheet['!freeze'] = 'C4';
  const totalRowSet = new Set(totalRows.map(t => t.rowIndex));
  for (let r = 2; r < data.length; r += 1) {
    const isGroup = data[r].length === 1;
    const isTotal = totalRowSet.has(r);
    for (let c = 0; c < headers.length; c += 1) {
      const address = XLSX.utils.encode_cell({ r, c });
      const cell = sheet[address] ?? (sheet[address] = { t: 's', v: '' });
      cell.s = { font: { name: '맑은 고딕', sz: 10, bold: r === 2 || isGroup || isTotal }, alignment: { horizontal: c < 2 ? 'left' : 'center', vertical: 'center' }, fill: { fgColor: { rgb: isTotal ? 'DCE7F4' : r === 2 || isGroup ? 'E8EEF6' : 'FFFFFF' } }, border: { bottom: { style: 'thin', color: { rgb: 'D8E0EA' } }, ...(isTotal ? { top: { style: 'thin', color: { rgb: '94A3B8' } } } : {}) } };
      if (cell.t === 'n') cell.z = '[=0]"";General';
    }
    if (!isGroup && !isTotal && r > 2) {
      const totalCell = sheet[XLSX.utils.encode_cell({ r, c: totalColIndex })];
      totalCell.f = matrix.customers.length ? `SUM(C${r + 1}:${XLSX.utils.encode_col(totalColIndex - 1)}${r + 1})` : '0';
      if (isEcuador) {
        const meta = rowMeta.get(r);
        const boxCell = sheet[XLSX.utils.encode_cell({ r, c: boxColIndex })];
        if (meta && !meta.boxInfo.isManual) {
          const totalColLetter = XLSX.utils.encode_col(totalColIndex);
          boxCell.f = meta.boxInfo.divisor === 1 ? `${totalColLetter}${r + 1}` : `${totalColLetter}${r + 1}/${meta.boxInfo.divisor}`;
        }
      }
    }
  }
  for (const { rowIndex, unitLabel } of totalRows) {
    for (let c = 2; c < headers.length; c += 1) {
      const col = XLSX.utils.encode_col(c);
      const cell = sheet[XLSX.utils.encode_cell({ r: rowIndex, c })];
      cell.f = unitLabel
        ? `SUMIF($B$4:$B$${lastDataRow},"${unitLabel}",${col}4:${col}${lastDataRow})`
        : `SUM(${col}4:${col}${lastDataRow})`;
    }
  }
  return sheet;
}

/** File-only presentation. Legacy templates and their formulas remain additional sheets. */
export function generateCompactCountryOrders(matrix, options) {
  return splitCountryOrderFarms(matrix, options).flatMap(({ matrix: partition, farm }) => {
    const legacy = generatePedidosFromMatrix(partition);
    // One file per recipient/country when mixed units can coexist (China, Ecuador, new countries).
    // Keep unlike units separate rather than presenting a meaningless grand total.
    if (SINGLE_FILE_MULTI_UNIT_COUNTRIES.has(partition.scope.country)) {
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, matrixSheet(partition, farm), '업체별 발주');
      let index = 0;
      for (const output of legacy) {
        for (const name of output.workbook.SheetNames) {
          const sheet = output.workbook.Sheets[name];
          const sheetCopy = farm && partition.scope.country === 'Ecuador' && sheet?.A1?.v
            ? { ...sheet, A1: { ...sheet.A1, v: String(sheet.A1.v).replace('Pedido Ecuador', `Pedido Ecuador (${farm})`) } }
            : sheet;
          const targetName = farm && partition.scope.country === 'Ecuador'
            ? `${++index}_${name.replace(/^Ecuador\b/, farm)}`.slice(0, 31)
            : `${++index}_${name}`.slice(0, 31);
          XLSX.utils.book_append_sheet(workbook, sheetCopy, targetName);
        }
      }
      workbook.Workbook = { CalcPr: { calcMode: 'auto', fullCalcOnLoad: true } };
      const totals = {};
      for (const row of partition.rows) totals[row.unit] = (totals[row.unit] ?? 0) + row.total;
      const mixed = Object.keys(totals).length > 1;
      const fileStem = farm || partition.scope.country;
      const totalBoxes = partition.scope.country === 'Ecuador'
        ? legacy.reduce((sum, output) => sum + (output.totalBoxes ?? 0), 0)
        : undefined;
      return [{
        ...legacy[0],
        workbook,
        filename: `${partition.scope.orderWeek}_${fileStem}.xlsx`,
        itemCount: partition.rows.length,
        totalQuantity: mixed ? Object.entries(totals).map(([unit, value]) => `${value.toLocaleString('ko-KR')} ${importUnitLabel(unit)}`).join(' · ') : Object.values(totals)[0] ?? 0,
        totalQuantityByUnit: totals,
        ...(totalBoxes != null ? { totalBoxes } : {}),
        unit: mixed ? '' : partition.rows[0]?.unit ?? '',
        warnings: [...new Set(legacy.flatMap(output => output.warnings))],
        preview: {
          headers: ['품목', '단위', ...partition.customers.map(customer => customer.label)],
          rows: partition.rows.map(row => [countryOrderShortName(row), importUnitLabel(row.unit), ...partition.customers.map(customer => row.quantities[customer.key] ?? 0)]),
        },
      }];
    }
    return legacy.map(output => {
      const rows = partition.rows.filter(row => {
        if (partition.scope.country === 'Colombia') return row.flower === output.category;
        if (partition.scope.country === 'Netherlands') return row.name.toLowerCase().startsWith('[ez]') === /_EZ\.xlsx$/i.test(output.filename);
        return true;
      });
      const subset = { ...partition, rows };
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, matrixSheet(subset, farm), '업체별 발주');
      let index = 0;
      for (const name of output.workbook.SheetNames) {
        XLSX.utils.book_append_sheet(workbook, output.workbook.Sheets[name], `${++index}_${name}`.slice(0, 31));
      }
      workbook.Workbook = { CalcPr: { calcMode: 'auto', fullCalcOnLoad: true } };
      return { ...output, workbook, filename: farm ? output.filename.replace(`${partition.scope.orderWeek}_Melody`, `${partition.scope.orderWeek}_${farm}`) : output.filename, preview: { headers: ['품목', '단위', ...partition.customers.map(customer => customer.label)], rows: rows.map(row => [countryOrderShortName(row), importUnitLabel(row.unit), ...partition.customers.map(customer => row.quantities[customer.key] ?? 0)]) } };
    });
  });
}
