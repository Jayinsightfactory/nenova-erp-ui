// GET /api/kakao/order-feed — 카톡 발주방 최근 원문 블록 (orders/paste 프리필용, 읽기 전용)
// ─────────────────────────────────────────────────────────────────────────────
// 소스: 카카오 시트 '이벤트로그' 탭 (A시각 B방이름 C파이프라인 D발신자 E원문 F메시지ID)
//   — workflow.js:16 컬럼 계약과 동일. msgId(F열)가 유일한 신뢰 가능한 순서/중복 키
//   (시각은 "오전 10:38" 형태라 절대시각 복원 불가 — kakao-ontology 실측).
// 방 필터: workflowConfig ORDER rooms. 방이름이 인코딩 손상(U+FFFD)으로 변형되는 실측 이력이
//   있어 정확일치 금지 — 손상문자 제거 후 부분포함(양방향)으로 느슨 매칭.
// 블록: 같은 방·같은 발신자의 연속 행을 하나의 붙여넣기 블록으로 묶음(행 순서 = append 순서).
// 쿼리: ?n=블록수(기본 20, 최대 60) · ?debug=rooms → 최근 방이름 분포(매칭 실측용)
import { withAuth } from '../../../lib/auth';
import { readSheetValues, getKakaoSheetId } from '../../../lib/googleSheets';
import { PIPELINE_STAGES } from '../../../lib/workflowConfig';

const ORDER_ROOMS = (PIPELINE_STAGES.find(s => s.key === 'ORDER') || { rooms: [] }).rooms;

// 인코딩 손상 대응 느슨 매칭: U+FFFD·공백·특수문자 제거 후 어느 한쪽이 다른쪽 core를 포함하면 매칭
function roomLoose(raw, target) {
  const clean = s => String(s || '').replace(/�/g, '').replace(/[^0-9A-Za-z가-힣]/g, '');
  const a = clean(raw), b = clean(target);
  if (!a || !b) return false;
  if (a.includes(b) || b.includes(a)) return true;
  // 손상으로 중간 글자가 빠진 경우: target의 앞 4글자+뒤 4글자 포함이면 인정
  if (b.length >= 8 && a.includes(b.slice(0, 4)) && a.includes(b.slice(-4))) return true;
  return false;
}
const isOrderRoom = room => ORDER_ROOMS.some(r => roomLoose(room, r));

async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });
  try {
    const values = await readSheetValues({ spreadsheetId: getKakaoSheetId(), range: '이벤트로그!A:F' });
    const rows = (values || []).slice(1) // 헤더 제외
      .map(r => ({ time: r[0] || '', room: r[1] || '', sender: r[3] || '', text: r[4] || '', msgId: r[5] || '' }))
      .filter(r => r.text);

    if (req.query.debug === 'rooms') {
      const dist = {};
      for (const r of rows.slice(-3000)) dist[r.room] = (dist[r.room] || 0) + 1;
      const list = Object.entries(dist).sort((a, b) => b[1] - a[1])
        .map(([room, count]) => ({ room, count, matched: isOrderRoom(room) }));
      return res.json({ ok: true, rooms: list.slice(0, 40) });
    }

    const nBlocks = Math.min(parseInt(req.query.n) || 20, 60);
    // 발주방만 + 최근순 (시각 파싱 불가 → 행 순서 신뢰, workflow.js slice(-N) 패턴)
    const recent = rows.filter(r => isOrderRoom(r.room)).slice(-800);

    // 같은 방·같은 발신자 연속 행 → 블록
    const blocks = [];
    for (const r of recent) {
      const last = blocks[blocks.length - 1];
      if (last && last.room === r.room && last.sender === r.sender) {
        last.lines.push(r.text);
        last.lastMsgId = r.msgId || last.lastMsgId;
      } else {
        blocks.push({ msgId: r.msgId, lastMsgId: r.msgId, room: r.room, sender: r.sender, time: r.time, lines: [r.text] });
      }
    }
    const out = blocks.slice(-nBlocks).reverse() // 최신 먼저
      .map(b => ({ ...b, text: b.lines.join('\n'), lineCount: b.lines.length }));
    res.json({ ok: true, count: out.length, blocks: out });
  } catch (e) {
    res.status(500).json({ error: e.message, hint: '/api/kakao/diag 로 시트 연결 확인' });
  }
}

export default withAuth(handler);
