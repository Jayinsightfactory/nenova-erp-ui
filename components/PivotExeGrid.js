import { buildPivotExePresentation, formatPivotExeNumber, pivotExeFieldLabel } from '../lib/pivotExePresentation';
import { pivotAxisKey, pivotCellKey } from '../lib/pivotExeModel';
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
    <button type="button" className={styles.tinyButton} onClick={(event) => { event.stopPropagation(); onFilter?.(id, event); }} title={`${pivotExeFieldLabel(id)} 필터${active ? ' 적용됨' : ''}`} aria-label={`${pivotExeFieldLabel(id)} 필터`} style={active ? {background:'#dcecff',color:'#1558a6'} : undefined}>{active ? '●' : '⌄'}</button>
    <button type="button" className={styles.tinyButton} onClick={(event) => { event.stopPropagation(); onFieldMenu?.(id, event); }} title={`${pivotExeFieldLabel(id)} 설정`} aria-label={`${pivotExeFieldLabel(id)} 설정`}>⚙</button>
  </span>;
}

/** Presentational EXE-like hierarchy grid.  Parent owns every interaction and persisted state. */
export default function PivotExeGrid({
  model, zones, decimals = 2, zeroVisible = false, widths = {}, rowHeight,
  onResize, onFieldMenu, onFilter, onBestFit, onToggleRow, onToggleColumn,
  sorts = {}, selections, filterActive,
}) {
  const presentation = buildPivotExePresentation(model, { widths, rowHeight });
  const headerHeight = presentation.rowHeight;
  const allColumns = [...presentation.rowWidths, ...presentation.dataColumns];
  const rowAxes = model?.rowAxis || [];
  const isEmpty = model?.filteredRowCount === 0;
  const visibleRows = isEmpty ? [] : rowAxes;
  const columnCount = Math.max(1, allColumns.length);
  const tableWidth = allColumns.reduce((sum, item) => sum + item.width, 0);
  return <div className={styles.scroll} data-selection-count={Object.keys(selections || {}).length} data-filter-active={filterActive ? 'true' : 'false'}>
    <table className={styles.table} data-testid="pivot-exe-grid" style={{ '--pivot-row-height': `${presentation.rowHeight}px`, width: `${tableWidth}px` }}>
      <colgroup>{allColumns.map((item) => <col key={item.id} style={{ width: item.width, minWidth: item.width }} />)}</colgroup>
      <thead>
        {presentation.headerRows.map((headerCells, level) => <tr key={`header-${level}`} style={{ height: headerHeight }}>
          {level === 0 && presentation.rowWidths.map((field, index) => <th key={field.id} rowSpan={presentation.headerRows.length} className={styles.fieldHead} style={{ left: presentation.rowWidths.slice(0, index).reduce((sum, item) => sum + item.width, 0), top: 0, zIndex: 30 }}>
            <FieldControls id={field.id} sorts={sorts} onFieldMenu={onFieldMenu} onFilter={onFilter} selections={selections} filterActive={filterActive} />
            <span className={styles.resizeHandle} title="열 너비 조절 · 두 번 클릭하면 자동맞춤" onMouseDown={(event) => { event.preventDefault(); onResize?.(field.id, event.clientX, field.width); }} onDoubleClick={(event) => { event.preventDefault(); onBestFit?.(field.id); }} />
          </th>)}
          {headerCells.map((cell) => <th key={`${cell.level}-${cell.columnStart}-${cell.measure?.key || ''}`} colSpan={cell.columnSpan} className={styles.axisHead} style={{ top: level * headerHeight }}>
            <button type="button" className={styles.headerButton} onClick={(event) => cell.measure ? onFieldMenu?.(cell.measure.field, event) : cell.canToggle ? onToggleColumn?.(cell.axisKey) : undefined} title={cell.title || cell.label || '열 머리글'}>{cell.label || ' '}</button>
            {cell.measure && <span className={styles.resizeHandle} title="열 너비 조절 · 두 번 클릭하면 자동맞춤" onMouseDown={(event) => { event.preventDefault(); onResize?.(presentation.dataColumns[cell.columnStart].id, event.clientX, presentation.dataColumns[cell.columnStart].width); }} onDoubleClick={(event) => { event.preventDefault(); onBestFit?.(presentation.dataColumns[cell.columnStart].id); }} />}
          </th>)}
        </tr>)}
      </thead>
      <tbody>
        {visibleRows.map((axis, rowIndex) => <tr key={axis.key} className={axis.isTotal ? styles.totalRow : ''} style={{ height: presentation.rowHeight }}>
          {presentation.rowHeaderCells[rowIndex]?.map((cell, fieldIndex) => {
            if (!cell || cell.hidden) return null;
            const field = presentation.rowWidths[fieldIndex];
            const isToggle = !axis.isGrandTotal && fieldIndex < presentation.rowFields.length - 1 && fieldIndex < axis.path.length;
            const groupKey = pivotAxisKey('row', axis.path.slice(0, fieldIndex + 1));
            return <th key={`${axis.key}-${field.id}`} rowSpan={cell.rowSpan} className={styles.rowHead} style={{ left: presentation.rowWidths.slice(0, fieldIndex).reduce((sum, item) => sum + item.width, 0), zIndex: presentation.rowWidths.length - fieldIndex }} title={cell.label}>
              {isToggle ? <button type="button" data-testid={`pivot-exe-row-${groupKey}`} className={styles.rowButton} onClick={() => onToggleRow?.(groupKey)}>{axis.collapsed && fieldIndex === axis.depth ? '▸ ' : '▾ '}{cell.label}</button> : <span>{cell.label}</span>}
            </th>;
          })}
          {presentation.dataColumns.map(({ id, column, measure }) => {
            const value = model?.cellMap?.[pivotCellKey(axis.key, column.key)]?.values?.[measure.key];
            const label = formatPivotExeNumber(value, decimals, zeroVisible);
            return <td key={id} className={styles.numberCell} title={label || (value === 0 ? '0' : '')}>{label}</td>;
          })}
        </tr>)}
        {isEmpty && <tr><td colSpan={columnCount} className={styles.empty}>표시할 데이터가 없습니다.</td></tr>}
      </tbody>
    </table>
  </div>;
}
