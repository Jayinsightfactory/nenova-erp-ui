import { projectDutchInlineCustomers } from './dutchInlineCustomer.js';
import { addDutchPriceColumns, dutchPriceKey, parseDutchPivotWorkbook, normalizeDutchBulkPriceConfig } from './dutchVolumePrice.js';
import { addDutchPriceShapesToXlsx } from './dutchPriceShapes.js';
import { dutchDataStart, dutchCustomerHeader, splitDutchClientRows } from './dutchMatrixLayout.js';
import { buildDutchQuantitySummaryValues } from './dutchSheetQuantityEdit.js';

export const DUTCH_TRANSFER_SHEET = 'ERP적용초안';
const VERSION = 'NENOVA_DUTCH_MATRIX_V1';
const value = (sheet, XLSX, r, c) => String(sheet?.[XLSX.utils.encode_cell({ r, c })]?.v ?? '').trim();
const key = (name, address) => `${name}!${address}`;
const fail = message => { throw new Error(`물량표 재업로드: ${message}`); };
const number = (v, label) => {
  if (v === '' || v == null || !['string', 'number'].includes(typeof v) || !Number.isFinite(Number(v)) || Number(v) < 0 || Number(v) > 1e9) fail(`${label} 값이 올바르지 않습니다.`);
  return Number(v);
};
const optionalKey = v => v === '' || v == null ? undefined : (() => {
  const n = number(v, '매칭키'); if (!Number.isSafeInteger(n) || n <= 0) fail('매칭키를 다시 선택하세요.'); return n;
})();

// Remap A1 references, retaining absolute markers and quoted sheet names.
// String literals are not references. No eval or formula execution is used.
function shiftFormula(formula, sheetName, maps, XLSX) {
  return formula.split(/("(?:[^"]|"")*")/g).map((part, i) => i % 2 ? part : part.replace(
    /(?<![\w.])(?:('[^']*(?:''[^']*)*'|[\p{L}\w]+)!)?(\$?[A-Z]{1,3}\$?\d+)(?::(\$?[A-Z]{1,3}\$?\d+))?(?![\w(])/gu,
    (all, qualifier, first, last) => {
      const target = qualifier ? qualifier.replace(/^'|'$/g, '').replace(/''/g, "'") : sheetName;
      const shift = address => address.replace(/^(\$?)([A-Z]+)(\$?\d+)$/, (ref, absolute, letters, row) => {
        const c = maps.get(target)?.get(XLSX.utils.decode_col(letters));
        return c == null ? ref : `${absolute}${XLSX.utils.encode_col(c)}${row}`;
      });
      if (last && maps.has(target)) {
        const a=XLSX.utils.decode_cell(first.replace(/\$/g,'')), b=XLSX.utils.decode_cell(last.replace(/\$/g,''));
        const mapped=Array.from({length:b.c-a.c+1},(_,i)=>maps.get(target).get(a.c+i)??a.c+i);
        const low=Math.min(...mapped), high=Math.max(...mapped);
        // Inserted columns belong inside a range; unrelated moved columns do not.
        const outsiders=[...maps.get(target)].some(([old,col])=>(old<a.c||old>b.c)&&col>=low&&col<=high);
        if(outsiders)fail('지역 변경으로 기존 수식의 연속 범위가 나뉩니다. 해당 수식 범위를 확인한 뒤 다운로드하세요.');
        const withColumn=(address,c)=>address.replace(/^(\$?)[A-Z]+/,(_m,abs)=>`${abs}${XLSX.utils.encode_col(c)}`);
        return `${qualifier?`${qualifier}!`:''}${withColumn(first,low)}:${withColumn(last,high)}`;
      }
      return `${qualifier ? `${qualifier}!` : ''}${shift(first)}${last ? `:${shift(last)}` : ''}`;
    })).join('');
}

