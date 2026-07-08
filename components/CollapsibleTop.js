// 접이식 상단 밴드 — 시트형 화면에서 상단(업로드/KPI/로그 등)을 접어 시트에 세로 공간을 몰아준다.
// - 접힘 상태를 localStorage 에 페이지별 기억
// - 창 높이가 낮으면(<800px) 기본 접힘으로 시작
// - 접어도 children 은 display:none 으로만 숨김 → 파일 input·검증 상태 유지
import { useEffect, useState } from 'react';

export default function CollapsibleTop({ storageKey, summary = null, children }) {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    let init = null;
    try {
      const saved = localStorage.getItem(`nvTopCollapse:${storageKey}`);
      if (saved != null) init = saved === '1';
    } catch { /* ignore */ }
    if (init == null) init = window.innerHeight < 800;
    setCollapsed(init);
  }, [storageKey]);

  const toggle = () => {
    setCollapsed(prev => {
      const next = !prev;
      try { localStorage.setItem(`nvTopCollapse:${storageKey}`, next ? '1' : '0'); } catch { /* ignore */ }
      return next;
    });
  };

  return (
    <div style={{ marginBottom: collapsed ? 8 : 0 }}>
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          background: collapsed ? '#eef2ff' : 'transparent',
          border: collapsed ? '1px solid #c7d2fe' : 'none',
          borderRadius: 8,
          padding: collapsed ? '5px 10px' : '0 0 4px',
          minHeight: 26,
        }}
      >
        {collapsed && (
          <span style={{ fontSize: 12, color: '#3730a3', fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {summary || '상단 영역 접힘'}
          </span>
        )}
        <button
          type="button"
          onClick={toggle}
          style={{
            marginLeft: 'auto', flexShrink: 0, cursor: 'pointer',
            border: '1px solid #94a3b8', borderRadius: 6, background: '#fff',
            fontSize: 11, fontWeight: 800, color: '#334155', padding: '3px 10px',
          }}
          title={collapsed ? '상단 영역 펼치기' : '상단 영역을 접어 시트를 크게 봅니다'}
        >
          {collapsed ? '⌄ 상단 펼치기' : '⌃ 상단 접기'}
        </button>
      </div>
      <div style={{ display: collapsed ? 'none' : 'block' }}>{children}</div>
    </div>
  );
}
