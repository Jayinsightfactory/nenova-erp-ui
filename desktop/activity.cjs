'use strict';
const { randomUUID } = require('node:crypto');
const LABELS = Object.freeze({ open:'업무 탭 열기', activate:'탭 선택', close:'탭 닫기', reorder:'탭 순서 변경', move:'탭 이동', detach:'탭 분리', dragEnd:'탭 드래그', menu:'홈 메뉴', tools:'도구 표시', menuFavorite:'메뉴 즐겨찾기', favorite:'즐겨찾기', rename:'탭 이름 변경', navigate:'이전·다음 화면', reload:'새로고침', zoom:'확대·축소', print:'인쇄', newWindow:'새 창', closeWindow:'창 닫기', quit:'앱 종료', appUpdate:'앱 업데이트', cancelUpdate:'업데이트 취소', sync:'메뉴 동기화', homeWorkspace:'내 업무 처리' });
const EXTRA = Object.freeze({ confirmAccepted:'확인창 확인', confirmCanceled:'확인창 취소', homeCreate:'내 업무 추가', homeUpdate:'내 업무 수정', homeComplete:'내 업무 완료 변경', homeArchive:'내 업무 보관', homeRestore:'내 업무 복원', homeStop:'내 업무 반복 중지', homeRead:'전달 내용 확인' });
// Main-only, encrypted on disk by the injected writer. No payload/input values.
function createActivity({ read, write, fetch, owner, endpoint, warn = () => {} }) {
  let rows = [], running = false;
  const sessionId = randomUUID();
  try { const saved = read(); if (Array.isArray(saved)) rows = saved.filter(r => typeof r?.owner === 'string' && typeof r?.event?.id === 'string' && r.event.kind === 'desktop').slice(0, 10000); } catch { warn('PC 작업 기록 보관함을 읽지 못했습니다.'); }
  function persist() { try { write(rows); return true; } catch { warn('PC 작업 기록을 보관하지 못했습니다. 디스크 상태를 확인하세요.'); return false; } }
  function record(action, route) {
    const user = owner();
    if (!user || !(LABELS[action] || EXTRA[action])) return;
    if (rows.length >= 10000) { warn('PC 작업 기록 보관함이 가득 찼습니다. 기록 전송 상태를 확인하세요.'); return; }
    let path = '/desktop';
    try { const u = new URL(route || '/', 'https://nenovaweb.com'); if (u.origin === 'https://nenovaweb.com') path = u.pathname; } catch {}
    const id = randomUUID();
    rows.push({ owner:user, event:{ id, sessionId, actionId:id, clientAt:new Date().toISOString(), kind:'desktop', path, control:'desktop-command',label:LABELS[action] || EXTRA[action], outcome:'unknown' } });
    persist(); void flush();
  }
  async function flush() {
    const user = owner(); if (running || !user) return;
    const batch = rows.filter(r => r.owner === user).slice(0,50); if (!batch.length) return;
    running = true;
    try {
      const res = await fetch(endpoint, { method:'POST', credentials:'include', headers:{'Content-Type':'application/json'}, body:JSON.stringify({expectedUserId:user,events:batch.map(r=>r.event)}), signal:AbortSignal.timeout(10000) });
      if (!res.ok) throw new Error('Not acknowledged');
      const data = await res.json(); if (!data.success || !Array.isArray(data.acceptedIds)) throw new Error('Invalid acknowledgement');
      const sent = new Set(batch.map(r=>r.event.id)); const ack = new Set(data.acceptedIds.filter(id=>sent.has(id)));
      rows = rows.filter(r => r.owner !== user || !ack.has(r.event.id)); if (persist() && !rows.length) warn('');
    } catch { warn('PC 작업 기록 전송 대기 중입니다. 연결되면 다시 전송합니다.'); }
    finally { running = false; }
  }
  return {record,flush,pending:()=>rows.length};
}
module.exports = {createActivity,LABELS};
