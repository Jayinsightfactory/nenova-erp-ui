import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  buildPivotExeStructure,
  formatPivotExeNumber,
  getPivotExePresentationDimensions,
  pivotExeFieldLabel,
} from '../lib/pivotExePresentation';
import { pivotAxisKey } from '../lib/pivotExeModel';
import {
  buildPivotExeColumnPrefix,
  clipPivotExeHeaderCells,
  getPivotExeColumnWindow,
  getPivotExeRowWindow,
  getPivotExeWindowedRowHeaderCells,
  shouldWindowPivotExe,
} from '../lib/pivotExeWindow';
import styles from './PivotExeGrid.module.css';

function sortArrow(sorts, id) {
  const value = typeof sorts === 'object' && sorts ? sorts[id] : null;
  return value === 'asc' ? ' ▲' : value === 'desc' ? ' ▼' : '';
}

function FieldControls({ id, sorts, onFieldMenu, onFilter, valueFilterStates }) {
  const filterState = valueFilterStates?.[id] || { active:false, label:'전체' };
  return <span className={styles.fieldControls}>
    <button type="button" className={styles.headerButton} onClick={(event) => onFieldMenu?.(id, event)} title={`${pivotExeFieldLabel(id)} 설정`}>
      {pivotExeFieldLabel(id)}{sortArrow(sorts, id)}
    </button>
    <button type="button" className={styles.tinyButton} onClick={(event) => { event.stopPropagation(); onFilter?.(id, event); }} title={`${pivotExeFieldLabel(id)}에서 표시할 값: ${filterState.label}`} aria-label={`${pivotExeFieldLabel(id)} 값 필터`} style={filterState.active ? { background: '#dcecff', color: '#1558a6' } : undefined}>{filterState.active ? '●' : '⌄'}</button>
    <button type="button" className={styles.tinyButton} onClick={(event) => { event.stopPropagation(); onFieldMenu?.(id, event); }} title={`${pivotExeFieldLabel(id)} 설정`} aria-label={`${pivotExeFieldLabel(id)} 설정`}>⚙</button>
  </span>;
}

// Body deliberately receives no dimensions. CSS custom properties on the table update sticky
// offsets, column widths, and row height without reconstructing thousands of numeric cells.
function RowHeaderCells({ axis, rowHeaderCells, rowFields, onToggleRowRef }) {
  return rowHeaderCells?.map((cell, fieldIndex) => {
    if (!cell || cell.hidden) return null;
    const fieldId = rowFields[fieldIndex];
    const isToggle = !axis.isGrandTotal && fieldIndex < rowFields.length - 1 && fieldIndex < axis.path.length;
    const groupKey = pivotAxisKey('row', axis.path.slice(0, fieldIndex + 1));
    return <th key={`${axis.key}-${fieldId}`} rowSpan={cell.rowSpan} className={styles.rowHead} style={cell.stickyStyle} title={cell.label}>
      {isToggle
        ? <button type="button" data-testid={`pivot-exe-row-${groupKey}`} className={styles.rowButton} onClick={() => onToggleRowRef.current?.(groupKey)}>{axis.collapsed && fieldIndex === axis.depth ? '▸ ' : '▾ '}{cell.label}</button>
        : <span>{cell.label}</span>}
    </th>;
  });
}

const PivotExeBody = memo(function PivotExeBody({ structure, formattedLabels, onToggleRowRef }) {
  const columnCount = Math.max(1, structure.rowFields.length + structure.dataColumns.length);
  return <tbody>
    {!structure.isEmpty && structure.bodyRows.map(({ axis, rowHeaderCells, dataCells }, rowIndex) => <tr key={axis.key} className={axis.isTotal ? styles.totalRow : ''}>
      <RowHeaderCells axis={axis} rowHeaderCells={rowHeaderCells} rowFields={structure.rowFields} onToggleRowRef={onToggleRowRef} />
      {dataCells.map(({ id, value }, columnIndex) => {
        const label = formattedLabels[rowIndex][columnIndex];
        return <td key={id} data-pivot-row-index={rowIndex} data-pivot-column-index={columnIndex} className={styles.numberCell} title={label || (value === 0 ? '0' : '')}>{label}</td>;
      })}
    </tr>)}
    {structure.isEmpty && <tr><td colSpan={columnCount} className={styles.empty}>표시할 데이터가 없습니다.</td></tr>}
  </tbody>;
});

