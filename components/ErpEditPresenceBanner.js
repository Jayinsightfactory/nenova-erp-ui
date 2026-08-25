export default function ErpEditPresenceBanner({ presence, compact = false }) {
  if (!presence?.validScope) return null;
  let message = '';
  let color = '#b45309';
  let background = '#fffbeb';
  if (presence.stale) {
    message = 'nenova.exe 또는 다른 화면에서 값이 변경되었습니다. 새로고침 후 다시 확인하세요.';
    color = '#b91c1c'; background = '#fef2f2';
  } else if (presence.locked) {
    message = `${presence.ownerName || '다른 사용자'}님이 ${presence.scope.year}년 ${presence.scope.week} 이 업체를 작업 중입니다.`;
    color = '#b45309'; background = '#fffbeb';
  } else if (presence.error) {
    message = `작업 상태를 확인하지 못해 저장을 잠시 막았습니다. ${presence.error}`;
    color = '#b91c1c'; background = '#fef2f2';
  } else if (presence.loading) {
    message = '이 업체의 작업 상태를 확인 중입니다.';
  }
  if (!message) return null;
  return <div role="alert" style={{ margin: compact ? '3px 0' : '8px 0', padding: compact ? '4px 7px' : '8px 10px', border: `1px solid ${color}44`, background, color, fontSize: compact ? 11 : 12, fontWeight: 700, lineHeight: 1.45 }}>{message}</div>;
}
