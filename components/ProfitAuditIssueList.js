// components/ProfitAuditIssueList.js — 매출이익 보고서 경고를 "요약 한 줄 + 펼치면 상세" 목록으로 표시.
// 상세(detail)는 lib/profitReportAuditDetails.js가 만든다: 무엇이 없고/있는지(현재값), 영향 열·금액, 고칠 화면.
// detail이 없는 이슈(예: 확정 스냅샷의 과거 이슈)는 기존 문장을 그대로 보여준다.

const STATUS_STYLE = {
  missing: { color: '#b91c1c', mark: '✗ 없음' },
  present: { color: '#047857', mark: '✓ 있음' },
  info: { color: '#64748b', mark: '·' },
};

export default function ProfitAuditIssueList({ items = [], columnLabels = {}, humanize = (m) => m, onFix }) {
  return (
    <ul style={{ margin: '4px 0 0', paddingLeft: 0, listStyle: 'none', maxHeight: 420, overflowY: 'auto' }}>
      {items.map((issue, i) => {
        const d = issue.detail;
        const cols = (issue.columns || []).map((col) => columnLabels[col] || col).join(' · ');
        if (!d) {
          return (
            <li key={`${issue.code}-${issue.category}-${i}`} style={{ padding: '3px 0' }}>
              <b>{issue.category}</b>{cols && <span style={{ color: '#78716c' }}> ({cols})</span>} {humanize(issue.message)}
            </li>
          );
        }
        return (
          <li key={`${issue.code}-${issue.category}-${i}`} style={{ padding: '3px 0', borderBottom: '1px dashed #fde68a' }}>
            <details>
              <summary style={{ cursor: 'pointer' }} data-audit-code={issue.code}>
                <b>{issue.category}</b>{cols && <span style={{ color: '#78716c' }}> ({cols})</span>} {d.summary}
                {d.impact?.amount != null && <span style={{ color: '#b45309', fontWeight: 700 }}> · 영향 약 {Math.round(d.impact.amount).toLocaleString('ko-KR')}원</span>}
              </summary>
              <div style={{ margin: '6px 0 6px 14px', fontSize: 12, color: '#334155' }}>
                {(d.sections || []).map((sec, si) => (
                  <div key={si} style={{ marginBottom: 6 }}>
                    <div style={{ fontWeight: 700, color: sec.status === 'missing' ? '#b91c1c' : '#334155' }}>{sec.title}</div>
                    <table style={{ borderCollapse: 'collapse', marginTop: 2 }}>
                      <tbody>
                        {(sec.items || []).map((it, ii) => {
                          const stl = STATUS_STYLE[it.status] || STATUS_STYLE.info;
                          return (
                            <tr key={ii}>
                              <td style={{ padding: '1px 8px 1px 0', color: stl.color, whiteSpace: 'nowrap', fontWeight: 700 }}>{stl.mark}</td>
                              <td style={{ padding: '1px 8px 1px 0' }}>{it.label}</td>
                              <td style={{ padding: '1px 8px 1px 0', fontWeight: 600 }}>{it.value}</td>
                              <td style={{ padding: '1px 0', color: '#64748b' }}>{it.compare ? `비교 ${it.compare}` : ''}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ))}
                {d.impact?.text && (
                  <div style={{ marginTop: 4 }}>
                    <b>영향{d.impact.columns?.length ? ` (${d.impact.columns.map((c) => columnLabels[c] || c).join('·')})` : ''}:</b> {d.impact.text}
                  </div>
                )}
                <div style={{ marginTop: 4, color: '#78716c' }}>원문: {humanize(issue.message)}</div>
                {d.fix && (
                  <div style={{ marginTop: 6, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    {onFix && (
                      <button type="button" onClick={() => onFix(d.fix)}
                        style={{ padding: '4px 10px', background: '#1d4ed8', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 700, fontSize: 12 }}>
                        {d.fix.label}
                      </button>
                    )}
                    {d.fix.href && (
                      <a href={d.fix.href} target="_blank" rel="noreferrer" style={{ fontSize: 12 }}>새 창에서 열기 ↗</a>
                    )}
                  </div>
                )}
              </div>
            </details>
          </li>
        );
      })}
    </ul>
  );
}
