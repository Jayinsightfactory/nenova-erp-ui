import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  buildPivotExeStructure,
  formatPivotExeNumber,
  getPivotExePresentationDimensions,
  pivotExeValueLabel,
} from '../lib/pivotExePresentation';
import { pivotAxisKey } from '../lib/pivotExeModel';
import {
  buildPivotExeColumnPrefix,
  clipPivotExeHeaderCells,
  getPivotExeColumnWindow,
  getPivotExePageViewport,
  getPivotExeRowWindow,
  getPivotExeWindowedRowHeaderCells,
  shouldWindowPivotExe,
} from '../lib/pivotExeWindow';
import ExePivotFieldArea from './ExePivotFieldArea';
import styles from './PivotExeGrid.module.css';

// DevExpress header area rows (filter area, data/column field buttons) above the column value tree.
const FIELD_AREA_ROW_HEIGHT = 26;
// Placeholder widths when the row or data area has no columns, so field areas stay droppable.
const EMPTY_ROW_AREA_WIDTH = 160;
const EMPTY_DATA_AREA_WIDTH = 200;

// Subtotals render as DevExpress "{value} Total" from axis state; presentation/export labels stay untouched.
function axisLevelLabel(axis, level, fallback) {
  if (axis && !axis.isGrandTotal && axis.isTotal && level === (axis.path?.length || 0) - 1 && axis.path?.[level] !== undefined) {
    const value = axis.path[level];
    return value === null || value === undefined ? 'Total' : `${pivotExeValueLabel(value)} Total`;
  }
  // DevExpress 는 null 값 머리글을 빈칸으로 그린다. 셀 title 은 그대로 "(null)" 을 유지한다.
  if (axis && !axis.isGrandTotal && level < (axis.path?.length || 0) && (axis.path[level] === null || axis.path[level] === undefined)) return '';
  return fallback;
}

// Body deliberately receives no dimensions. CSS custom properties on the table update sticky
// offsets, column widths, and row height without reconstructing thousands of numeric cells.
function RowHeaderCells({ axis, rowHeaderCells, rowFields, onToggleRowRef }) {
  return rowHeaderCells?.map((cell, fieldIndex) => {
    if (!cell || cell.hidden) return null;
    const fieldId = rowFields[fieldIndex];
    const isToggle = !axis.isGrandTotal && fieldIndex < rowFields.length - 1 && fieldIndex < axis.path.length;
    const groupKey = pivotAxisKey('row', axis.path.slice(0, fieldIndex + 1));
    const shown = axisLevelLabel(cell.axis || axis, fieldIndex, cell.label);
    return <th key={`${axis.key}-${fieldId}`} rowSpan={cell.rowSpan} className={styles.rowHead} style={cell.stickyStyle} title={shown}>
      {isToggle
        ? <button type="button" data-testid={`pivot-exe-row-${groupKey}`} className={styles.rowButton} onClick={() => onToggleRowRef.current?.(groupKey)}><span className={styles.glyph} aria-hidden="true">{axis.collapsed && fieldIndex === axis.depth ? '›' : '⌄'}</span>{shown}</button>
        : <span>{shown}</span>}
    </th>;
  });
}

function dataCellClass(structure, columnIndex) {
  const column = structure.dataColumns[columnIndex]?.column;
  return column?.isTotal || column?.isGrandTotal ? `${styles.numberCell} ${styles.totalCol}` : styles.numberCell;
}
function rowClass(axis) {
  return axis.isTotal || axis.isGrandTotal ? styles.totalRow : '';
}
const EMPTY_ROW_AREA_STYLE = { '--pivot-sticky-left': '0px', '--pivot-sticky-z-index': 1 };