export function prepareDutchVolumeWorkbook(XLSX, workbook, entries, prices, bulkConfig, scope, matches = {}) {
  if (!/^\d{4}$/.test(String(scope?.year)) || !/^\d{2}-\d{2}$/.test(String(scope?.week))) fail('연도·차수를 선택하세요.');
  if (entries.some(row => row.added && (!row.sheetName || !Number.isInteger(row.sourceRow) || typeof row.customerArea !== 'string'))) {
    fail('원본 위치가 없는 과거 추가행이 있습니다. 원본 물량표에서 업체를 다시 추가한 뒤 내려받으세요.');
  }
  const projection = projectDutchInlineCustomers(XLSX, workbook, entries);
  const copy = { ...projection.workbook, SheetNames: [...projection.workbook.SheetNames], Sheets: {} };
  const maps = new Map();
  for (const name of copy.SheetNames) {
    const sheet = projection.workbook.Sheets[name];
    const map = new Map();
    if (sheet?.['!ref']) for (let c = 0; c <= XLSX.utils.decode_range(sheet['!ref']).e.c; c++) {
      const original = projection.originalAddress(name, XLSX.utils.encode_cell({ r: 0, c }));
      if (original) map.set(XLSX.utils.decode_cell(original).c, c);
    }
    maps.set(name, map);
    copy.Sheets[name] = structuredClone(sheet);
    const original = workbook.Sheets[name];
    if (original?.['!cols']) copy.Sheets[name]['!cols'] = Array.from({ length: XLSX.utils.decode_range(sheet['!ref']).e.c + 1 }, (_, c) => {
      const address = projection.originalAddress(name, XLSX.utils.encode_cell({ r: 0, c }));
      return address ? { ...original['!cols'][XLSX.utils.decode_cell(address).c] } : { wch: 10 };
    });
    if (original?.['!rows']) copy.Sheets[name]['!rows'] = structuredClone(original['!rows']);
  }
  for (const name of copy.SheetNames) for (const cell of Object.values(copy.Sheets[name])) {
    if (cell && typeof cell.f === 'string') cell.f = shiftFormula(cell.f, name, maps, XLSX);
  }
  const nextPrices = {}, metadata = [];
  const config = normalizeDutchBulkPriceConfig(bulkConfig, entries);
  const outputEntries = projection.entries.map(entry => {
    const source = entries.find(row => row.id === entry.id);
    const sheet = copy.Sheets[entry.sheetName];
    if (!sheet || !entry.cellAddress || entry.added) fail('원본 위치가 없는 항목을 확인하세요.');
    const quantity = number(entry.quantity, '수량');
    const match = matches[entry.id];
    const custKey = source.custKey || source.sourceCustKey || (match?.status === 'matched' ? match.custKey : undefined);
    const prodKey = source.prodKey || (match?.status === 'matched' ? match.prodKey : undefined);
    const output = { ...entry, id: key(entry.sheetName, entry.cellAddress), custKey, prodKey };
    const price = prices?.[dutchPriceKey(source, config)];
    if (price !== '' && price != null) {
      const p = number(price, '단가'), priceKey = dutchPriceKey(output, config);
      if (nextPrices[priceKey] != null && nextPrices[priceKey] !== p) fail('같은 품목의 일괄단가가 다릅니다. 일괄업체 설정을 확인하세요.');
      nextPrices[priceKey] = p;
    }
    sheet[entry.cellAddress] = { ...sheet[entry.cellAddress], t: 'n', v: quantity };
    delete sheet[entry.cellAddress].f; delete sheet[entry.cellAddress].w;
    metadata.push([entry.sheetName, entry.cellAddress,
      dutchCustomerHeader(XLSX, sheet, entry.sourceColumn), value(sheet, XLSX, entry.sourceRow, 0), value(sheet, XLSX, entry.sourceRow, 1),
      entry.layoutVersion === 3 ? value(sheet, XLSX, entry.sourceRow, 2) : '', custKey || '', prodKey || '', entry.unit || '',
      price === '' || price == null ? '' : number(price, '단가'), entry.product || '', entry.customer || '']);
    return output;
  });
  // Both cached totals and live Excel formulas refer to the visible customer cells.
  for (const name of new Set(outputEntries.map(row => row.sheetName))) {
    const sheet = copy.Sheets[name], range = XLSX.utils.decode_range(sheet['!ref']);
    const start = /^(칼라|컬러|색상)$/.test(value(sheet, XLSX, 2, 2)) ? 3 : 2;
    const order = Array.from({ length: range.e.c + 1 }, (_, c) => c).find(c => value(sheet, XLSX, 2, c) === '주문');
    if (order == null || order < start) fail(`${name}: 주문 합계 열을 확인하세요.`);
    const columns = Array.from({ length: order - start }, (_, n) => n + start).filter(c => !['', '품목명', '품목', '칼라'].includes(value(sheet, XLSX, 2, c)));
    let previousTotal = dutchDataStart(sheet) - 1;
    const put = (r, c, refs) => {
      const address = XLSX.utils.encode_cell({ r, c });
      const v = refs.reduce((sum, ref) => sum + (Number(sheet[ref]?.v) || 0), 0);
      sheet[address] = { ...sheet[address], t: 'n', v, f: refs.length ? `SUM(${refs.join(',')})` : '0' }; delete sheet[address].w;
    };
    for (let r = dutchDataStart(sheet); r <= range.e.r; r++) {
      const total = [0, 1].some(c => value(sheet, XLSX, r, c) === '합계');
      if (total) {
        for (const c of [...columns, order]) put(r, c, Array.from({ length: r - previousTotal - 1 }, (_, i) => XLSX.utils.encode_cell({ r: previousTotal + 1 + i, c })));
        previousTotal = r;
      } else if (value(sheet, XLSX, r, 0)) put(r, order, columns.map(c => XLSX.utils.encode_cell({ r, c })));
    }
  }
    for (const name of new Set(outputEntries.map(row => row.sheetName))) {
      const sheet = copy.Sheets[name];
      for (const [address, quantity] of buildDutchQuantitySummaryValues(XLSX, sheet, name, outputEntries)) {
        sheet[address] = { ...sheet[address], t: 'n', v: quantity };
        delete sheet[address].w;
      }
    }
    const splitSheets = splitDutchClientRows(XLSX, copy, outputEntries);
  for(const row of metadata) if(splitSheets.has(row[0])) {const pos=XLSX.utils.decode_cell(row[1]);row[1]=XLSX.utils.encode_cell({...pos,r:pos.r+1});}
  if (!copy.SheetNames.includes(DUTCH_TRANSFER_SHEET)) copy.SheetNames.push(DUTCH_TRANSFER_SHEET);
  copy.Sheets[DUTCH_TRANSFER_SHEET] = XLSX.utils.aoa_to_sheet([
    [VERSION, Number(scope.year), scope.week, 'KRW', JSON.stringify(config)],
    ['시트', '수량 셀', '원본 업체', '품종', '품목명', '칼라', '업체키', '품목키', '입력 단위', 'KRW 입력값(빈칸=보존)', '매칭 품목', '매칭 업체'],
    ...metadata,
  ]);
  return { workbook: copy, entries: outputEntries, prices: nextPrices, bulkPriceConfig: config };
}

