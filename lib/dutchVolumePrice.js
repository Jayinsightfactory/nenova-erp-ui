const DUTCH_TOKEN = /네덜란드|netherlands|holland|dutch/i;
const valueOf = cell => String(cell?.v ?? '').trim();
const rangeOf = (XLSX, sheet) => sheet?.['!ref'] ? XLSX.utils.decode_range(sheet['!ref']) : null;

export function isDutchPivotSheet(XLSX, sheetName, sheet) {
  if (DUTCH_TOKEN.test(String(sheetName || ''))) return true;
  const range = rangeOf(XLSX, sheet);
  if (!range) return false;
  for (let row = range.s.r; row <= Math.min(range.e.r, 2); row += 1) {
    for (let col = range.s.c; col <= Math.min(range.e.c, 4); col += 1) {
      if (DUTCH_TOKEN.test(valueOf(sheet[XLSX.utils.encode_cell({ r: row, c: col })]))) return true;
    }
  }
  return false;
}

export function parseDutchPivotWorkbook(XLSX, workbook) {
  const entries = [];
  const sheets = [];
  for (const sheetName of workbook?.SheetNames || []) {
    if (sheetName === '_keymap') continue;
    const sheet = workbook.Sheets[sheetName];
    if (!isDutchPivotSheet(XLSX, sheetName, sheet)) continue;
    const range = rangeOf(XLSX, sheet);
    if (!range || range.e.r < 3) continue;
    sheets.push(sheetName);
    let summaryStart = range.e.c + 1;
    for (let col = 1; col <= range.e.c; col += 1) {
      if (valueOf(sheet[XLSX.utils.encode_cell({ r: 2, c: col })]) === '주문') { summaryStart = col; break; }
    }
    for (let row = 3; row <= range.e.r; row += 1) {
      const product = valueOf(sheet[XLSX.utils.encode_cell({ r: row, c: 0 })]);
      if (!product || product === '합계') continue;
      const color = valueOf(sheet[XLSX.utils.encode_cell({ r: row, c: 1 })]);
      for (let col = 1; col < summaryStart; col += 1) {
        const customer = valueOf(sheet[XLSX.utils.encode_cell({ r: 2, c: col })]);
        if (!customer || customer === '칼라') continue;
        const cellAddress = XLSX.utils.encode_cell({ r: row, c: col });
        const quantity = Number(sheet[cellAddress]?.v);
        if (!(Number.isFinite(quantity) && quantity > 0)) continue;
        entries.push({ id: `${sheetName}!${cellAddress}`, sheetName, cellAddress, product, color, customer, quantity });
      }
    }
  }
  if (!sheets.length) throw new Error('네덜란드 Pivot 시트를 찾지 못했습니다. Pivot 통계에서 내려받은 네덜란드 물량표인지 확인해 주세요.');
  if (!entries.length) throw new Error('네덜란드 시트에서 업체별 수량을 찾지 못했습니다. 수량이 입력된 원본 양식을 확인해 주세요.');
  return { sheets, entries };
}

export function priceProgress(entries, prices) {
  const completed = (entries || []).filter(entry => Number(prices?.[entry.id]) > 0).length;
  return { completed, total: (entries || []).length, pending: (entries || []).length - completed };
}

export function buildDutchPriceRows(entries, prices, currency = 'EUR') {
  return (entries || []).map(entry => {
    const unitPrice = Number(prices?.[entry.id] || 0);
    return { ...entry, currency, unitPrice, amount: Math.round(entry.quantity * unitPrice * 100) / 100, complete: unitPrice > 0 };
  });
}

export function appendDutchPriceSheet(XLSX, workbook, entries, prices, currency = 'EUR') {
  const rows = buildDutchPriceRows(entries, prices, currency);
  const aoa = [
    ['네덜란드 물량표 단가 입력 결과'],
    ['원본 시트', '원본 셀', '업체', '품목', '칼라', '수량', '통화', '단가', '금액', '입력 상태'],
    ...rows.map(row => [row.sheetName, row.cellAddress, row.customer, row.product, row.color, row.quantity, row.currency, row.unitPrice || '', row.complete ? row.amount : '', row.complete ? '입력 완료' : '단가 미입력']),
  ];
  const sheet = XLSX.utils.aoa_to_sheet(aoa);
  sheet['!cols'] = [{ wch: 18 }, { wch: 10 }, { wch: 22 }, { wch: 38 }, { wch: 12 }, { wch: 10 }, { wch: 8 }, { wch: 12 }, { wch: 14 }, { wch: 12 }];
  const name = 'NL_단가표';
  if (workbook.SheetNames.includes(name)) workbook.Sheets[name] = sheet;
  else XLSX.utils.book_append_sheet(workbook, sheet, name);
  return { workbook, rows };
}
