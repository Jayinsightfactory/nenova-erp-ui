// pages/api/work/live-pipelines.js — /work/manuals 라이브 매뉴얼(작업 유형별 대표 단계 경로 + 마스킹 캡처). 파일만 읽고 씀(MSSQL 무관).
// GET            → 작업 목록(이미지 없음)
// GET ?id=<id>   → 작업 1건(단계별 캡처 data URI 포함)
// POST { action:'confirm', id, status: confirmed|wrong|clear, note } → 직원 확인(_state.json, 재생성이 덮어쓰지 않음)
// 열람: 로그인 직원 전원(관찰 패턴 집계·캡처는 생성기에서 개인정보 블러 완료).
import { withAuth } from '../../../lib/auth';
import { listLivePipelines, getLivePipeline, confirmLivePipeline } from '../../../lib/workLivePipelines';

export default withAuth(async function handler(req, res) {
  if (req.method === 'GET') {
    const id = String(req.query.id || '');
    if (id) {
      const t = getLivePipeline(id);
      return t ? res.status(200).json({ success: true, task: t }) : res.status(404).json({ success: false, error: '작업 없음' });
    }
    return res.status(200).json({ success: true, data: listLivePipelines() });
  }
  if (req.method === 'POST') {
    const body = req.body || {};
    if (body.action !== 'confirm') return res.status(400).json({ success: false, error: '알 수 없는 action' });
    const r = confirmLivePipeline(req.user, body.id, body);
    return r.ok ? res.status(200).json({ success: true, id: r.id, confirm: r.confirm }) : res.status(r.status).json({ success: false, error: r.error });
  }
  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ success: false, error: 'Method not allowed' });
});
