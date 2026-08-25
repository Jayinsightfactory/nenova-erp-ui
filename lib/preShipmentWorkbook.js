const clean = value => String(value ?? '').replace(/\s+/g, '').trim();
const text = value => String(value ?? '').replace(/\s+/g, ' ').trim();
const qty = value => {
  if (value == null || value === '') return 0;
  const number = Number(String(value).replace(/,/g, '').trim());
  return Number.isFinite(number) ? number : 0;
};

export function selectPreShipmentSheetName(sheetNames = []) {
  const candidates = sheetNames.map(name => {
    const match = clean(name).match(/^주광카장수알(\d{1,2})차$/);
    if (match) return { name, major: Number(match[1]) };
    return clean(name) === '주광카장수알' ? { name, major: null } : null;
  }).filter(Boolean).sort((a, b) => Number(b.major || 0) - Number(a.major || 0));
  if (!candidates.length) throw new Error('`주광 카장수알` 또는 `주광 카장수알 숫자차` 형식의 원본 시트를 찾지 못했습니다. `(2)` 사본과 고정 수량 시트는 사용하지 않습니다.');
  return candidates[0];
}

export function parsePreShipmentWorkbook(XLSX, workbook) {
  const selected = selectPreShipmentSheetName(workbook.SheetNames || []);
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[selected.name], { header: 1, raw: true, defval: null });
  const items = [];
  let species = '';
  let header = null;
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index] || [];
    const colA = text(row[0]);
    const colB = text(row[1]);
    if (clean(colB) === '색상') {
      if (colA) species = text(colA);
      header = {
        preLabel: text(row[2]) || '선출고',
        orderLabel: text(row[3]) || '발주수량',
        unitLabel: text(row[4]),
        extraLabel: text(row[6]) || '추가 출고',
      };
      continue;
    }
    if (colA && !/^합\s*계$/i.test(colA)) species = colA;
    if (!header || !colB || /^합\s*계$/i.test(colB)) continue;
    const orderBoxQty = qty(row[3]);
    const isRose = clean(species).includes('장미');
    items.push({
      speciesName: species || '기타', itemName: colB,
      orderBoxQty,
      orderUnitQty: isRose ? qty(row[4]) : 0,
      busanWilsonQty: isRose ? 0 : qty(row[4]),
      memo: text(row[5]), sortOrder: items.length + 1,
      importedAllocations: [
        { source: 'PRE', label: header.preLabel, quantity: qty(row[2]) },
        { source: 'EXTRA', label: header.extraLabel, quantity: qty(row[6]) },
      ],
    });
  }
  if (!items.length) throw new Error(`${selected.name} 시트에서 품목 행을 찾지 못했습니다.`);
  const title = text(rows[0]?.[0]);
  const dateMatch = title.match(/(20\d{2})년\s*(\d{1,2})월\s*(\d{1,2})일/);
  const baseDate = dateMatch ? `${dateMatch[1]}-${String(dateMatch[2]).padStart(2, '0')}-${String(dateMatch[3]).padStart(2, '0')}` : null;
  return { sheetName: selected.name, sheetMajor: selected.major, baseDate, items };
}

export function normalizePreShipmentScope(orderYear, majorWeek) {
  const year = String(orderYear || '').trim();
  const week = Number(majorWeek);
  if (!/^20\d{2}$/.test(year)) throw new Error('연도는 YYYY 형식이어야 합니다.');
  if (!Number.isInteger(week) || week < 1 || week > 53) throw new Error('차수는 1~53 사이여야 합니다.');
  return { orderYear: year, majorWeek: week };
}
