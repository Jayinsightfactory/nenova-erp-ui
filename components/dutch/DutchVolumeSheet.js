import { useEffect, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx-js-style';
import { buildDutchQuantitySummaryValues, createDutchBlankCellEntry, normalizeDutchQuantityHistory, parseDutchSheetQuantity } from '../../lib/dutchSheetQuantityEdit';
import { dutchUniformPricePeerKeys, snapshotDutchPriceDraft } from '../../lib/dutchVolumePrice';
import { dutchDataStart } from '../../lib/dutchMatrixLayout';
import { isDutchPivotSheet } from '../../lib/dutchVolumePrice';
import { projectDutchInlineCustomers } from '../../lib/dutchInlineCustomer';

const formatQty = value => Number(value).toLocaleString('ko-KR', { maximumFractionDigits: 4 });
const hasPrice = value => value !== undefined && value !== null && String(value) !== '';

export default function DutchVolumeSheet(props) {
  const projection = useMemo(() => projectDutchInlineCustomers(XLSX, props.workbook, props.entries || []), [props.workbook, props.entries]);
  return <DutchVolumeMatrix {...props} workbook={projection.workbook} entries={projection.entries}
    onRegionChange={(entry,area) => props.onRegionChange?.((props.entries || []).find(row=>row.id===entry.id)||entry,area)}
    onMatch={(entry,kind) => props.onMatch?.((props.entries || []).find(row => row.id === entry.id) || entry,kind)}
    onDayChange={(name,address,value) => { const original=projection.originalAddress(name,address); if(original) props.onDayChange?.(name,original,value); }}
    onQuantityChange={(id,quantity,newEntry) => {
      if (!newEntry) return props.onQuantityChange?.(id,quantity);
      const address=projection.originalAddress(newEntry.sheetName,newEntry.cellAddress);
      if (!address) {
        const column=projection.entries.find(row => row.sheetName===newEntry.sheetName && row.sourceColumn===newEntry.sourceColumn && row.customerArea !== undefined);
        if (!column) return;
        const inline={...newEntry,id:`inline:${newEntry.sheetName}:${newEntry.sourceRow}:${column.custKey}`,added:true,customer:column.customer,sourceCustomer:column.sourceCustomer,custKey:column.custKey,customerArea:column.customerArea};
        delete inline.cellAddress; delete inline.sourceColumn;
        return props.onQuantityChange?.(inline.id,quantity,inline);
      }
      const original={...newEntry,id:`${newEntry.sheetName}!${address}`,cellAddress:address,sourceColumn:XLSX.utils.decode_cell(address).c};
      props.onQuantityChange?.(original.id,quantity,original);
    }}/>
}

function DutchVolumeMatrix({ regions = [], onRegionChange = () => {}, workbook, entries = [], prices = {}, priceKey, matchCache = {}, validationCurrent = false, onMatch = () => {}, onQuantityChange = () => {}, onPriceChange = () => {}, onPriceRestore = () => {}, onDayChange = () => {}, onColorChange = () => {}, onSheetChange = () => {}, activeEntryId = '', disabled = false }) {
  const sheets = useMemo(() => (workbook?.SheetNames || []).filter(name=>isDutchPivotSheet(XLSX,name,workbook.Sheets[name])), [entries, workbook]);
  const [sheetName, setSheetName] = useState('');
  const scrollRef = useRef(null);
  const topScrollRef = useRef(null);
  const quantityInputRef = useRef(null);
  const priceInputRef = useRef(null);
  const dayInputRef = useRef(null);
  const sheetCellRefs = useRef(new Map());
  const quantityEditRef = useRef(null);
  const priceEditRef = useRef(null);
  const dayEditRef = useRef(null);
  const [quantityEdit, setQuantityEdit] = useState(null);
  const [priceEdit, setPriceEdit] = useState(null);
  const [dayEdit, setDayEdit] = useState(null);
  const [scrollMetrics, setScrollMetrics] = useState({ content: 0, viewport: 0 });
  useEffect(() => { if (!sheets.includes(sheetName)) setSheetName(sheets[0] || ''); }, [sheets, sheetName]);
  useEffect(() => { if(sheetName) onSheetChange(sheetName); }, [sheetName]);
  useEffect(() => {
    const viewport = scrollRef.current;
    const table = viewport?.querySelector('table');
    if (!viewport || !table) return undefined;
    const measure = () => setScrollMetrics({ content: table.scrollWidth, viewport: viewport.clientWidth });
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    observer.observe(table);
    return () => observer.disconnect();
  }, [sheetName, entries.length, workbook]);
  useEffect(() => {
    if (!activeEntryId || !scrollRef.current) return;
    const cell = [...scrollRef.current.querySelectorAll('[data-entry-id]')].find(item => item.dataset.entryId === activeEntryId);
    cell?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const frame=requestAnimationFrame(() => cell?.querySelector('button:not(:disabled)')?.focus());
    return () => cancelAnimationFrame(frame);
  }, [activeEntryId, sheetName]);
  useEffect(() => {
    if (!quantityEdit) return;
    quantityInputRef.current?.focus();
    quantityInputRef.current?.select();
  }, [quantityEdit?.entryId]);
  useEffect(() => {
    if (!priceEdit) return;
    priceInputRef.current?.focus();
    priceInputRef.current?.select();
  }, [priceEdit?.entryId]);
  useEffect(() => {
    if (!dayEdit) return;
    dayInputRef.current?.focus();
    dayInputRef.current?.select();
  }, [dayEdit?.key]);

  const beginDayEdit = (key, value) => {
    const next = { key, originalValue: String(value ?? ''), value: String(value ?? '') };
    dayEditRef.current = next;
    setDayEdit(next);
  };
  const changeDayEdit = value => {
    const current = dayEditRef.current;
    if (!current) return;
    const next = { ...current, value };
    dayEditRef.current = next;
    setDayEdit(next);
  };
  const finishDayEdit = commit => {
    const current = dayEditRef.current;
    if (!current) return;
    dayEditRef.current = null;
    setDayEdit(null);
    if (commit && current.value.trim() !== current.originalValue.trim()) onDayChange(sheetName, current.key, current.value);
  };

  const beginQuantityEdit = (entry, isNew = false) => {
    const next = { entryId: entry.id, newEntry: isNew ? entry : null, originalValue: isNew ? null : Number(entry.quantity), value: isNew ? '' : String(entry.quantity) };
    quantityEditRef.current = next;
    setQuantityEdit(next);
  };
  const finishQuantityEdit = (commit, keepInvalid = false) => {
    const current = quantityEditRef.current;
    if (!current) return;
    if (commit) {
      const parsed = parseDutchSheetQuantity(current.value);
      if (!parsed.ok) {
        if (keepInvalid) {
          quantityInputRef.current?.focus();
          return;
        }
      } else if (current.newEntry) {
        // A blank source cell is only added to the ERP draft for a positive quantity.
        // Explicit zero is equivalent to leaving that source cell empty.
        if (parsed.quantity > 0) onQuantityChange(current.entryId, parsed.quantity, current.newEntry);
      } else if (parsed.quantity !== current.originalValue) {
        onQuantityChange(current.entryId, parsed.quantity);
      }
    }
    quantityEditRef.current = null;
    setQuantityEdit(null);
  };
  const changeQuantityEdit = value => {
    const current = quantityEditRef.current;
    if (!current) return;
    const next = { ...current, value };
    quantityEditRef.current = next;
    setQuantityEdit(next);
  };
  const beginPriceEdit = entry => {
    const keys = dutchUniformPricePeerKeys(entries, entry);
    const next = { entryId: entry.id, originalValue: prices[priceKey(entry)] ?? '', snapshot: snapshotDutchPriceDraft(prices, keys) };
    priceEditRef.current = next;
    setPriceEdit(next);
  };
  const finishPriceEdit = (entry, commit) => {
    const current = priceEditRef.current;
    if (!current) return;
    priceEditRef.current = null;
    setPriceEdit(null);
    if (!commit) onPriceRestore(current.snapshot);
  };

  const sheet = workbook?.Sheets?.[sheetName];
  const range = sheet?.['!ref'] ? XLSX.utils.decode_range(sheet['!ref']) : null;
  let quantitySummaryStart = range ? range.e.c + 1 : 0;
  if (range) {
    for (let col = 1; col <= range.e.c; col += 1) {
      if (String(sheet[XLSX.utils.encode_cell({ r: 2, c: col })]?.v ?? '').trim() === '주문') { quantitySummaryStart = col; break; }
    }
  }
  const quantityMatrixScope = { range, summaryStart: quantitySummaryStart };
  const summaryValues = useMemo(() => buildDutchQuantitySummaryValues(XLSX, sheet, sheetName, entries, quantityMatrixScope), [sheet, sheetName, entries, quantitySummaryStart]);
  const tooLarge = range && (range.e.r - range.s.r + 1) * (range.e.c - range.s.c + 1) > 100000;
  const sourceEntries = useMemo(() => new Map(entries.filter(entry => !entry.added && entry.sheetName && entry.cellAddress).map(entry => [`${entry.sheetName}!${entry.cellAddress}`, entry])), [entries]);
  const sheetEntries = entries.filter(entry => !entry.added && entry.sheetName === sheetName);
  const layoutVersion = sheetEntries[0]?.layoutVersion || 3;
  const stickyCount = layoutVersion === 3 ? 3 : 2;
  const widths = [62, 152, 58];
  const repeatedProduct = column => column >= stickyCount && ['품목명','품목'].includes(String(sheet?.[XLSX.utils.encode_cell({r:2,c:column})]?.v || '').trim());
  const widthOf = column => column < stickyCount ? widths[column] : repeatedProduct(column) ? 132 : 42;
  const leftOf = column => widths.slice(0, column).reduce((sum, width) => sum + width, 0);
  const syncHorizontalScroll = (sourceRef, targetRef) => {
    const source = sourceRef.current;
    const target = targetRef.current;
    if (source && target && Math.abs(source.scrollLeft - target.scrollLeft) > 0.5) target.scrollLeft = source.scrollLeft;
  };
  const moveSheetFocus = (event, rowIndex, colIndex) => {
    if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    if (event.target instanceof HTMLInputElement && event.target.type !== 'button') return;
    event.preventDefault();
    const rowDelta = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
    const colDelta = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    let row = rowIndex + rowDelta;
    let col = colIndex + colDelta;
    const maxRow = range.e.r;
    const maxCol = range.e.c;
    while (row >= range.s.r && row <= maxRow && col >= range.s.c && col <= maxCol) {
      const target = sheetCellRefs.current.get(`${row}:${col}`);
      const control = target?.querySelector('button:not(:disabled),input:not(:disabled),select:not(:disabled)');
      if (control) { control.focus(); control.scrollIntoView({ block: 'nearest', inline: 'nearest' }); return; }
      row += rowDelta;
      col += colDelta;
    }
  };
  const covered = new Set();
  const merges = new Map();
  for (const merge of sheet?.['!merges'] || []) {
    if (tooLarge || !range || merge.s.r < range.s.r || merge.s.c < range.s.c || merge.e.r > range.e.r || merge.e.c > range.e.c) continue;
    merges.set(`${merge.s.r}:${merge.s.c}`, merge);
    for (let row = merge.s.r; row <= merge.e.r; row += 1) {
      for (let col = merge.s.c; col <= merge.e.c; col += 1) {
        if (row !== merge.s.r || col !== merge.s.c) covered.add(`${row}:${col}`);
      }
    }
  }

  if (!range || !sheetName) return <div className="sheet-empty">표시할 네덜란드 원본 시트가 없습니다.</div>;
  if (tooLarge) return <div role="alert">원본 시트가 너무 커서 한 번에 표시할 수 없습니다. 단가 수정·매칭 탭을 이용하거나 불필요한 끝 행·열을 정리해 주세요.</div>;
  return <section className="source-sheet" aria-label="원본 물량표 행렬">
    <div className="sheet-bar"><div><b>원본 물량표 · {sheetName}</b><span>업체별 수량 셀은 비어 있어도 클릭해 입력할 수 있습니다. 변경은 초안에 저장되며 ERP 반영 전 다시 검증해야 합니다.</span></div>{sheets.length > 1 && <select aria-label="원본 시트 선택" value={sheetName} onChange={event => setSheetName(event.target.value)}>{sheets.map(name => <option key={name} value={name}>{name}</option>)}</select>}</div>
    <div className="sheet-top-scroll" data-testid="dutch-volume-top-scroll" aria-label="원본 물량표 상단 가로 스크롤" role="region" tabIndex={0} hidden={scrollMetrics.content <= scrollMetrics.viewport} ref={topScrollRef} onScroll={() => syncHorizontalScroll(topScrollRef, scrollRef)}><div className="sheet-top-scroll-inner" style={{ width: `${scrollMetrics.content}px` }}/></div>
    <div className="sheet-scroll" ref={scrollRef} aria-label="원본 물량표 가로 세로 스크롤" tabIndex={0} onScroll={() => syncHorizontalScroll(scrollRef, topScrollRef)}><table><colgroup>{Array.from({ length: range.e.c - range.s.c + 1 }, (_, index) => <col key={index} style={{ width: widthOf(index + range.s.c) }}/>)}</colgroup><tbody>
      {Array.from({ length: range.e.r - range.s.r + 1 }, (_, rowOffset) => {
        const rowIndex = range.s.r + rowOffset;
        return <tr key={rowIndex}>{Array.from({ length: range.e.c - range.s.c + 1 }, (_, colOffset) => {
          const colIndex = range.s.c + colOffset;
          if (covered.has(`${rowIndex}:${colIndex}`)) return null;
          const merge = merges.get(`${rowIndex}:${colIndex}`);
          const address = XLSX.utils.encode_cell({ r: rowIndex, c: colIndex });
          const cell = sheet[address];
          const entry = sourceEntries.get(`${sheetName}!${address}`);
          const blankEntry = !entry && !disabled ? createDutchBlankCellEntry(XLSX, sheet, sheetName, rowIndex, colIndex, layoutVersion, quantityMatrixScope) : null;
          const quantityTarget = entry || blankEntry;
          const price = entry ? prices[priceKey(entry)] : undefined;
          const displayValue = summaryValues.has(address) ? summaryValues.get(address) : cell?.v;
          const raw = displayValue == null ? (cell?.f ? '수식 캐시 없음' : '') : typeof displayValue === 'number' ? formatQty(displayValue) : String(displayValue);
          const weekdayKey = `${sheetName}!${address}`;
          const weekdayEditable = rowIndex === 1 && colIndex >= stickyCount && colIndex < quantitySummaryStart && !repeatedProduct(colIndex) && !!String(sheet[XLSX.utils.encode_cell({ r: 2, c: colIndex })]?.v ?? '').trim() && !disabled && !cell?.f;
          const isEditingDay = weekdayEditable && dayEdit?.key === weekdayKey;
          const edited = entry && Number.isFinite(Number(entry.quantity)) && Number(entry.quantity) !== Number(cell?.v);
          const header = rowIndex === 2 || (dutchDataStart(sheet) === 4 && rowIndex === 3);
          const customerColumn = rowIndex === 2 && colIndex >= stickyCount && colIndex < quantitySummaryStart && !repeatedProduct(colIndex);
          const columnEntry = customerColumn ? sheetEntries.find(item => item.sourceColumn === colIndex) : null;
          const customerUnmatchedEntry = customerColumn && validationCurrent
            ? sheetEntries.find(item => item.sourceColumn === colIndex && matchCache[item.id]?.status === 'unmatched' && !matchCache[item.id]?.custKey)
            : null;
          const productUnmatchedEntry = validationCurrent && colIndex === 1 && rowIndex >= dutchDataStart(sheet)
            ? sheetEntries.find(item => item.sourceRow === rowIndex && matchCache[item.id]?.status === 'unmatched' && !matchCache[item.id]?.prodKey)
            : null;
          const customerLines = raw.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
          if (customerColumn && customerLines.length === 1) {
            const code = customerLines[0].match(/\s+(CL\d+)$/i);
            if (code) { customerLines[0] = customerLines[0].slice(0, code.index).trim(); customerLines.push(code[1]); }
          }
          const sticky = colIndex < stickyCount && (!merge || merge.e.c === merge.s.c);
          const style = { width: widthOf(colIndex), minWidth: widthOf(colIndex), maxWidth: widthOf(colIndex) };
          if (sticky) style.left = leftOf(colIndex);
          const quantityEditable = !!quantityTarget && colIndex >= stickyCount && !disabled;
          const isEditingQuantity = quantityEditable && quantityEdit?.entryId === quantityTarget.id;
          const quantityLabel = `${quantityTarget?.sourceFlower || quantityTarget?.product} ${quantityTarget?.sourceItem || quantityTarget?.color} ${quantityTarget?.sourceCustomer || quantityTarget?.customer} ${address} 수량`;
            return <td key={address} ref={node => { if (node) sheetCellRefs.current.set(`${rowIndex}:${colIndex}`, node); else sheetCellRefs.current.delete(`${rowIndex}:${colIndex}`); }} onKeyDown={event => moveSheetFocus(event, rowIndex, colIndex)} rowSpan={merge ? merge.e.r - merge.s.r + 1 : undefined} colSpan={merge ? merge.e.c - merge.s.c + 1 : undefined}
            className={`${header ? 'header-cell ' : ''}${sticky ? 'sticky-cell ' : ''}${quantityEditable ? 'editable-cell ' : ''}${activeEntryId === entry?.id ? 'active-cell ' : ''}${colIndex >= stickyCount ? 'quantity-cell' : ''}`}
            style={style} title={cell?.f ? `${address} · 수식: ${cell.f}` : address} data-entry-id={entry?.id}>
            {isEditingDay
              ? <input ref={dayInputRef} className="day-edit-input" type="text" value={dayEdit.value} aria-label={`${String(sheet[XLSX.utils.encode_cell({ r: 2, c: colIndex })]?.v ?? '').replace(/\n/g, ' ')} 요일`}
                  onChange={event => changeDayEdit(event.target.value)} onBlur={() => finishDayEdit(true)}
                  onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); finishDayEdit(true); } if (event.key === 'Escape') { event.preventDefault(); finishDayEdit(false); } }}/>
              : weekdayEditable
                ? <button type="button" className="weekday-edit-trigger" disabled={disabled} title="클릭해 요일 수정" aria-label={`${String(sheet[XLSX.utils.encode_cell({ r: 2, c: colIndex })]?.v ?? '').replace(/\n/g, ' ')} 요일 수정`} onClick={() => beginDayEdit(weekdayKey, cell?.v)}>{raw || '요일 입력'}</button>
                : isEditingQuantity
              ? <input ref={quantityInputRef} className="quantity-edit-input" type="number" min="0" step="any" value={quantityEdit.value} aria-label={quantityLabel}
                  onChange={event => changeQuantityEdit(event.target.value)}
                  onBlur={() => finishQuantityEdit(true)}
                  onKeyDown={event => {
                    if (event.key === 'Enter') { event.preventDefault(); finishQuantityEdit(true, true); }
                    if (event.key === 'Escape') { event.preventDefault(); finishQuantityEdit(false); }
                  }}/>
              : quantityEditable
                ? <><button type="button" className="quantity-edit-trigger" title={entry ? '클릭해 수량 변경' : '빈 셀을 클릭해 수량 입력'} aria-label={`${quantityLabel}, ${entry ? `현재 ${formatQty(entry.quantity)}${entry.unit ? ` ${entry.unit}` : ''}` : '수량 없음'}. 클릭해 ${entry ? '변경' : '입력'}`} onClick={() => beginQuantityEdit(quantityTarget, !entry)}>{entry ? formatQty(entry.quantity) : ''}</button>
                  {entry && normalizeDutchQuantityHistory(entry.quantityHistory).length > 0 && <button type="button" className="quantity-history-badge" title="수량 수정 이력 보기" aria-label={`수량 수정 이력 ${normalizeDutchQuantityHistory(entry.quantityHistory).length}건 보기`} onClick={event => { event.stopPropagation(); const history = normalizeDutchQuantityHistory(entry.quantityHistory); window.alert(history.map(item => `${item.from == null ? '빈 셀' : formatQty(item.from)} → ${formatQty(item.to)}${entry.unit ? ` ${entry.unit}` : ''} · ${new Date(item.changedAt).toLocaleString('ko-KR')}`).join('\n')); }}>이력 {normalizeDutchQuantityHistory(entry.quantityHistory).length}</button>}</>
                : customerColumn
                  ? <div className="customer-header-label"><span>{customerLines[0] || raw}</span>{columnEntry && <select aria-label={`${customerLines[0] || raw} 지역`} disabled={disabled} value={columnEntry.customerArea ?? (()=>{for(let c=colIndex;c>=stickyCount;c--){const v=sheet[XLSX.utils.encode_cell({r:0,c})]?.v;if(v)return String(v);}return "기타";})()} onChange={event=>onRegionChange(columnEntry,event.target.value)}>{[...new Set(["기타",...regions,...Array.from({length:quantitySummaryStart-stickyCount},(_,i)=>String(sheet[XLSX.utils.encode_cell({r:0,c:stickyCount+i})]?.v||"")).filter(Boolean)])].map(area=><option key={area} value={area}>{area}</option>)}</select>}{customerLines[1] && <small>{customerLines[1]}</small>}{customerUnmatchedEntry && <button type="button" className="unmatched-link" onClick={() => onMatch(customerUnmatchedEntry, 'customer') } title="별도 창에서 ERP 업체 매칭">미매칭</button>}</div>
                  : colIndex === 2 && stickyCount === 3 && rowIndex >= dutchDataStart(sheet) && sheetEntries.some(item => item.sourceRow === rowIndex)
                    ? <button type="button" className="weekday-edit-trigger" disabled={disabled} title="품목 비고에 칼라 저장" aria-label={`${String(sheet[XLSX.utils.encode_cell({r:rowIndex,c:1})]?.v || '')} 칼라 수정`} onClick={() => onColorChange(sheetEntries.find(item => item.sourceRow === rowIndex), raw)}>{raw || '\u00a0'}</button>
                    : <><span className={`source-value ${repeatedProduct(colIndex) ? 'repeated-product' : ''}`} title={raw}>{raw}</span>{productUnmatchedEntry && <button type="button" className="unmatched-link" onClick={() => onMatch(productUnmatchedEntry, 'product') } title="별도 창에서 ERP 품목 매칭">미매칭</button>}</>}
            {entry && <>
              {edited && <span className="draft-quantity">원본 {raw} {entry.unit || ''}</span>}
              <div className="cell-price">
                {priceEdit?.entryId === entry.id
                  ? <input ref={priceInputRef} className="price-edit-input" type="number" min="0" step="any" value={price ?? ''}
                      aria-label={`${entry.sourceCustomer || entry.customer} ${entry.sourceItem || entry.color || entry.product} 단가 입력`}
                      onChange={event => onPriceChange(entry, event.target.value)}
                      onBlur={() => finishPriceEdit(entry, true)}
                      onKeyDown={event => {
                        if (event.key === 'Enter') { event.preventDefault(); finishPriceEdit(entry, true); }
                        if (event.key === 'Escape') { event.preventDefault(); finishPriceEdit(entry, false); }
                      }}/>
                  : <button type="button" className="price-edit-trigger" disabled={disabled}
                      title="클릭해 단가 입력" aria-label={`${entry.sourceCustomer || entry.customer} ${entry.sourceItem || entry.color || entry.product} 단가 입력`}
                      onClick={() => beginPriceEdit(entry)}>{hasPrice(price) ? formatQty(price) : '\u00a0'}</button>}
              </div>
            </>}
          </td>;
        })}</tr>;
      })}
    </tbody></table></div>
    {entries.some(entry => entry.added) && <p className="manual-note">수동 추가행 {entries.filter(entry => entry.added).length}건은 원본 셀에 삽입하지 않았습니다. ‘단가 수정’ 탭에서 확인하세요.</p>}
    <style jsx>{`.quantity-history-badge{display:inline-block;margin-left:3px;border:1px solid #b6c8e0;border-radius:8px;padding:0 4px;background:#eef5ff;color:#315783;font-size:9px;line-height:1.4;cursor:pointer}.quantity-history-badge:focus-visible{outline:2px solid #155bd7}`}</style>
    <style jsx>{`@media(max-width:760px){.sheet-scroll .sticky-cell{position:static!important;left:auto!important}.sheet-scroll .header-cell.sticky-cell{position:static!important}}`}</style>
    <style jsx>{`.sheet-scroll table{font-size:14px}.sheet-scroll td{height:32px}.source-value{font-weight:700}.customer-header-label{min-height:29px;line-height:1.1}.customer-header-label select{width:100%;min-width:0;font:inherit;border:1px solid #cbd5e1;background:white}.customer-header-label small{font-size:12px;font-weight:800}.quantity-edit-trigger{min-height:26px;font-size:15px;font-weight:800}.quantity-edit-trigger:focus-visible{outline:2px solid #155bd7}.unmatched-link{font-size:12px;font-weight:900;border-radius:2px;padding:1px 3px}.unmatched-link:focus-visible{outline:2px solid #155bd7;outline-offset:1px}.draft-quantity{font-size:11px}@media(max-width:760px){.sheet-scroll table{font-size:13px}.quantity-edit-trigger{font-size:14px}}`}</style>
    <style jsx>{`.source-sheet{min-width:0;background:#fff;border:1px solid #bfcada}.sheet-bar{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:5px 7px;border-bottom:1px solid #cbd5e1}.sheet-bar div{display:flex;gap:8px;align-items:baseline;flex-wrap:wrap}.sheet-bar b{font-size:12px;color:#14345b}.sheet-bar span,.manual-note{font-size:10px;color:#52647c}.sheet-bar select{height:26px;border:1px solid #aebbd0}.sheet-top-scroll{height:14px;overflow-x:auto;overflow-y:hidden;scrollbar-gutter:stable;margin:2px 0;overscroll-behavior-x:contain}.sheet-top-scroll[hidden]{display:none}.sheet-top-scroll-inner{height:1px}.sheet-scroll{overflow:auto;max-height:none;min-height:0;scrollbar-gutter:auto;overscroll-behavior-x:contain}.sheet-scroll table{border-collapse:separate;border-spacing:0;table-layout:fixed;width:max-content;min-width:100%;font-size:10px}.sheet-scroll td{height:30px;box-sizing:border-box;border-right:1px solid #d4dce7;border-bottom:1px solid #d4dce7;padding:2px 3px;vertical-align:middle;background:#fff;white-space:normal;overflow:hidden;overflow-wrap:anywhere}.source-value{font-weight:600}.customer-header-label{display:flex;min-height:26px;flex-direction:column;align-items:center;justify-content:center;line-height:1.05;overflow-wrap:anywhere}.customer-header-label>span{max-width:100%;font-weight:800}.customer-header-label small{font-size:9px;font-weight:700;color:#435a79}.quantity-cell{text-align:right}.quantity-edit-trigger{display:block;width:100%;min-height:24px;border:0;padding:0;background:transparent;color:inherit;font:inherit;font-weight:600;text-align:right;cursor:text}.quantity-edit-trigger:hover,.quantity-edit-trigger:focus-visible{background:#e9f2ff;outline:1px solid #83aee7}.quantity-edit-input{box-sizing:border-box;width:100%;min-width:0;height:25px;padding:1px 2px;border:1px solid #155bd7;border-radius:2px;text-align:right;font:inherit}.header-cell{position:relative;z-index:3;background:#dce6f4!important;color:#16335e;font-weight:800}.sticky-cell{position:sticky;z-index:2;background:#f7f9fc!important;box-shadow:1px 0 #cbd5e1}.header-cell.sticky-cell{z-index:4;background:#dce6f4!important}.editable-cell{background:#f6fbff!important}.editable-cell.sticky-cell{background:#eef7ff!important}.active-cell{outline:2px solid #155bd7;outline-offset:-2px}.unmatched-link{display:inline-block;margin-left:3px;border:0;padding:0 2px;background:#fff0ee;color:#bb2920;font-size:9px;font-weight:800;line-height:1.2;cursor:pointer}.draft-quantity{display:block;color:#7a4a00;font-size:9px}.manual-note{margin:5px 7px}@media(max-width:760px){.sheet-bar div{display:block}.sheet-top-scroll{height:15px}}`}</style>
    <style jsx>{`.quantity-cell{padding:0!important;text-align:center}.quantity-edit-trigger{min-height:26px;text-align:center}.quantity-edit-input,.price-edit-input{height:27px;padding:0;text-align:center}.weekday-edit-trigger{display:block;width:100%;min-height:20px;border:0;padding:0 3px;background:transparent;color:inherit;font:inherit;text-align:center;cursor:text}.weekday-edit-trigger:hover,.weekday-edit-trigger:focus-visible{background:#e9f2ff;outline:1px solid #83aee7}.day-edit-input{box-sizing:border-box;width:100%;min-width:0;height:22px;padding:0 2px;border:1px solid #155bd7;text-align:center;font:inherit}.header-cell{text-align:center}.cell-price{display:flex;align-items:center;justify-content:center;gap:3px;min-width:0}.price-edit-trigger,.source-link{border:0;background:transparent;color:#155bd7;text-decoration:underline;font-size:10px;cursor:pointer;padding:0;white-space:nowrap}.price-edit-trigger{font-weight:800;color:#075c37}.price-edit-trigger:disabled,.source-link:disabled{cursor:default;opacity:.65}.draft-quantity{text-align:center}`}</style>
    <style jsx>{`
      .sheet-scroll table{width:100%;min-width:100%;font-size:12px}
      .repeated-product{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden;max-height:2.3em;word-break:normal;overflow-wrap:break-word;text-align:left}
      .sheet-scroll td{padding:1px;line-height:1.15}
      .customer-header-label>span{max-width:2em;font-size:12px;word-break:break-all}
      .customer-header-label small{font-size:10px}
      .quantity-edit-trigger{font-size:13px;font-weight:800;min-height:22px}
      .price-edit-trigger{display:block;width:100%;min-height:13px;font-size:11px;text-decoration:none}
      .price-edit-trigger:hover,.price-edit-trigger:focus-visible{outline:1px solid #83aee7;background:#e9f2ff}
    `}</style>
  </section>;
}