export async function exportDutchVolumeWorkbook(XLSX, ...args) {
  const prepared = prepareDutchVolumeWorkbook(XLSX, ...args);
  const priced = addDutchPriceColumns(XLSX, prepared.workbook, prepared.entries, prepared.prices, 'KRW', prepared.bulkPriceConfig);
  const base = XLSX.write(priced.workbook, { type: 'array', bookType: 'xlsx', compression: true });
  return addDutchPriceShapesToXlsx(XLSX, base, priced.workbook, prepared.entries, prepared.prices, prepared.bulkPriceConfig);
}

export function importDutchVolumeWorkbook(XLSX, workbook, scope) {
  const sheet = workbook?.Sheets?.[DUTCH_TRANSFER_SHEET];
  if (!sheet) return { ...parseDutchPivotWorkbook(XLSX, workbook, {allowEmpty:true}), roundtrip: false };
  if (sheet.A1?.v !== VERSION) fail('이전 형식의 ERP적용초안은 추가 업체를 복원할 수 없습니다. 저장 작업을 불러와 새 물량표로 다운로드하세요.');
  if (String(sheet.B1?.v) !== String(scope?.year) || String(sheet.C1?.v) !== String(scope?.week)) fail(`파일 차수 ${sheet.B1?.v}/${sheet.C1?.v}와 선택 차수가 다릅니다. 파일과 같은 연도·차수를 선택하세요.`);
  if (sheet.D1?.v !== 'KRW') fail('단가 통화를 확인하세요.');
  const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1');
  if (range.e.r > 5001 || range.e.c > 11) fail('연결 정보의 크기가 올바르지 않습니다.');
  let config;
  try { config = JSON.parse(sheet.E1?.v); } catch { fail('일괄단가 설정을 읽지 못했습니다.'); }
  if (config?.version !== 1 || typeof config.enabled !== 'boolean' || !Array.isArray(config.excludedCustomers)) fail('일괄단가 설정 형식이 올바르지 않습니다.');
  const parsed = parseDutchPivotWorkbook(XLSX, workbook, { includeZero: true, allowEmpty:true });
  const byId = new Map(parsed.entries.map(entry => [entry.id, entry])), seen = new Set(), prices = {};
  for (let r = 2; r <= range.e.r; r++) {
    const cells = Array.from({ length: 12 }, (_, c) => sheet[XLSX.utils.encode_cell({ r, c })]?.v ?? '');
    const [name, address, customer, flower, item, color, ck, pk, unit, price, product, matchedCustomer] = cells;
    if (!name && !address) continue;
    const id = key(name, address);
    if (seen.has(id)) fail('중복 연결 정보가 있습니다.'); seen.add(id);
    if (!workbook.SheetNames.includes(name)) continue; // Removed visible sheets never expand the apply scope.
    const entry = byId.get(id);
    if (!entry) fail(`${name}!${address} 수량 셀이 삭제되거나 비어 있습니다. 0으로 취소하거나 연결 정보를 다시 확인하세요.`);
    if ([entry.sourceCustomer, entry.sourceFlower, entry.sourceItem, entry.sourceColor].some((v, i) => String(v || '') !== String([customer, flower, item, color][i] || ''))) fail(`${id} 업체·품목 위치가 변경됐습니다. 원본에서 다시 매칭하세요.`);
    Object.assign(entry, { custKey: optionalKey(ck), prodKey: optionalKey(pk), unit: String(unit || ''), product: String(product || entry.product), customer: String(matchedCustomer || entry.customer) });
    if (price !== '') {
      const p = number(price, '단가'), priceKey = dutchPriceKey(entry, config);
      if (prices[priceKey] != null && prices[priceKey] !== p) fail('일괄단가 연결 값이 서로 다릅니다.'); prices[priceKey] = p;
    }
  }
  // Unedited zero placeholders are not new entries. Explicit edited zeros have
  // metadata and remain cancellations; newly filled positive cells still parse.
  return { ...parsed, entries: parsed.entries.filter(entry => entry.quantity > 0 || seen.has(entry.id)), prices, bulkPriceConfig: config, roundtrip: true };
}