const PivotExeBody = memo(function PivotExeBody({ structure, formattedLabels, onToggleRowRef }) {
  const columnCount = Math.max(1, structure.rowFields.length) + Math.max(1, structure.dataColumns.length);
  const noRowFields = structure.rowFields.length === 0;
  return <tbody>
    {!structure.isEmpty && structure.bodyRows.map(({ axis, rowHeaderCells, dataCells }, rowIndex) => <tr key={axis.key} className={rowClass(axis)}>
      {noRowFields && <th className={styles.rowHead} style={EMPTY_ROW_AREA_STYLE}>{axis.isGrandTotal ? '총계' : ''}</th>}
      <RowHeaderCells axis={axis} rowHeaderCells={rowHeaderCells} rowFields={structure.rowFields} onToggleRowRef={onToggleRowRef} />
      {dataCells.map(({ id, value }, columnIndex) => {
        const label = formattedLabels[rowIndex][columnIndex];
        return <td key={id} data-pivot-row-index={rowIndex} data-pivot-column-index={columnIndex} className={dataCellClass(structure, columnIndex)} title={label || (value === 0 ? '0' : '')}>{label}</td>;
      })}
    </tr>)}
    {structure.isEmpty && <tr><td colSpan={columnCount} className={styles.empty}>표시할 데이터가 없습니다.</td></tr>}
  </tbody>;
});

const PivotExeWindowedBody = memo(function PivotExeWindowedBody({ structure, formattedLabels, rowWindow, columnWindow, windowedRowHeaders, onToggleRowRef }) {
  const renderedColumnCount = Math.max(1, structure.rowFields.length) + columnWindow.end - columnWindow.start + 2;
  const noRowFields = structure.rowFields.length === 0;
  return <tbody>
    {rowWindow.topHeight > 0 && <tr className={styles.verticalSpacer}><td colSpan={renderedColumnCount} style={{ height: rowWindow.topHeight }} /></tr>}
    {structure.bodyRows.slice(rowWindow.start, rowWindow.end).map(({ axis, dataCells }, localRowIndex) => {
      const rowIndex = rowWindow.start + localRowIndex;
      return <tr key={axis.key} className={rowClass(axis)}>
        {noRowFields && <th className={styles.rowHead} style={EMPTY_ROW_AREA_STYLE}>{axis.isGrandTotal ? '총계' : ''}</th>}
        <RowHeaderCells axis={axis} rowHeaderCells={windowedRowHeaders[localRowIndex]} rowFields={structure.rowFields} onToggleRowRef={onToggleRowRef} />
        <td className={styles.columnSpacer} aria-hidden="true" />
        {dataCells.slice(columnWindow.start, columnWindow.end).map(({ id, value }, localColumnIndex) => {
          const columnIndex = columnWindow.start + localColumnIndex;
          const label = formattedLabels[rowIndex][columnIndex];
          return <td key={id} data-pivot-row-index={rowIndex} data-pivot-column-index={columnIndex} className={dataCellClass(structure, columnIndex)} title={label || (value === 0 ? '0' : '')}>{label}</td>;
        })}
        <td className={styles.columnSpacer} aria-hidden="true" />
      </tr>;
    })}
    {rowWindow.bottomHeight > 0 && <tr className={styles.verticalSpacer}><td colSpan={renderedColumnCount} style={{ height: rowWindow.bottomHeight }} /></tr>}
  </tbody>;
});

function AxisHeaderCell({ cell, dimensions, top, height, columnFields, showResize, onFieldMenu, onToggleColumn, onResize, onBestFit, onCustHeaderResize }) {
  const fieldId = columnFields[cell.level];
  const canResizeHeight = fieldId === 'CustName';
  const column = cell.column;
  const isTotal = !cell.measure && Boolean(column?.isGrandTotal || (column?.isTotal && cell.level === (column.path?.length || 0) - 1));
  const shown = cell.measure ? cell.label : axisLevelLabel(column, cell.level, cell.label);
  const glyph = cell.canToggle ? (column?.collapsed && cell.level === (column.path?.length || 0) - 1 ? '›' : '⌄') : null;
  return <th key={`${cell.level}-${cell.columnStart}-${cell.measure?.key || ''}`} colSpan={cell.columnSpan} className={`${styles.axisHead}${isTotal ? ` ${styles.totalHead}` : ''}`} style={{ top, height }}>
    <button type="button" className={styles.headerButton} onClick={(event) => cell.measure ? onFieldMenu?.(cell.measure.field, event) : cell.canToggle ? onToggleColumn?.(cell.axisKey) : undefined} title={cell.title || shown || '열 머리글'}>{glyph && <span className={styles.glyph} aria-hidden="true">{glyph}</span>}{shown || ' '}</button>
    {(cell.measure || showResize) && <span className={styles.resizeHandle} title="가로 데이터 열 전체 너비 조절 · 두 번 클릭하면 전체 자동맞춤" onMouseDown={(event) => { event.preventDefault(); const dataColumn = dimensions.dataColumns[cell.columnStart]; onResize?.(dataColumn.id, event.clientX, dataColumn.width); }} onDoubleClick={(event) => { event.preventDefault(); onBestFit?.(dimensions.dataColumns[cell.columnStart].id); }} />}
    {canResizeHeight && <span data-testid="pivot-exe-cust-header-resize" className={styles.rowResizeHandle} title="거래처명/농장명 헤더 높이 조절" onMouseDown={(event) => { event.preventDefault(); onCustHeaderResize?.(event.clientY, height); }} />}
  </th>;
}

