// pages/api/pm/requests/ack.js
// 사장님 PC PM 루프가 요청 처리 상태를 돌려준다 — POST {id, status:'processing'|'done'|'failed', result:{draftId?,mode,clicks,steps,humanStops,reason?,message}}
// 인증: ORBIT_DRIVE_INGEST_TOKEN(bearer). data/runtime/pm-requests.json 만 갱신(파일 전용, MSSQL 무관).
import { ingestTokenOk, ackRequest } from '../../../../lib/pmRequests';
import { pmUpdateStaffRequest } from '../../../../lib/pmStaffRequests';
// kind:'staff' → 직원 요청 글 상태·진행 로그·답변·PR 갱신 {id,status?,log?,answer?,pr?,dupOf?,route?}

export default function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ success: false, error: 'POST only' }); }
  const t = ingestTokenOk(req);
  if (!t.ok) return res.status(t.status).json({ success: false, error: t.error });
  const r = req.body?.kind === 'staff' ? pmUpdateStaffRequest(req.body) : ackRequest(req.body || {});
  if (!r.ok) return res.status(r.status).json({ success: false, error: r.error });
  return res.status(200).json({ success: true, request: r.request });
}
