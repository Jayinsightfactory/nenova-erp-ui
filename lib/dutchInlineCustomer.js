import { matchDutchCustomer } from './dutchVolumeCustomerMatch.js';
// Display-only projection. Original workbook coordinates/formulas remain intact.
const text = (XLSX, sheet, r, c) => String(sheet?.[XLSX.utils.encode_cell({ r, c })]?.v ?? '').trim();
export const isInlineCustomerEntry = row => row.added && row.sheetName && Number.isInteger(row.sourceRow) && typeof row.customerArea === 'string';

export function addDutchInlineCustomer(XLSX, workbook, entries, sheetName, customer, matches = {}, customerOptions = []) {
  const sheet = workbook?.Sheets?.[sheetName];
  const custKey = Number(customer?.custKey ?? customer?.CustKey);
  const name = String(customer?.custName ?? customer?.CustName ?? '').trim();
  if (!sheet?.['!ref'] || !Number.isSafeInteger(custKey) || custKey <= 0 || !name) throw new Error('물량표와 유효한 업체를 먼저 선택하세요.');
  const label = [name, String(customer.orderCode || '').trim()].filter(Boolean).join('\n');
  const sameSheet = entries.filter(row => row.sheetName === sheetName);
  const masters=customerOptions.map(row=>({CustKey:row.custKey,CustName:row.custName,OrderCode:row.orderCode}));
  const existing = sameSheet.find(row => Number(row.custKey || row.sourceCustKey || matchDutchCustomer(masters,row.sourceCustomer || row.customer)?.CustKey || matches[row.id]?.custKey) === custKey || row.sourceCustomer === label);
  if (existing) return { entries, focusId: existing.id, duplicate: true };
  const range = XLSX.utils.decode_range(sheet['!ref']);
  const layoutVersion = text(XLSX, sheet, 2, 2) === '칼라' ? 3 : 2;
  const added = [];
  for (let r = 3; r <= range.e.r; r++) {
    const flower = text(XLSX, sheet, r, 0), item = text(XLSX, sheet, r, 1);
    if (!flower || !item || flower === '합계' || item === '합계') continue;
    const template = sameSheet.find(row => row.sourceRow === r);
    const prodKey = Number(template?.prodKey || matches[template?.id]?.prodKey);
    added.push({ id: `inline:${sheetName}:${r}:${custKey}`, added: true, sheetName, sourceRow: r,
      product: template?.product || flower, color: template?.color || item,
      sourceFlower: flower, sourceItem: item, sourceColor: layoutVersion === 3 ? text(XLSX, sheet, r, 2) : '',
      customer: name, sourceCustomer: label, customerArea: String(customer.area || '기타'),
      custKey, ...(prodKey > 0 ? { prodKey } : {}), quantity: 0, unit: template?.unit || '', layoutVersion,
    });
  }
  if (!added.length) throw new Error('추가할 원본 품목 행이 없습니다. 먼저 물량표를 불러오세요.');
  return { entries: [...entries, ...added], focusId: added[0].id, duplicate: false };
}

export function projectDutchInlineCustomers(XLSX, workbook, entries) {
  if (!workbook || !entries.some(isInlineCustomerEntry)) return { workbook, entries, originalAddress: (_name, address) => address };
  const next = { ...workbook, Sheets: { ...workbook.Sheets } }, projected = [], addressMaps = new Map();
  for (const name of workbook.SheetNames) {
    const source = workbook.Sheets[name], inline = entries.filter(row => row.sheetName === name && isInlineCustomerEntry(row));
    if (!inline.length || !source?.['!ref']) { projected.push(...entries.filter(row => row.sheetName === name)); continue; }
    const range = XLSX.utils.decode_range(source['!ref']), columns = [], customers = new Map();
    for (const row of inline) if (!customers.has(row.custKey)) customers.set(row.custKey, row);
    let summary = range.e.c + 1, area = '';
    const starts = inline[0].layoutVersion === 3 ? 3 : 2, regions = new Map();
    for (let c = starts; c <= range.e.c; c++) {
      const header = text(XLSX, source, 2, c);
      if (header === '주문') { summary = c; break; }
      if (['품목명','품목','칼라',''].includes(header)) continue;
      area = text(XLSX, source, 0, c) || area;
      if (area) regions.set(area, c + 1);
    }
    const insertions = new Map();
    for (const row of customers.values()) {
      const at = regions.get(row.customerArea) ?? summary;
      if (!insertions.has(at)) insertions.set(at, []);
      insertions.get(at).push(row);
    }
    for (let c = 0; c <= range.e.c + 1; c++) {
      for (const row of insertions.get(c) || []) columns.push({ customer: row });
      if (c <= range.e.c) columns.push({ original: c });
    }
    const forward = new Map(), reverse = new Map(), customerColumn = new Map(), target = {};
    columns.forEach((column, c) => {
      if (column.customer) {
        const row = column.customer; customerColumn.set(row.custKey, c);
        [row.customerArea, '', row.sourceCustomer].forEach((v, r) => { target[XLSX.utils.encode_cell({ r, c })] = { t:'s', v }; });
      } else { forward.set(column.original, c); reverse.set(c, column.original); }
    });
    for (const [address, cell] of Object.entries(source)) {
      if (address.startsWith('!')) continue;
      const pos = XLSX.utils.decode_cell(address);
      target[XLSX.utils.encode_cell({r:pos.r,c:forward.get(pos.c)})] = cell;
    }
    target['!ref'] = XLSX.utils.encode_range({s:range.s,e:{r:range.e.r,c:columns.length-1}});
    target['!merges'] = (source['!merges'] || []).map(m => ({s:{r:m.s.r,c:forward.get(m.s.c)},e:{r:m.e.r,c:forward.get(m.e.c)}}));
    // Region merges must not hide the inserted customer's own label.
    target['!merges'] = target['!merges'].filter(m => ![...customerColumn.values()].some(c => c >= m.s.c && c <= m.e.c));
    next.Sheets[name] = target; addressMaps.set(name, reverse);
    for (const row of entries.filter(row => row.sheetName === name)) {
      if (isInlineCustomerEntry(row)) {
        const c = customerColumn.get(row.custKey), address = XLSX.utils.encode_cell({r:row.sourceRow,c});
        projected.push({...row,added:false,sourceColumn:c,cellAddress:address});
      } else if (!row.added && Number.isInteger(row.sourceColumn)) {
        const c = forward.get(row.sourceColumn);
        projected.push({...row,sourceColumn:c,cellAddress:XLSX.utils.encode_cell({r:row.sourceRow,c})});
      } else projected.push(row);
    }
  }
  projected.push(...entries.filter(row => !workbook.SheetNames.includes(row.sheetName)));
  return { workbook:next, entries:projected, originalAddress(name,address) {
    if (!addressMaps.has(name)) return address;
    const pos=XLSX.utils.decode_cell(address), c=addressMaps.get(name).get(pos.c);
    return c === undefined ? null : XLSX.utils.encode_cell({r:pos.r,c});
  }};
}