/** Presentational EXE-like hierarchy grid. Parent owns every interaction and persisted state. */
const PivotExeGrid = memo(function PivotExeGrid({
  model, decimals = 2, zeroVisible = false, widths = {}, rowHeight, custHeaderHeight = 24,
  onResize, onCustHeaderResize, onFieldMenu, onFilter, onBestFit, onToggleRow, onToggleColumn,
  sorts = {}, selections, filterActive, valueFilterStates, fieldAreas,
}) {
  // Hashing data-column ids and finding merged cells are tied to the model, never to resizing.
  const structure = useMemo(() => buildPivotExeStructure(model), [model]);
  const dimensions = useMemo(() => getPivotExePresentationDimensions(structure, { widths, rowHeight }), [structure, widths, rowHeight]);
  // Header row order (DevExpress): filter area, data|column field buttons, column value levels,
  // then the measure-name row only when two or more value fields are shown.
  const axisHeaderRows = useMemo(() => structure.headerRows.slice(0, -1), [structure.headerRows]);
  const measureHeaderRow = structure.headerRows[structure.headerRows.length - 1] || [];
  const showMeasureRow = structure.measures.length >= 2;
  const headerHeights = useMemo(() => [
    FIELD_AREA_ROW_HEIGHT,
    FIELD_AREA_ROW_HEIGHT,
    ...axisHeaderRows.map((_, level) => structure.columnFields[level] === 'CustName' ? Math.max(18, Math.min(120, Number(custHeaderHeight) || 24)) : dimensions.rowHeight),
    ...(showMeasureRow ? [dimensions.rowHeight] : []),
  ], [axisHeaderRows, showMeasureRow, structure.columnFields, custHeaderHeight, dimensions.rowHeight]);
  const headerOffsets = useMemo(() => headerHeights.map((_, level) => headerHeights.slice(0, level).reduce((sum, height) => sum + height, 0)), [headerHeights]);
  const totalHeaderHeight = headerHeights.reduce((sum, height) => sum + height, 0);
  const onToggleRowRef = useRef(onToggleRow);
  onToggleRowRef.current = onToggleRow;
  // Formatting is intentionally independent of dimensions and scroll state: scrolling a large
  // table must only select cached labels, never invoke Intl.NumberFormat for new cells.
  const formattedLabels = useMemo(() => structure.bodyRows.map(({ dataCells }) => dataCells.map(({ value, field }) => formatPivotExeNumber(value, decimals, zeroVisible, field))), [structure, decimals, zeroVisible]);
  const isVirtualized = !structure.isEmpty && shouldWindowPivotExe(structure.bodyRows.length, structure.dataColumns.length);
  const topScrollRef = useRef(null);
  const pinnedHeaderRef = useRef(null);
  const scrollRef = useRef(null);
  const frameRef = useRef(null);
  const [viewport, setViewport] = useState({ scrollTop: 0, scrollLeft: 0, clientWidth: 0, clientHeight: 0, headerPinned: false });
  const readViewport = useCallback(() => {
    const node = scrollRef.current;
    if (!node) return;
    // Vertical coordinates belong to the document, not the horizontal scroll container.
    const rect = node.getBoundingClientRect();
    const pageViewport = getPivotExePageViewport({ tableTop: rect.top + node.clientTop, headerHeight: totalHeaderHeight, viewportHeight: window.innerHeight });
    const next = { ...pageViewport, scrollLeft: node.scrollLeft, clientWidth: node.clientWidth, headerPinned: rect.top < 16 && rect.bottom > totalHeaderHeight + 16 };
    setViewport((current) => current.scrollTop === next.scrollTop && current.scrollLeft === next.scrollLeft && current.clientWidth === next.clientWidth && current.clientHeight === next.clientHeight && current.headerPinned === next.headerPinned ? current : next);
  }, [totalHeaderHeight]);
  const onScroll = useCallback(() => {
    if (frameRef.current !== null || typeof window === 'undefined') return;
    frameRef.current = window.requestAnimationFrame(() => { frameRef.current = null; readViewport(); });
  }, [readViewport]);
  const onBodyScroll = useCallback(() => {
    const body = scrollRef.current;
    const top = topScrollRef.current;
    if (body && top && top.scrollLeft !== body.scrollLeft) top.scrollLeft = body.scrollLeft;
    onScroll();
  }, [onScroll]);
  const onTopScroll = useCallback(() => {
    const body = scrollRef.current;
    const top = topScrollRef.current;
    if (!body || !top || body.scrollLeft === top.scrollLeft) return;
    body.scrollLeft = top.scrollLeft;
    readViewport();
  }, [readViewport]);
  useEffect(() => {
    readViewport();
    const node = scrollRef.current;
    window.addEventListener('scroll', onScroll, { passive: true, capture: true });
    window.addEventListener('resize', onScroll, { passive: true });
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(onScroll);
    if (node) observer?.observe(node);
    if (node?.parentElement?.parentElement) observer?.observe(node.parentElement.parentElement);
    return () => {
      observer?.disconnect();
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
      if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    };
  }, [isVirtualized, onScroll, readViewport]);
  const dataPrefix = useMemo(() => buildPivotExeColumnPrefix(dimensions.dataColumns.map((column) => column.width)), [dimensions.dataColumns]);
  const noRowFields = dimensions.rowWidths.length === 0;
  const noDataColumns = dimensions.dataColumns.length === 0;
  const rowHeaderWidth = noRowFields ? EMPTY_ROW_AREA_WIDTH : dimensions.rowWidths.reduce((sum, column) => sum + column.width, 0);
  const tableWidth = dimensions.tableWidth + (noRowFields ? EMPTY_ROW_AREA_WIDTH : 0) + (noDataColumns ? EMPTY_DATA_AREA_WIDTH : 0);

  useEffect(() => {
    if (pinnedHeaderRef.current) pinnedHeaderRef.current.scrollLeft = viewport.scrollLeft;
  }, [viewport.scrollLeft, viewport.headerPinned, tableWidth]);

  const rowWindow = useMemo(() => getPivotExeRowWindow({ totalRows: structure.bodyRows.length, scrollTop: viewport.scrollTop, clientHeight: viewport.clientHeight, rowHeight: dimensions.rowHeight }), [structure.bodyRows.length, viewport.scrollTop, viewport.clientHeight, dimensions.rowHeight]);
  const columnWindow = useMemo(() => getPivotExeColumnWindow({ widths: dimensions.dataColumns.map((column) => column.width), prefix: dataPrefix, scrollLeft: viewport.scrollLeft, clientWidth: viewport.clientWidth, rowHeaderWidth }), [dimensions.dataColumns, dataPrefix, viewport.scrollLeft, viewport.clientWidth, rowHeaderWidth]);
  const windowedRowHeaders = useMemo(() => getPivotExeWindowedRowHeaderCells(structure.rowHeaderCells, rowWindow.start, rowWindow.end), [structure.rowHeaderCells, rowWindow.start, rowWindow.end]);
  const tableStyle = { '--pivot-row-height': `${dimensions.rowHeight}px`, width: `${tableWidth}px` };
  dimensions.stickyOffsets.forEach((offset, index) => { tableStyle[`--pivot-sticky-left-${index}`] = `${offset}px`; });
  const leadColumns = noRowFields ? [{ id: '__row-area', width: EMPTY_ROW_AREA_WIDTH }] : dimensions.rowWidths;
  const allColumns = isVirtualized
    ? [...leadColumns, { id: '__left-spacer', width: columnWindow.leftWidth }, ...dimensions.dataColumns.slice(columnWindow.start, columnWindow.end), { id: '__right-spacer', width: columnWindow.rightWidth }]
    : [...leadColumns, ...(noDataColumns ? [{ id: '__data-area', width: EMPTY_DATA_AREA_WIDTH }] : dimensions.dataColumns)];
  const leadSpan = leadColumns.length;
  const dataSpan = isVirtualized ? columnWindow.end - columnWindow.start + 2 : Math.max(1, dimensions.dataColumns.length);
  const lastHeaderIndex = headerHeights.length - 1;
  const rightHeaderRows = [...axisHeaderRows.map((cells, level) => ({ cells, index: level + 2 })), ...(showMeasureRow ? [{ cells: measureHeaderRow, index: axisHeaderRows.length + 2 }] : [])];
  const lastAxisHeaderIndex = axisHeaderRows.length + 1;
  // The visible width keeps filter/column field buttons in view while the table scrolls sideways.
  const visibleAreaWidth = viewport.clientWidth ? Math.max(120, viewport.clientWidth - 2) : undefined;
  const renderArea = (zone, extraStyle) => fieldAreas?.[zone] ? <ExePivotFieldArea {...fieldAreas[zone]} zone={zone} style={{ ...fieldAreas[zone].style, ...extraStyle }} /> : null;
  const rowResizeHandles = dimensions.rowWidths.map((field, fieldIndex) => <span key={`resize-${field.id}`} className={styles.resizeHandle} style={{ left: dimensions.stickyOffsets[fieldIndex] + field.width - 4, right: 'auto' }} title={`${field.label} 열 너비 조절 · 두 번 클릭하면 자동맞춤`} onMouseDown={(event) => { event.preventDefault(); onResize?.(field.id, event.clientX, field.width); }} onDoubleClick={(event) => { event.preventDefault(); onBestFit?.(field.id); }} />);

  const columns = <colgroup>{allColumns.map((item) => <col key={item.id} style={{ width: item.width, minWidth: item.width }} />)}</colgroup>;
  const header = <thead>
        <tr style={{ height: headerHeights[0] }}>
          <th colSpan={leadSpan + dataSpan} className={styles.areaHead} style={{ top: headerOffsets[0], height: headerHeights[0], zIndex: 33 }}>
            <div className={styles.areaStick} style={{ left: 0, width: visibleAreaWidth }}>{renderArea('filters', { overflowX: 'auto' })}</div>
          </th>
        </tr>
        <tr style={{ height: headerHeights[1] }}>
          <th colSpan={leadSpan} className={styles.areaHead} style={{ top: headerOffsets[1], left: 0, height: headerHeights[1], zIndex: 32 }}>{renderArea('values', { overflowX: 'auto' })}</th>
          <th colSpan={dataSpan} className={styles.areaHead} style={{ top: headerOffsets[1], height: headerHeights[1] }}>
            <div className={styles.areaStick} style={{ left: rowHeaderWidth, width: visibleAreaWidth ? Math.max(120, visibleAreaWidth - rowHeaderWidth) : undefined }}>{renderArea('cols', { overflowX: 'auto' })}</div>
          </th>
        </tr>
        {rightHeaderRows.map(({ cells, index }, rowIndex) => {
          const isLast = index === lastHeaderIndex;
          return <tr key={`header-${index}`} style={{ height: headerHeights[index] }}>
            {rowIndex === 0 && !isLast && <th colSpan={leadSpan} rowSpan={rightHeaderRows.length - 1} className={styles.blankHead} style={{ top: headerOffsets[index], left: 0, zIndex: 30 }} aria-hidden="true" />}
            {isLast && (fieldAreas
              ? <th colSpan={leadSpan} className={styles.areaHead} style={{ top: headerOffsets[index], left: 0, height: headerHeights[index], zIndex: 31 }}>
                {renderArea('rows', { height: '100%', overflowX: 'auto' })}
                {rowResizeHandles}
              </th>
              : noRowFields
                ? <th className={styles.fieldHead} style={{ left: 0, top: headerOffsets[index], zIndex: 30 }} />
                : dimensions.rowWidths.map((field, fieldIndex) => <th key={field.id} className={styles.fieldHead} style={{ left: dimensions.stickyOffsets[fieldIndex], top: headerOffsets[index], zIndex: 30 }}>
                  <button type="button" className={styles.headerButton} onClick={(event) => onFieldMenu?.(field.id, event)} title={`${field.label} 설정`}>{field.label}{sorts?.[field.id] === 'asc' ? ' ▲' : sorts?.[field.id] === 'desc' ? ' ▼' : ''}</button>
                  <span className={styles.resizeHandle} title="열 너비 조절 · 두 번 클릭하면 자동맞춤" onMouseDown={(event) => { event.preventDefault(); onResize?.(field.id, event.clientX, field.width); }} onDoubleClick={(event) => { event.preventDefault(); onBestFit?.(field.id); }} />
                </th>))}
            {isVirtualized && <th className={styles.columnSpacer} aria-hidden="true" style={{ top: headerOffsets[index] }} />}
            {noDataColumns && !isVirtualized && <th className={styles.axisHead} style={{ top: headerOffsets[index], height: headerHeights[index] }} />}
            {(isVirtualized ? clipPivotExeHeaderCells(cells, columnWindow.start, columnWindow.end) : cells).map((cell) => <AxisHeaderCell key={`${cell.level}-${cell.columnStart}-${cell.measure?.key || ''}`} cell={cell} dimensions={dimensions} top={headerOffsets[index]} height={headerHeights[index]} columnFields={structure.columnFields} showResize={!showMeasureRow && index === lastAxisHeaderIndex && cell.columnSpan === 1 && Boolean(dimensions.dataColumns[cell.columnStart])} onFieldMenu={onFieldMenu} onToggleColumn={onToggleColumn} onResize={onResize} onBestFit={onBestFit} onCustHeaderResize={onCustHeaderResize} />)}
            {isVirtualized && <th className={styles.columnSpacer} aria-hidden="true" style={{ top: headerOffsets[index] }} />}
          </tr>;
        })}
      </thead>;
  return <div className={styles.gridShell}>
    <div className={styles.stickyTools}>
      <div ref={topScrollRef} onScroll={onTopScroll} data-testid="pivot-exe-top-scroll" className={styles.topScroll} role="region" aria-label="피벗 표 상단 가로 이동바">
        <div className={styles.topScrollTrack} style={{ width: tableWidth }} />
      </div>
      {viewport.headerPinned && !structure.isEmpty && <div ref={pinnedHeaderRef} className={styles.pinnedHeader} data-testid="pivot-exe-pinned-header" style={{ maxHeight: '45vh' }}>
        <table className={styles.table} style={tableStyle} aria-label="고정된 피벗 열 제목">{columns}{header}</table>
      </div>}
    </div>
    <div ref={scrollRef} onScroll={onBodyScroll} data-testid="pivot-exe-scroll" className={styles.scroll} data-pivot-virtualized={isVirtualized ? 'true' : 'false'} data-pivot-total-rows={structure.bodyRows.length} data-pivot-total-columns={structure.dataColumns.length} data-selection-count={Object.keys(selections || {}).length} data-filter-active={filterActive ? 'true' : 'false'}>
      <table className={styles.table} data-testid="pivot-exe-grid" style={tableStyle}>
      {columns}{header}
      {isVirtualized
        ? <PivotExeWindowedBody structure={structure} formattedLabels={formattedLabels} rowWindow={rowWindow} columnWindow={columnWindow} windowedRowHeaders={windowedRowHeaders} onToggleRowRef={onToggleRowRef} />
        : <PivotExeBody structure={structure} formattedLabels={formattedLabels} onToggleRowRef={onToggleRowRef} />}
      </table>
    </div>
  </div>;
});

export default PivotExeGrid;
