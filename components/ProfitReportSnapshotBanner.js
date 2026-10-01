// 매출이익 보고서 계산 결과 스냅샷 상태 배너 — 확정됨(변경 없음) / 원천 변경 감지(무엇이) / 최신화 중.
// 서버: lib/profitReportSnapshot.js (GET 읽기 전용, POST snapshotRefresh 가 새 버전 저장).
const fmtAt = (iso) => {
  if (!iso) return '-';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? String(iso) : d.toLocaleString('ko-KR', { hour12: false });
};

const box = (bg, border, color) => ({
  background: bg, border: `1px solid ${border}`, color, borderRadius: 8, padding: '8px 12px',
  fontSize: 12.5, marginBottom: 8, lineHeight: 1.6, display: 'flex', gap: 10, alignItems: 'flex-start', flexWrap: 'wrap',
});
const btn = { border: '1px solid #cbd5e1', background: '#fff', borderRadius: 6, padding: '3px 10px', fontSize: 12, fontWeight: 700, cursor: 'pointer' };

export default function ProfitReportSnapshotBanner({ snapshot, busy = false, lastResult = null, onRefresh }) {
  if (!snapshot || snapshot.state === 'disabled') return null;
  const refreshBtn = (
    <button type="button" style={btn} onClick={onRefresh} disabled={busy}
      title="원천(출고·입고·재고·입력값)으로 지금 다시 계산해 새 버전으로 저장합니다. 이전 버전은 이력에 남습니다.">
      {busy ? '최신화 중…' : '🔄 최신화'}
    </button>
  );
  if (snapshot.state === 'fresh' || (snapshot.state === 'computed' && !busy)) {
    const changedNote = snapshot.state === 'computed' && lastResult
      ? (snapshot.changedFromPrev === false ? ' · 다시 계산했지만 결과 변경 없음' : ` · 새 버전 v${snapshot.versionNo} 저장${snapshot.previousVersionNo ? ` (이전 v${snapshot.previousVersionNo}과 결과 다름)` : ''}`)
      : '';
    return (
      <div style={box('#ecfdf5', '#86efac', '#065f46')} data-testid="profit-snapshot-fresh">
        <span>✅ <b>확정됨(변경 없음)</b> · 저장 {fmtAt(snapshot.savedAt)} · v{snapshot.versionNo}{changedNote}
          <span style={{ color: '#047857', fontWeight: 400 }}> — 원천 변경이 없어 저장된 계산 결과를 바로 보여 줍니다.</span></span>
        <span style={{ marginLeft: 'auto' }}>{refreshBtn}</span>
      </div>
    );
  }
  const changes = snapshot.changes || [];
  const title = snapshot.state === 'missing' ? '처음 계산한 차수 — 저장 중' : '원천 변경 감지';
  return (
    <div style={box('#fff7ed', '#fdba74', '#9a3412')} data-testid="profit-snapshot-stale">
      <div style={{ flex: '1 1 320px' }}>
        ⚠ <b>{title}</b>{snapshot.savedAt ? ` · 표시값은 ${fmtAt(snapshot.savedAt)} 저장본(v${snapshot.versionNo})` : ''}
        {busy ? ' · 다시 계산 중(끝나면 자동 반영)…' : ''}
        {changes.length > 0 && (
          <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
            {changes.slice(0, 8).map((c) => <li key={c.key}>{c.text}</li>)}
            {changes.length > 8 && <li>외 {changes.length - 8}건</li>}
          </ul>
        )}
      </div>
      <span style={{ marginLeft: 'auto' }}>{refreshBtn}</span>
    </div>
  );
}
