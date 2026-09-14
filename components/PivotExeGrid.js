import { memo, useMemo, useRef } from 'react';
import {
  buildPivotExeStructure,
  formatPivotExeNumber,
  getPivotExePresentationDimensions,
  pivotExeFieldLabel,
} from '../lib/pivotExePresentation';
import { pivotAxisKey } from '../lib/pivotExeModel';
import styles from './PivotExeGrid.module.css';

function sortArrow(sorts, id) {
  const value = typeof sorts === 'object' && sorts ? sorts[id] : null;
  return value === 'asc' ? ' ▲' : value === 'desc' ? ' ▼' : '';
}

function FieldControls({ id, sorts, onFieldMenu, onFilter, selections, filterActive }) {
  const active = filterActive && Object.prototype.hasOwnProperty.call(selections || {}, id);
  return <span className={styles.fieldControls}>
    <button type="button" className={styles.headerButton} onClick={(event) => onFieldMenu?.(id, event)} title={`${pivotExeFieldLabel(id)} 설정`}>
      {pivotExeFieldLabel(id)}{sortArrow(sorts, id)}
    </button>
    <button type="button" className={styles.tinyButton} onClick={(event) => { event.stopPropagation(); onFilter?.(id, event); }} title={`${pivotExeFieldLabel(id)} 필터${active ? ' 적용됨' : ''}`} aria-label={`${pivotExeFieldLabel(id)} 필터`} style={active ? { background: '#dcecff', color: '#1558a6' } : undefined}>{active ? '●' : '⌄'}</button>
    <button type="button" className={styles.tinyButton} onClick={(event) => { event.stopPropagation(); onFieldMenu?.(id, event); }} title={`${pivotExeFieldLabel(id)} 설정`} aria-label={`${pivotExeFieldLabel(id)} 설정`}>⚙</button>
  </span>;
}

// Body deliberately receives no dimensions. CSS custom properties on the table update sticky
// offsets, column widths, and row height without reconstructing thousands of numeric cells.
const PivotExeBody = memo(function PivotExeBody({ structure, decimals, zeroVisible, onToggleRowRef }) {
  const columnCount = Math.max(1, structure.rowFields.length + structure.dataColumns.length);
  return <tbody>
    {!structure.isEmpty && structure.bodyRows.map(({ axis, rowHeaderCells, dataCells }) => <tr key={axis.key} className={axis.isTotal ? styles.totalRow : ''}>
      {rowHeaderCells?.map((cell, fieldIndex) => {
        if (!cell || cell.hidden) return null;
        const fieldId = structure.rowFields[fieldIndex];
        const isToggle = !axis.isGrandTotal && fieldIndex < structure.rowFields.length - 1 && fieldIndex < axis.path.length;
        const groupKey = pivotAxisKey('row', axis.path.slice(0, fieldIndex + 1));
        return <th key={`${axis.key}-${fieldId}`} rowSpan={cell.rowSpan} className={styles.rowHead} style={cell.stickyStyle} title={cell.label}>
          {isToggle
            ? <button type="button" data-testid={`pivot-exe-row-${groupKey}`} className={styles.rowButton} onClick={() => onToggleRowRef.current?.(groupKey)}>{axis.collapsed && fieldIndex === axis.depth ? '▸ ' : '▾ '}{cell.label}</button>
            : <span>{cell.label}</span>}
        </th>;
      })}
      {dataCells.map(({ id, value }) => {
        const label = formatPivotExeNumber(value, decimals, zeroVisible);
        return <td key={id} className={styles.numberCell} title={label || (value === 0 ? '0' : '')}>{label}</td>;
      })}
    </tr>)}
    {structure.isEmpty && <tr><td colSpan={columnCount} className={styles.empty}>표시할 데이터가 없습니다.</td></tr>}
  </tbody>;
});

/** Presentational EXE-like hierarchy grid. Parent owns every interaction and persisted state. */
const PivotExeGrid = memo(function PivotExeGrid({
  model, decimals = 2, zeroVisible = false, widths = {}, rowHeight,
  onResize, onFieldMenu, onFilter, onBestFit, onToggleRow, onToggleColumn,
  sorts = {}, selections, filterActive,
}) {
  // Hashing data-column ids and finding merged cells are tied to the model, never to resizing.
  const structure = useMemo(() => buildPivotExeStructure(model), [model]);
  const dimensions = getPivotExePresentationDimensions(structure, { widths, rowHeight });
  const onToggleRowRef = useRef(onToggleRow);
  onToggleRowRef.current = onToggleRow;
  const tableStyle = { '--pivot-row-height': `${dimensions.rowHeight}px`, width: `${dimensions.tableWidth}px` };
  dimensions.stickyOffsets.forEach((offset, index) => { tableStyle[`--pivot-sticky-left-${index}`] = `${offset}px`; });
  const allColumns = [...dimensions.rowWidths, ...dimensions.dataColumns];

  return <div className={styles.scroll} data-selection-count={Object.keys(selections || {}).length} data-filter-active={filterActive ? 'true' : 'false'}>
    <table className={styles.table} data-testid="pivot-exe-grid" style={tableStyle}>
      <colgroup>{allColumns.map((item) => <col key={item.id} style={{ width: item.width, minWidth: item.width }} />)}</colgroup>
      <thead>
        {structure.headerRows.map((headerCells, level) => <tr key={`header-${level}`}>
          {level === 0 && dimensions.rowWidths.map((field, index) => <th key={field.id} rowSpan={structure.headerRows.length} className={styles.fieldHead} style={{ left: dimensions.stickyOffsets[index], top: 0, zIndex: 30 }}>
            <FieldControls id={field.id} sorts={sorts} onFieldMenu={onFieldMenu} onFilter={onFilter} selections={selections} filterActive={filterActive} />
            <span className={styles.resizeHandle} title="열 너비 조절 · 두 번 클릭하면 자동맞춤" onMouseDown={(event) => { event.preventDefault(); onResize?.(field.id, event.clientX, field.width); }} onDoubleClick={(event) => { event.preventDefault(); onBestFit?.(field.id); }} />
          </th>)}
          {headerCells.map((cell) => <th key={`${cell.level}-${cell.columnStart}-${cell.measure?.key || ''}`} colSpan={cell.columnSpan} className={styles.axisHead} style={{ top: level * dimensions.rowHeight }}>
            <button type="button" className={styles.headerButton} onClick={(event) => cell.measure ? onFieldMenu?.(cell.measure.field, event) : cell.canToggle ? onToggleColumn?.(cell.axisKey) : undefined} title={cell.title || cell.label || '열 머리글'}>{cell.label || ' '}</button>
            {cell.measure && <span className={styles.resizeHandle} title="열 너비 조절 · 두 번 클릭하면 자동맞춤" onMouseDown={(event) => { event.preventDefault(); const column = dimensions.dataColumns[cell.columnStart]; onResize?.(column.id, event.clientX, column.width); }} onDoubleClick={(event) => { event.preventDefault(); onBestFit?.(dimensions.dataColumns[cell.columnStart].id); }} />}
          </th>)}
        </tr>)}
      </thead>
      <PivotExeBody structure={structure} decimals={decimals} zeroVisible={zeroVisible} onToggleRowRef={onToggleRowRef} />
    </table>
  </div>;
});

export default PivotExeGrid;