const PivotExeWindowedBody = memo(function PivotExeWindowedBody({ structure, formattedLabels, rowWindow, columnWindow, windowedRowHeaders, onToggleRowRef }) {
  const renderedColumnCount = structure.rowFields.length + columnWindow.end - columnWindow.start + 2;
  return <tbody>
    {rowWindow.topHeight > 0 && <tr className={styles.verticalSpacer}><td colSpan={renderedColumnCount} style={{ height: rowWindow.topHeight }} /></tr>}
    {structure.bodyRows.slice(rowWindow.start, rowWindow.end).map(({ axis, dataCells }, localRowIndex) => {
      const rowIndex = rowWindow.start + localRowIndex;
      return <tr key={axis.key} className={axis.isTotal ? styles.totalRow : ''}>
        <RowHeaderCells axis={axis} rowHeaderCells={windowedRowHeaders[localRowIndex]} rowFields={structure.rowFields} onToggleRowRef={onToggleRowRef} />
        <td className={styles.columnSpacer} aria-hidden="true" />
        {dataCells.slice(columnWindow.start, columnWindow.end).map(({ id, value }, localColumnIndex) => {
          const columnIndex = columnWindow.start + localColumnIndex;
          const label = formattedLabels[rowIndex][columnIndex];
          return <td key={id} data-pivot-row-index={rowIndex} data-pivot-column-index={columnIndex} className={styles.numberCell} title={label || (value === 0 ? '0' : '')}>{label}</td>;
        })}
        <td className={styles.columnSpacer} aria-hidden="true" />
      </tr>;
    })}
    {rowWindow.bottomHeight > 0 && <tr className={styles.verticalSpacer}><td colSpan={renderedColumnCount} style={{ height: rowWindow.bottomHeight }} /></tr>}
  </tbody>;
});

function AxisHeaderCell({ cell, dimensions, onFieldMenu, onToggleColumn, onResize, onBestFit }) {
  return <th key={`${cell.level}-${cell.columnStart}-${cell.measure?.key || ''}`} colSpan={cell.columnSpan} className={styles.axisHead} style={{ top: cell.level * dimensions.rowHeight }}>
    <button type="button" className={styles.headerButton} onClick={(event) => cell.measure ? onFieldMenu?.(cell.measure.field, event) : cell.canToggle ? onToggleColumn?.(cell.axisKey) : undefined} title={cell.title || cell.label || '열 머리글'}>{cell.label || ' '}</button>
    {cell.measure && <span className={styles.resizeHandle} title="가로 데이터 열 전체 너비 조절 · 두 번 클릭하면 전체 자동맞춤" onMouseDown={(event) => { event.preventDefault(); const column = dimensions.dataColumns[cell.columnStart]; onResize?.(column.id, event.clientX, column.width); }} onDoubleClick={(event) => { event.preventDefault(); onBestFit?.(dimensions.dataColumns[cell.columnStart].id); }} />}
  </th>;
}

