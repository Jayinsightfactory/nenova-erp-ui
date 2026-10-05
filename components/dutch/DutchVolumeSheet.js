import { useEffect, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx-js-style';
import { parseDutchSheetQuantity } from '../../lib/dutchSheetQuantityEdit';

const formatQty = value => Number(value).toLocaleString('ko-KR', { maximumFractionDigits: 4 });
const hasPrice = value => value !== undefined && value !== null && String(value) !== '';

export default function DutchVolumeSheet({ workbook, entries = [], prices = {}, priceKey, onEdit, onQuantityChange = () => {}, activeEntryId = '', disabled = false }) {
  const sheets = useMemo(() => [...new Set(entries.filter(entry => !entry.added && entry.sheetName && workbook?.Sheets?.[entry.sheetName]).map(entry => entry.sheetName))], [entries, workbook]);
  const [sheetName, setSheetName] = useState('');
  const scrollRef = useRef(null);
  const topScrollRef = useRef(null);
  const quantityInputRef = useRef(null);
  const quantityEditRef = useRef(null);
  const [quantityEdit, setQuantityEdit] = useState(null);
  const [scrollMetrics, setScrollMetrics] = useState({ content: 0, viewport: 0 });
  useEffect(() => { if (!sheets.includes(sheetName)) setSheetName(sheets[0] || ''); }, [sheets, sheetName]);
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
  }, [activeEntryId, sheetName]);
  useEffect(() => {
    if (!quantityEdit) return;
    quantityInputRef.current?.focus();
    quantityInputRef.current?.select();
  }, [quantityEdit?.entryId]);

  const beginQuantityEdit = entry => {
    const next = { entryId: entry.id, originalValue: Number(entry.quantity), value: String(entry.quantity) };
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

  const sheet = workbook?.Sheets?.[sheetName];
  const range = sheet?.['!ref'] ? XLSX.utils.decode_range(sheet['!ref']) : null;
  const tooLarge = range && (range.e.r - range.s.r + 1) * (range.e.c - range.s.c + 1) > 100000;
  const sourceEntries = useMemo(() => new Map(entries.filter(entry => !entry.added && entry.sheetName && entry.cellAddress).map(entry => [`${entry.sheetName}!${entry.cellAddress}`, entry])), [entries]);
  const sheetEntries = entries.filter(entry => !entry.added && entry.sheetName === sheetName);
  const layoutVersion = sheetEntries[0]?.layoutVersion || 3;
  const stickyCount = layoutVersion === 3 ? 3 : 2;
  const widths = [148, 292, 142];
  const widthOf = column => column < stickyCount ? widths[column] : 92;
  const leftOf = column => widths.slice(0, column).reduce((sum, width) => sum + width, 0);
  const syncHorizontalScroll = (sourceRef, targetRef) => {
    const source = sourceRef.current;
    const target = targetRef.current;
    if (source && target && Math.abs(source.scrollLeft - target.scrollLeft) > 0.5) target.scrollLeft = source.scrollLeft;
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
    <div className="sheet-bar"><div><b>원본 물량표 · {sheetName}</b><span>수량 셀을 클릭해 최종수량을 변경할 수 있습니다. 변경은 초안에 저장되며 ERP 반영 전 다시 검증해야 합니다.</span></div>{sheets.length > 1 && <select aria-label="원본 시트 선택" value={sheetName} onChange={event => setSheetName(event.target.value)}>{sheets.map(name => <option key={name} value={name}>{name}</option>)}</select>}</div>
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
          const price = entry ? prices[priceKey(entry)] : undefined;
          const raw = cell?.v == null ? (cell?.f ? '수식 캐시 없음' : '') : typeof cell.v === 'number' ? formatQty(cell.v) : String(cell.v);
          const edited = entry && Number.isFinite(Number(entry.quantity)) && Number(entry.quantity) !== Number(cell?.v);
          const header = rowIndex === 2;
          const sticky = colIndex < stickyCount && (!merge || merge.e.c === merge.s.c);
          const style = { width: widthOf(colIndex), minWidth: widthOf(colIndex), maxWidth: widthOf(colIndex) };
          if (sticky) style.left = leftOf(colIndex);
          const quantityEditable = !!entry && colIndex >= stickyCount && !disabled;
          const isEditingQuantity = quantityEditable && quantityEdit?.entryId === entry.id;
          const quantityLabel = `${entry?.sourceFlower || entry?.product} ${entry?.sourceItem || entry?.color} ${entry?.sourceCustomer || entry?.customer} ${address} 수량`;
          return <td key={address} rowSpan={merge ? merge.e.r - merge.s.r + 1 : undefined} colSpan={merge ? merge.e.c - merge.s.c + 1 : undefined}
            className={`${header ? 'header-cell ' : ''}${sticky ? 'sticky-cell ' : ''}${entry ? 'editable-cell ' : ''}${activeEntryId === entry?.id ? 'active-cell ' : ''}${colIndex >= stickyCount ? 'quantity-cell' : ''}`}
            style={style} title={cell?.f ? `${address} · 수식: ${cell.f}` : address} data-entry-id={entry?.id}>
            {isEditingQuantity
              ? <input ref={quantityInputRef} className="quantity-edit-input" type="number" min="0" step="any" value={quantityEdit.value} aria-label={quantityLabel}
                  onChange={event => changeQuantityEdit(event.target.value)}
                  onBlur={() => finishQuantityEdit(true)}
                  onKeyDown={event => {
                    if (event.key === 'Enter') { event.preventDefault(); finishQuantityEdit(true, true); }
                    if (event.key === 'Escape') { event.preventDefault(); finishQuantityEdit(false); }
                  }}/>
              : quantityEditable
                ? <button type="button" className="quantity-edit-trigger" title="클릭해 수량 변경" aria-label={`${quantityLabel}, 현재 ${formatQty(entry.quantity)}${entry.unit ? ` ${entry.unit}` : ''}. 클릭해 변경`} onClick={() => beginQuantityEdit(entry)}>{formatQty(entry.quantity)}</button>
                : <span className="source-value">{raw}</span>}
            {entry && <><span className="source-link"><button type="button" onClick={() => onEdit(entry.id)} aria-label={`${entry.sourceFlower || entry.product} ${entry.sourceItem || entry.color} ${entry.sourceCustomer || entry.customer} ${address} 단가 및 매칭 편집 열기`}>단가</button></span>
              {edited && <span className="draft-quantity">원본 {raw} {entry.unit || ''}</span>}
              {hasPrice(price) && <span className="price-badge">{formatQty(price)}원{Number(price) === 0 ? ' · 명시 0' : ''}</span>}
            </>}
          </td>;
        })}</tr>;
      })}
    </tbody></table></div>
    {entries.some(entry => entry.added) && <p className="manual-note">수동 추가행 {entries.filter(entry => entry.added).length}건은 원본 셀에 삽입하지 않았습니다. ‘단가 수정’ 탭에서 확인하세요.</p>}
    <style jsx>{`@media(max-width:760px){.sheet-scroll .sticky-cell{position:static!important;left:auto!important}.sheet-scroll .header-cell.sticky-cell{position:sticky!important;top:0}}`}</style>
    <style jsx>{`.source-sheet{min-width:0;background:#fff;border:1px solid #bfcada}.sheet-bar{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:8px 10px;border-bottom:1px solid #cbd5e1}.sheet-bar div{display:flex;gap:12px;align-items:baseline;flex-wrap:wrap}.sheet-bar b{font-size:13px;color:#14345b}.sheet-bar span,.manual-note{font-size:11px;color:#52647c}.sheet-bar select{height:30px;border:1px solid #aebbd0}.sheet-top-scroll{height:14px;overflow-x:auto;overflow-y:hidden;scrollbar-gutter:stable;margin:2px 0;overscroll-behavior-x:contain}.sheet-top-scroll[hidden]{display:none}.sheet-top-scroll-inner{height:1px}.sheet-scroll{overflow:auto;max-height:calc(100vh - 338px);min-height:300px;scrollbar-gutter:stable;overscroll-behavior:contain}.sheet-scroll table{border-collapse:separate;border-spacing:0;table-layout:fixed;width:max-content;min-width:100%;font-size:11px}.sheet-scroll td{height:35px;box-sizing:border-box;border-right:1px solid #d4dce7;border-bottom:1px solid #d4dce7;padding:4px 6px;vertical-align:middle;background:#fff;white-space:normal;overflow:hidden;overflow-wrap:anywhere}.source-value{font-weight:600}.quantity-cell{text-align:right}.quantity-edit-trigger{display:block;width:100%;min-height:26px;border:0;padding:0;background:transparent;color:inherit;font:inherit;font-weight:600;text-align:right;cursor:text}.quantity-edit-trigger:hover,.quantity-edit-trigger:focus-visible{background:#e9f2ff;outline:1px solid #83aee7}.quantity-edit-input{box-sizing:border-box;width:100%;min-width:0;height:27px;padding:2px 4px;border:1px solid #155bd7;border-radius:3px;text-align:right;font:inherit}.header-cell{position:sticky;top:0;z-index:3;background:#dce6f4!important;color:#16335e;font-weight:800}.sticky-cell{position:sticky;z-index:2;background:#f7f9fc!important;box-shadow:1px 0 #cbd5e1}.header-cell.sticky-cell{z-index:4;background:#dce6f4!important}.editable-cell{background:#f6fbff!important}.editable-cell.sticky-cell{background:#eef7ff!important}.active-cell{outline:2px solid #155bd7;outline-offset:-2px}.source-link{display:inline-block;margin-left:5px}.source-link button{border:0;background:transparent;color:#155bd7;text-decoration:underline;font-size:10px;cursor:pointer;padding:0}.draft-quantity{display:block;color:#7a4a00;font-size:10px}.price-badge{display:inline-block;margin-top:2px;padding:1px 4px;border-radius:3px;background:#e3f4ec;color:#075c37;font-size:10px;font-weight:800}.manual-note{margin:6px 9px}@media(max-width:760px){.sheet-bar div{display:block}.sheet-top-scroll{height:15px}.sheet-scroll{max-height:550px;min-height:220px}}`}</style>
  </section>;
}
