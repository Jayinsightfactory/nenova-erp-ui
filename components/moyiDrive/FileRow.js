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
      <td className="moyi-preview-cell">
        {row.preview.available
          ? <img src={row.preview.src} alt={row.preview.alt} loading="lazy" decoding="async" />
          : <span className="moyi-file-icon" aria-label="미리보기 없음">파일</span>}
      </td>
      <td className="name">
        <span className="moyi-file-name">{row.name.value}</span>
        {row.name.tags.length > 0 && <span className="moyi-file-tags" aria-label="파일 태그">
          {row.name.tags.map((tag) => <span className="moyi-file-tag" key={tag}>#{tag}</span>)}
        </span>}
      </td>
      <td>{row.source.value}</td>
      <td className={cellClass(row.size)}>{row.size.value}</td>
      <td className={cellClass(row.modifiedAt)}>{row.modifiedAt.value}</td>
      <td><StatusBadge tone={row.status.tone}>{row.status.value}</StatusBadge></td>
      <td className={cellClass(row.permission)}>{row.permission.value}</td>
      <style jsx>{`
        tr:focus-visible { outline: 2px solid var(--blue); outline-offset: -2px; }
        .moyi-pending-cell { color: var(--text3); font-style: italic; }
        .moyi-preview-cell { width: 74px; text-align: center; }
        .moyi-preview-cell img { display: block; width: 62px; height: 48px; margin: 0 auto; object-fit: cover; border: 1px solid #c7d7ef; border-radius: 4px; background: #f4f7fb; }
        .moyi-file-icon { display: inline-flex; width: 42px; height: 42px; align-items: center; justify-content: center; border: 1px solid #cbd5e1; background: #f8fafc; color: #64748b; font-size: 10px; border-radius: 4px; }
        .moyi-file-name { display: block; font-weight: 700; }
        .moyi-file-tags { display: flex; flex-wrap: wrap; gap: 3px; margin-top: 4px; }
        .moyi-file-tag { display: inline-block; max-width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 1px 5px; border-radius: 10px; background: #e8efff; color: #174ea6; font-size: 10px; font-weight: 700; }
      `}</style>
    </tr>
  );
}