/** Presentational EXE-like hierarchy grid. Parent owns every interaction and persisted state. */
const PivotExeGrid = memo(function PivotExeGrid({
  model, decimals = 2, zeroVisible = false, widths = {}, rowHeight,
  onResize, onFieldMenu, onFilter, onBestFit, onToggleRow, onToggleColumn,
  sorts = {}, selections, filterActive, valueFilterStates,
}) {
  // Hashing data-column ids and finding merged cells are tied to the model, never to resizing.
  const structure = useMemo(() => buildPivotExeStructure(model), [model]);
  const dimensions = useMemo(() => getPivotExePresentationDimensions(structure, { widths, rowHeight }), [structure, widths, rowHeight]);
  const onToggleRowRef = useRef(onToggleRow);
  onToggleRowRef.current = onToggleRow;
  // Formatting is intentionally independent of dimensions and scroll state: scrolling a large
  // table must only select cached labels, never invoke Intl.NumberFormat for new cells.
  const formattedLabels = useMemo(() => structure.bodyRows.map(({ dataCells }) => dataCells.map(({ value }) => formatPivotExeNumber(value, decimals, zeroVisible))), [structure, decimals, zeroVisible]);
  const isVirtualized = !structure.isEmpty && shouldWindowPivotExe(structure.bodyRows.length, structure.dataColumns.length);
  const scrollRef = useRef(null);
  const frameRef = useRef(null);
  const [viewport, setViewport] = useState({ scrollTop: 0, scrollLeft: 0, clientWidth: 0, clientHeight: 0 });
  const readViewport = useCallback(() => {
    const node = scrollRef.current;
    if (!node) return;
    const next = { scrollTop: node.scrollTop, scrollLeft: node.scrollLeft, clientWidth: node.clientWidth, clientHeight: node.clientHeight };
    setViewport((current) => current.scrollTop === next.scrollTop && current.scrollLeft === next.scrollLeft && current.clientWidth === next.clientWidth && current.clientHeight === next.clientHeight ? current : next);
  }, []);
  const onScroll = useCallback(() => {
    if (frameRef.current !== null || typeof window === 'undefined') return;
    frameRef.current = window.requestAnimationFrame(() => { frameRef.current = null; readViewport(); });
  }, [readViewport]);
  useEffect(() => {
    if (!isVirtualized) return undefined;
    readViewport();
    const node = scrollRef.current;
    if (!node || typeof ResizeObserver === 'undefined') return () => {
      if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    };
    const observer = new ResizeObserver(onScroll);
    observer.observe(node);
    return () => {
      observer.disconnect();
      if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    };
  }, [isVirtualized, onScroll, readViewport]);

  const dataPrefix = useMemo(() => buildPivotExeColumnPrefix(dimensions.dataColumns.map((column) => column.width)), [dimensions.dataColumns]);
  const rowHeaderWidth = dimensions.rowWidths.reduce((sum, column) => sum + column.width, 0);
  const rowWindow = useMemo(() => getPivotExeRowWindow({ totalRows: structure.bodyRows.length, scrollTop: viewport.scrollTop, clientHeight: viewport.clientHeight, headerHeight: structure.headerRows.length * dimensions.rowHeight, rowHeight: dimensions.rowHeight }), [structure.bodyRows.length, structure.headerRows.length, viewport.scrollTop, viewport.clientHeight, dimensions.rowHeight]);
  const columnWindow = useMemo(() => getPivotExeColumnWindow({ widths: dimensions.dataColumns.map((column) => column.width), prefix: dataPrefix, scrollLeft: viewport.scrollLeft, clientWidth: viewport.clientWidth, rowHeaderWidth }), [dimensions.dataColumns, dataPrefix, viewport.scrollLeft, viewport.clientWidth, rowHeaderWidth]);
  const windowedRowHeaders = useMemo(() => getPivotExeWindowedRowHeaderCells(structure.rowHeaderCells, rowWindow.start, rowWindow.end), [structure.rowHeaderCells, rowWindow.start, rowWindow.end]);
  const tableStyle = { '--pivot-row-height': `${dimensions.rowHeight}px`, width: `${dimensions.tableWidth}px` };
  dimensions.stickyOffsets.forEach((offset, index) => { tableStyle[`--pivot-sticky-left-${index}`] = `${offset}px`; });
  const allColumns = isVirtualized
    ? [...dimensions.rowWidths, { id: '__left-spacer', width: columnWindow.leftWidth }, ...dimensions.dataColumns.slice(columnWindow.start, columnWindow.end), { id: '__right-spacer', width: columnWindow.rightWidth }]
    : [...dimensions.rowWidths, ...dimensions.dataColumns];

  return <div ref={scrollRef} onScroll={isVirtualized ? onScroll : undefined} data-testid="pivot-exe-scroll" className={styles.scroll} data-pivot-virtualized={isVirtualized ? 'true' : 'false'} data-pivot-total-rows={structure.bodyRows.length} data-pivot-total-columns={structure.dataColumns.length} data-selection-count={Object.keys(selections || {}).length} data-filter-active={filterActive ? 'true' : 'false'}>
    <table className={styles.table} data-testid="pivot-exe-grid" style={tableStyle}>
      <colgroup>{allColumns.map((item) => <col key={item.id} style={{ width: item.width, minWidth: item.width }} />)}</colgroup>
      <thead>
        {structure.headerRows.map((headerCells, level) => <tr key={`header-${level}`}>
          {level === 0 && dimensions.rowWidths.map((field, index) => <th key={field.id} rowSpan={structure.headerRows.length} className={styles.fieldHead} style={{ left: dimensions.stickyOffsets[index], top: 0, zIndex: 30 }}>
            <FieldControls id={field.id} sorts={sorts} onFieldMenu={onFieldMenu} onFilter={onFilter} valueFilterStates={valueFilterStates} />
            <span className={styles.resizeHandle} title="열 너비 조절 · 두 번 클릭하면 자동맞춤" onMouseDown={(event) => { event.preventDefault(); onResize?.(field.id, event.clientX, field.width); }} onDoubleClick={(event) => { event.preventDefault(); onBestFit?.(field.id); }} />
          </th>)}
          {isVirtualized && <th className={styles.columnSpacer} aria-hidden="true" />}
          {(isVirtualized ? clipPivotExeHeaderCells(headerCells, columnWindow.start, columnWindow.end) : headerCells).map((cell) => <AxisHeaderCell key={`${cell.level}-${cell.columnStart}-${cell.measure?.key || ''}`} cell={cell} dimensions={dimensions} onFieldMenu={onFieldMenu} onToggleColumn={onToggleColumn} onResize={onResize} onBestFit={onBestFit} />)}
          {isVirtualized && <th className={styles.columnSpacer} aria-hidden="true" />}
        </tr>)}
      </thead>
      {isVirtualized
        ? <PivotExeWindowedBody structure={structure} formattedLabels={formattedLabels} rowWindow={rowWindow} columnWindow={columnWindow} windowedRowHeaders={windowedRowHeaders} onToggleRowRef={onToggleRowRef} />
        : <PivotExeBody structure={structure} formattedLabels={formattedLabels} onToggleRowRef={onToggleRowRef} />}
    </table>
  </div>;
});

export default PivotExeGrid;
