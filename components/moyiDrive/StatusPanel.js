// empty/loading/error/403/503 상태를 한 가지 모양으로 통일한다.
// lib/moyiDriveViewModel.js 의 *StatusPanel() 함수들이 만든 {tone, role, title, lines} 를 그대로 그린다.
const TONE_CLASS = { amber: 'banner-warn', red: 'banner-err', blue: 'banner-info', green: 'banner-ok', gray: 'banner-info' };

export default function StatusPanel({ panel }) {
  if (!panel) return null;
  const { tone, role, title, lines } = panel;
  const isAlert = role === 'alert';
  return (
    <div
      className={`moyi-status-panel ${TONE_CLASS[tone] || 'banner-info'}`}
      role={role || 'status'}
      aria-live={isAlert ? 'assertive' : 'polite'}
    >
      <div className="moyi-status-panel-title">{title}</div>
      <div className="moyi-status-panel-lines">
        {(lines || []).map((line) => (
          <div key={line.label} className="moyi-status-panel-line">
            <span className="moyi-status-panel-label">{line.label}</span>
            <span className="moyi-status-panel-text">{line.text}</span>
          </div>
        ))}
      </div>
      <style jsx>{`
        .moyi-status-panel { padding: 6px 8px; margin-bottom: 4px; }
        .moyi-status-panel-title { font-weight: bold; font-size: 12px; margin-bottom: 3px; }
        .moyi-status-panel-lines { display: flex; flex-direction: column; gap: 2px; }
        .moyi-status-panel-line { display: flex; gap: 6px; font-size: 12px; line-height: 1.45; }
        .moyi-status-panel-label { flex: 0 0 auto; font-weight: bold; white-space: nowrap; }
        .moyi-status-panel-text { flex: 1 1 auto; }
        @media (max-width: 768px) {
          .moyi-status-panel-line { flex-direction: column; gap: 0; }
          .moyi-status-panel-text { font-size: 13px; }
        }
      `}</style>
    </div>
  );
}
