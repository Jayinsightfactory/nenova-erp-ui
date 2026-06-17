// 드래그로 줄 단위 제외 — AI·매칭에서 무시
import { useRef, useState } from 'react';
import { lineIndicesInRange, toggleExcludedLines } from '../../lib/pasteExcludeText';

export default function PasteExcludeHighlight({
  text,
  excludedLines = [],
  onExcludedLinesChange,
  title = '제외 하이라이트',
  hint = '드래그로 선택한 줄은 AI·품목매칭에서 제외됩니다.',
}) {
  const lines = String(text || '').split('\n');
  const dragRef = useRef(null);
  const [hoverLine, setHoverLine] = useState(null);

  const finishDrag = (endIdx) => {
    const start = dragRef.current;
    dragRef.current = null;
    setHoverLine(null);
    if (start == null || endIdx == null) return;
    const indices = lineIndicesInRange(start, endIdx);
    onExcludedLinesChange?.(toggleExcludedLines(excludedLines, indices));
  };

  const excludedSet = new Set(excludedLines || []);

  return (
    <div style={{ border: '1px solid #cfd8dc', borderRadius: 6, background: '#fff', marginTop: 8 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', padding: '6px 10px', borderBottom: '1px solid #eceff1', fontSize: 11 }}>
        <strong style={{ color: '#455a64' }}>{title}</strong>
        <span style={{ color: '#78909c' }}>{hint}</span>
        {excludedSet.size > 0 && (
          <button
            type="button"
            onClick={() => onExcludedLinesChange?.([])}
            style={{ marginLeft: 'auto', fontSize: 10, padding: '2px 8px', border: '1px solid #b0bec5', borderRadius: 4, background: '#fff', cursor: 'pointer' }}
          >
            제외 {excludedSet.size}줄 해제
          </button>
        )}
      </div>
      <div
        style={{ maxHeight: 280, overflow: 'auto', padding: '4px 0', fontFamily: 'monospace', fontSize: 13, lineHeight: 1.5, userSelect: 'none' }}
        onMouseLeave={() => { if (dragRef.current != null) finishDrag(hoverLine); }}
      >
        {lines.map((line, i) => {
          const excluded = excludedSet.has(i);
          const inDrag = dragRef.current != null && hoverLine != null
            && i >= Math.min(dragRef.current, hoverLine)
            && i <= Math.max(dragRef.current, hoverLine);
          return (
            <div
              key={i}
              onMouseDown={(e) => { e.preventDefault(); dragRef.current = i; setHoverLine(i); }}
              onMouseEnter={() => { if (dragRef.current != null) setHoverLine(i); }}
              onMouseUp={() => finishDrag(i)}
              style={{
                padding: '1px 10px 1px 8px',
                borderLeft: `4px solid ${excluded ? '#9e9e9e' : inDrag ? '#ff6f00' : 'transparent'}`,
                background: excluded ? '#eeeeee' : inDrag ? '#fff3e0' : 'transparent',
                color: excluded ? '#757575' : '#263238',
                textDecoration: excluded ? 'line-through' : 'none',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all',
                cursor: 'crosshair',
              }}
              title={excluded ? '제외됨 — 클릭·드래그로 해제' : '드래그하여 제외'}
            >
              {line === '' ? '\u00a0' : line}
              {excluded ? <span style={{ marginLeft: 8, fontSize: 10, color: '#9e9e9e', fontWeight: 700 }}>제외</span> : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
