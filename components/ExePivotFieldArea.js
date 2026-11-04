import theme from './ExePivotTheme.module.css';

const SUMMARY_LABELS = { sum:'합계', avg:'평균', weightedavg:'수량가중평균', min:'최소', max:'최대', count:'개수' };
const DEFAULT_EMPTY = { filters:'여기에 필터 필드를 놓으세요', values:'여기에 데이터 필드를 놓으세요', cols:'여기에 열 필드를 놓으세요', rows:'여기에 행 필드를 놓으세요' };
const DRAG_TYPE = 'application/x-nenova-pivot-field';

/**
 * DevExpress PivotGrid field area (filter / data / column / row header area).
 * Purely presentational: the parent owns zones, sorting, filters and drag state.
 * Row/column buttons toggle sort on click; filter/data buttons call onClickField.
 */
export default function ExePivotFieldArea({
  zone, items = [], fieldsById = {}, sorts = {}, valueFilterStates = {}, draggedField = null, dropTarget = null,
  label, emptyText, style, className,
  onDragStart, onDragOverItem, onDropZone, onDragEnd, onClickField, onFilter, onContextMenu, onSort,
}) {
  const entries = items.map((item) => (typeof item === 'string' ? { id:item } : item)).filter((item) => item && fieldsById[item.id]);
  const sortable = zone === 'rows' || zone === 'cols';
  const insertionAt = dropTarget?.zone === zone ? dropTarget.index : -1;
  const endDrop = (event) => onDropZone?.(zone, insertionAt >= 0 ? insertionAt : entries.length, event);
  const overZone = (event) => {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    if (event.target === event.currentTarget) onDragOverItem?.(zone, entries.length, event);
  };
  const openMenu = (id, event) => { event.preventDefault(); event.stopPropagation(); onContextMenu?.(id, event); };
  return <div
    data-testid={`pivot-exe-zone-${zone}`}
    role="group"
    aria-label={`${label || zone} 필드 영역`}
    data-dragging={draggedField ? 'true' : 'false'}
    data-drop-active={insertionAt >= 0 ? 'true' : 'false'}
    className={`${theme.area}${className ? ` ${className}` : ''}`}
    style={style}
    onDragEnter={overZone}
    onDragOver={overZone}
    onDrop={(event) => { event.preventDefault(); event.stopPropagation(); endDrop(event); }}
  >
    {entries.map(({ id, aggregation }, index) => {
      const field = fieldsById[id];
      const filterState = valueFilterStates[id] || { active:false, label:'전체' };
      const sort = sorts?.[id];
      return <span key={`${zone}-${id}`} style={{ display:'contents' }}>
        {insertionAt === index && <i data-testid="pivot-exe-drop-marker" aria-hidden="true" className={theme.marker} />}
        <span
          data-testid={`pivot-exe-drag-${id}`}
          draggable
          data-dragged={draggedField === id ? 'true' : 'false'}
          className={theme.drag}
          title="필드 버튼을 잡아 원하는 영역이나 순서로 끌어 놓으세요 · 오른쪽 클릭: 필드 메뉴"
          onDragStart={(event) => { event.dataTransfer.setData(DRAG_TYPE, id); event.dataTransfer.effectAllowed = 'move'; onDragStart?.(id, zone, index, event); }}
          onDragOver={(event) => {
            event.preventDefault(); event.stopPropagation();
            const rect = event.currentTarget.getBoundingClientRect();
            const before = event.clientX < rect.left + rect.width / 2;
            if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
            onDragOverItem?.(zone, index + (before ? 0 : 1), event);
          }}
          onDrop={(event) => { event.preventDefault(); event.stopPropagation(); onDropZone?.(zone, insertionAt >= 0 ? insertionAt : index, event); }}
          onDragEnd={(event) => onDragEnd?.(id, event)}
          onContextMenu={(event) => openMenu(id, event)}
        >
          <button
            type="button"
            draggable
            data-testid={`pivot-exe-field-${id}`}
            data-zone={zone}
            className={theme.field}
            title={sortable ? `${field.label} · 클릭: 정렬 전환 · 오른쪽 클릭/Shift+F10: 메뉴` : zone === 'filters' ? `${field.label} 값 선택: ${filterState.label}` : `${field.label} 설정`}
            aria-sort={sortable ? (sort === 'asc' ? 'ascending' : sort === 'desc' ? 'descending' : 'none') : undefined}
            onClick={(event) => { if (sortable) onSort?.(id, sort === 'asc' ? 'desc' : 'asc', event); else onClickField?.(id, event); }}
            onKeyDown={(event) => { if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) openMenu(id, event); }}
          >
            <span>{field.label}</span>
            {zone === 'values' && <small className={theme.aggregate}>{SUMMARY_LABELS[aggregation] || aggregation || ''}</small>}
            {sortable && sort && <span className={theme.sort} aria-hidden="true">{sort === 'asc' ? '▲' : '▼'}</span>}
          </button>
          <button
            type="button"
            draggable={false}
            data-testid={`pivot-exe-filter-${id}`}
            data-active={filterState.active ? 'true' : 'false'}
            className={theme.tool}
            title={`${field.label}에서 표시할 값${filterState.active ? `: ${filterState.label}` : ''}`}
            aria-label={`${field.label} 값 필터`}
            onClick={(event) => { event.stopPropagation(); onFilter?.(id, event); }}
          >▾</button>
          <button
            type="button"
            draggable={false}
            data-testid={`pivot-exe-menu-${id}`}
            className={theme.tool}
            title={`${field.label} 메뉴`}
            aria-label={`${field.label} 메뉴`}
            onClick={(event) => openMenu(id, event)}
          >⋯</button>
        </span>
      </span>;
    })}
    {insertionAt === entries.length && <i data-testid="pivot-exe-drop-marker" aria-hidden="true" className={theme.marker} />}
    {entries.length === 0 && <span className={theme.empty}>{emptyText || DEFAULT_EMPTY[zone]}</span>}
  </div>;
}
