// POST /api/automation/moyi-file — MOYI 워커 확정 파일 수신 (멱등).
//
// 인증: Authorization: Bearer <MOYI_API_TOKEN>  (또는 x-moyi-token / x-automation-token)
// 본문(JSON): {
//   file_id:        string  (필수, 멱등키 — 같은 값 재전송 시 중복 저장 안 함)
//   filename:       string
//   mime:           string  (예: application/pdf)
//   content_base64: string  (필수, 파일 base64. 디코딩 후 50MB 이하)
//   meta:           object  (선택, 임의 부가정보 JSON)
//   source:         string  (선택, 예: 'moyi-worker')
// }
//
// 응답 계약(MOYI 재시도 규약과 맞물림):
//   200 { success:true, file_id, idempotent:false, moyiFileKey, sizeBytes, sha256 }      → 신규 저장 성공
//   200 { success:true, file_id, idempotent:true,  moyiFileKey, sha256Match }            → 이미 받은 파일(재시도) — 성공 취급
//   400 { success:false, error }   → 영구 오류(잘못된 본문/누락/크기초과). MOYI 재시도 금지.
//   401 { success:false, error }   → 인증 실패. 재시도 금지.
//   5xx { success:false, error }   → 일시 오류(DB 등). MOYI 는 5회 지수백오프 재시도.
//
// ⚠ 멱등 필수 이유: 네트워크 타임아웃 등으로 MOYI 가 같은 파일을 재전송해도, file_id 로 판별해
//   중복 저장하지 않는다(정확히-한-번 저장). 그래서 MOYI 는 안심하고 5회 백오프 재시도할 수 있다.
import { checkAutomationAuth } from '../../../lib/automationAuth';
import { storeMoyiFile } from '../../../lib/moyiFile';

export const config = { api: { bodyParser: { sizeLimit: '72mb' } } }; // base64 팽창(50MB→~67MB) 여유

const MAX_BYTES = 50 * 1024 * 1024;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'POST only' });

  const auth = checkAutomationAuth(req);
  if (!auth.ok) return res.status(auth.status).json({ success: false, error: auth.error });

  const b = req.body || {};
  const fileId = String(b.file_id || '').trim();
  const b64 = String(b.content_base64 || '');
  if (!fileId) return res.status(400).json({ success: false, error: 'file_id(멱등키) 필수' });
  if (fileId.length > 120) return res.status(400).json({ success: false, error: 'file_id 는 120자 이하' });
  if (!b64) return res.status(400).json({ success: false, error: 'content_base64 필수' });

  let buffer;
  try { buffer = Buffer.from(b64, 'base64'); }
  catch { return res.status(400).json({ success: false, error: 'content_base64 디코딩 실패' }); }
  if (!buffer.length) return res.status(400).json({ success: false, error: '빈 파일' });
  if (buffer.length > MAX_BYTES) return res.status(400).json({ success: false, error: `파일이 50MB 를 초과합니다 (${buffer.length} bytes)` });

  try {
    const r = await storeMoyiFile({
      fileId, filename: b.filename, mime: b.mime, buffer, meta: b.meta, source: b.source,
    });
    return res.status(200).json({ success: true, file_id: fileId, ...r });
  } catch (e) {
    // DB 등 일시 오류 → 5xx 로 반환해 MOYI 가 재시도(멱등이라 안전)
    return res.status(500).json({ success: false, error: 'DB 저장 실패(일시): ' + e.message });
  }
}
