// 회의정리 API — 네노바웹 전용 파일 저장만 쓴다(전산 DB·ERP 원장 읽기/쓰기 없음).
//   GET            회의 목록(?q= 검색, ?deleted=1 지운 회의) · GET ?id= 회의 한 건
//   POST organize  회의 내용을 AI로 정리해 보드 초안을 돌려준다(저장하지 않음)
//   POST save      새로 저장 또는 고쳐 저장 · trash/restore/purge 지우기·되살리기·완전히 지우기
import { withAuth } from '../../../lib/auth';
import { assertKnowledgeOrigin } from '../../../lib/operationsKnowledgeApi';
import { boardFromExtraction, validateMeta } from '../../../lib/meetingBoard';
import { extractMeetingBoard, LLM_MESSAGES } from '../../../lib/meetingBoardLlm';
import { changeMeeting, getMeeting, listMeetings, meetingActor, saveMeeting } from '../../../lib/meetingBoardStore';

export const config = { api: { bodyParser: { sizeLimit: '1mb' } } };

async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  try {
    meetingActor(req.user);
    if (req.method === 'GET') {
      if (req.query.id) return res.status(200).json({ success: true, meeting: await getMeeting(req.user, String(req.query.id)) });
      return res.status(200).json({ success: true, meetings: await listMeetings(req.user, { q: String(req.query.q || ''), deleted: req.query.deleted === '1' }) });
    }
    if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return res.status(405).json({ success: false, error: '지원하지 않는 요청입니다.' }); }
    assertKnowledgeOrigin(req);
    const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
    if (body.action === 'organize') {
      const meta = validateMeta({ title: body.title, date: body.date, attendees: body.attendees, sourceText: body.sourceText });
      if (meta.sourceText.trim().length < 20) return res.status(400).json({ success: false, error: '정리할 회의 내용을 조금 더 넣어 주세요(20자 이상).' });
      const result = await extractMeetingBoard({ ...meta, userId: req.user.userId });
      if (result.errorCode) return res.status(result.errorCode === 'RATE_LIMIT' ? 429 : 503).json({ success: false, code: 'AI_' + result.errorCode, error: LLM_MESSAGES[result.errorCode] || LLM_MESSAGES.OTHER });
      const board = boardFromExtraction(result.extraction, meta.sourceText);
      if (!board.cards.length) return res.status(422).json({ success: false, code: 'AI_EMPTY', error: '정리할 만한 내용을 찾지 못했습니다. 회의 내용을 조금 더 자세히 넣고 다시 눌러 주세요.' });
      const suggested = String(result.extraction.title || '').replace(/\s+/g, ' ').trim().slice(0, 60);
      return res.status(200).json({ success: true, board, suggestedTitle: suggested });
    }
    if (body.action === 'save') return res.status(200).json({ success: true, savedCount: 1, meeting: await saveMeeting(req.user, body) });
    if (['trash', 'restore', 'purge'].includes(body.action)) return res.status(200).json({ success: true, result: await changeMeeting(req.user, body.action, body.id) });
    return res.status(400).json({ success: false, error: '요청을 확인하세요.' });
  } catch (error) {
    if (!error.statusCode) console.error('[meeting-board] api_failed', error.code || error.name || 'ERROR'); // 원문은 남기지 않는다
    return res.status(error.statusCode || 500).json({ success: false, error: error.statusCode ? error.message : '회의정리를 처리하지 못했습니다. 잠시 뒤 다시 해 주세요.' });
  }
}

export default withAuth(handler);
