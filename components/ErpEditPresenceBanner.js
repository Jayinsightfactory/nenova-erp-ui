export default function ErpEditPresenceBanner({ presence, compact = false, onReload = null, reloadLabel = '최신 내용 불러오기', onTakeover = null, canForceTakeover = false }) {
  if (!presence?.validScope) return null;
  let message = '';
  let color = '#b45309';
  let background = '#fffbeb';
  if (presence.stale) {
    message = onReload
      ? '현재 화면을 연 뒤 전산 값이 달라졌습니다. 아래 버튼으로 최신 내용을 불러오면 계속 작업할 수 있습니다.'
      : 'nenova.exe 또는 다른 화면에서 값이 변경되었습니다. 새로고침 후 다시 확인하세요.';
    color = '#b91c1c'; background = '#fef2f2';
  } else if (presence.locked) {
    message = presence.ownedBySameUser
      ? `같은 계정의 다른 창에서 ${presence.scope.year}년 ${presence.scope.week} 이 업체를 작업 중입니다.`
      : `${presence.ownerName || '다른 사용자'}님이 ${presence.scope.year}년 ${presence.scope.week} 이 업체를 작업 중입니다.`;
    color = '#b45309'; background = '#fffbeb';
  } else if (presence.error) {
    message = `작업 상태를 확인하지 못해 저장을 잠시 막았습니다. ${presence.error}`;
    color = '#b91c1c'; background = '#fef2f2';
  } else if (presence.loading) {
    message = '이 업체의 작업 상태를 확인 중입니다.';
  } else if (presence.blocked) {
    message = '작업권이 만료되었거나 아직 확인되지 않았습니다. 최신 내용을 다시 확인해 주세요.';
  }
  if (!message) return null;
  return <div role="alert" style={{ margin: compact ? '3px 0' : '8px 0', padding: compact ? '4px 7px' : '8px 10px', border: `1px solid ${color}44`, background, color, fontSize: compact ? 11 : 12, fontWeight: 700, lineHeight: 1.45 }}>
    {message}
    {(presence.stale || (!presence.locked && presence.blocked)) && typeof onReload === 'function' && (
      <button type="button" onClick={() => Promise.resolve(onReload()).catch(() => {})}
        disabled={presence.loading}
        style={{ marginLeft: 8, padding: compact ? '2px 6px' : '3px 8px', border: `1px solid ${color}`, borderRadius: 4, background: '#fff', color, fontWeight: 800, cursor: presence.loading ? 'wait' : 'pointer' }}>
        {reloadLabel}
      </button>
    )}
    {presence.locked && (presence.ownedBySameUser || canForceTakeover) && (
      <button type="button" onClick={() => Promise.resolve(onTakeover ? onTakeover() : presence.takeover?.()).catch(() => {})}
        disabled={presence.loading}
        style={{ marginLeft: 8, padding: compact ? '2px 6px' : '3px 8px', border: `1px solid ${color}`, borderRadius: 4, background: '#fff', color, fontWeight: 800, cursor: presence.loading ? 'wait' : 'pointer' }}>
        {onTakeover ? '작업권 인계 후 계속' : '이 창에서 계속 작업'}
      </button>
    )}
  </div>;
}
