import StatusBadge from './StatusBadge';

// lib/moyiDriveViewModel.js mapFileRowView() 출력 전용. 값을 지어내지 않고
// backend DTO에 없는 열은 pending 표시("연결대기 · ...")를 그대로 보여준다.
export default function FileRow({ row, selected, onSelect }) {
  const cellClass = (cell) => (cell.pending ? 'moyi-pending-cell' : undefined);
  return (
    <tr
      className={selected ? 'selected' : ''}
      onClick={onSelect}
      tabIndex={0}
      onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && onSelect) { e.preventDefault(); onSelect(); } }}
    >
      <td className={cellClass(row.folder)}>{row.folder.value}</td>
      <td className="name">{row.name.value}</td>
      <td>{row.source.value}</td>
      <td className={cellClass(row.size)}>{row.size.value}</td>
      <td className={cellClass(row.modifiedAt)}>{row.modifiedAt.value}</td>
      <td><StatusBadge tone={row.status.tone}>{row.status.value}</StatusBadge></td>
      <td className={cellClass(row.permission)}>{row.permission.value}</td>
      <style jsx>{`
        tr:focus-visible { outline: 2px solid var(--blue); outline-offset: -2px; }
        .moyi-pending-cell { color: var(--text3); font-style: italic; }
      `}</style>
    </tr>
  );
}
