// pages/api/work/manuals.js
// 직원 업무 매뉴얼 API — 웹 전용 JSON 파일만 읽고 씀(MSSQL 무관).
// GET  → 내가 볼 수 있는 매뉴얼 + 부서표 + 내 배치
// POST { action:'save', id, steps, summary, confirm } | { action:'layout', key, order } | { action:'routineConfirm', id, status, note }
// handover: 수입부 인수인계 업무표(하루·주·월)+새 기준 매뉴얼. 저장소 파일만 읽음. 로그인 직원 전원 열람(새 직원 인수인계용).
// routines: 부서별 신입 루틴(하루·주간·월간·메일·넘김·현장팀). 관찰 패턴 집계라 로그인 직원 전원 열람(신입 온보딩용).
import { withAuth } from '../../../lib/auth';
import { getRoutines, confirmRoutineItem } from '../../../lib/workManualRoutines';
import fs from 'fs';
import { importHandoverForView } from '../../../lib/importHandover';
import { featureFilePath } from '../../../lib/workFeatureData';

// 계기 사슬: 사장님 PC 의 매일 분석이 올린 갱신본(import-triggers)이 있으면 그것으로 바꿔 끼운다.
function handoverWithLiveTriggers() {
  const h = importHandoverForView();
  if (!h?.education) return h;
  try {
    const p = featureFilePath('import-triggers');
    if (p && fs.existsSync(p)) { const live = JSON.parse(fs.readFileSync(p, 'utf8')); if (Array.isArray(live?.chains) && live.chains.length) h.education.triggers = { ...live, live: true }; }
  } catch { /* 갱신본을 못 읽으면 저장소에 든 것을 그대로 쓴다 */ }
  return h;
}
// 단계별 화면 캡처: 사장님 PC 가 올린 갱신본(import-captures)이 있으면 단계에 붙인다.
// 그림은 저장소에 넣지 않는다(실제 업무 화면이라 코드 기록에 남기지 않고, 올린 파일만 바꾸면 내릴 수 있게).
function handoverWithCaptures() {
  const h = handoverWithLiveTriggers();
  if (!h?.manuals) return h;
  try {
    const p = featureFilePath('import-captures');
    if (p && fs.existsSync(p)) {
      const cap = JSON.parse(fs.readFileSync(p, 'utf8'));
      h.captureInfo = { generatedAt: cap.generatedAt || null, clarity: cap.clarity === 'clear' ? 'clear' : 'blurred' };
      h.manuals = h.manuals.map((m) => ({
        ...m,
        steps: m.steps.map((s) => {
          const c = cap.captures?.[m.id]?.[String(s.no)];
          return c?.img && /^data:image\/(jpeg|png);base64,/.test(c.img) ? { ...s, capture: { img: c.img, w: c.w || null, h: c.h || null, observedAt: c.observedAt || null } } : s;
        }),
      }));
    }
  } catch { /* 갱신본을 못 읽으면 글 단계만 보여 준다 */ }
  // 강의형 설명 영상 목차(import-lectures): 영상 본체는 /api/work/manual-lecture?id= 로 따로 받는다
  try {
    const p = featureFilePath('import-lectures');
    if (p && fs.existsSync(p)) {
      const idx = JSON.parse(fs.readFileSync(p, 'utf8'));
      h.manuals = h.manuals.map((m) => {
        const l = idx.lectures?.[m.id];
        return l && Array.isArray(l.chapters) ? { ...m, lecture: { seconds: l.seconds || null, chapters: l.chapters.map((c) => ({ title: String(c.title || ''), start: Number(c.start) || 0 })), madeAt: l.madeAt || idx.generatedAt || null } } : m;
      });
    }
  } catch { /* 목차를 못 읽으면 영상 없이 보여 준다 */ }
  return h;
}
import { DEPARTMENTS, isManualAdmin, visibleManuals, getLayout, saveManualEdit, saveLayout } from '../../../lib/workManuals';

export default withAuth(async function handler(req, res) {
  const user = req.user;
  if (req.method === 'GET') {
    return res.status(200).json({
      success: true,
      isAdmin: isManualAdmin(user),
      me: user.userName || user.userId,
      departments: DEPARTMENTS,
      manuals: visibleManuals(user),
      layout: getLayout(user),
      routines: getRoutines(),
      handover: handoverWithCaptures(),
    });
  }
  if (req.method === 'POST') {
    const body = req.body || {};
    if (body.action === 'save') {
      const r = saveManualEdit(user, String(body.id || ''), body);
      return r.ok ? res.status(200).json({ success: true, manual: r.manual }) : res.status(r.status).json({ success: false, error: r.error });
    }
    if (body.action === 'layout') {
      return saveLayout(user, body.key, body.order)
        ? res.status(200).json({ success: true })
        : res.status(400).json({ success: false, error: '잘못된 배치 요청' });
    }
    if (body.action === 'routineConfirm') {
      const r = confirmRoutineItem(user, body.id, body);
      return r.ok ? res.status(200).json({ success: true, id: r.id, confirm: r.confirm }) : res.status(r.status).json({ success: false, error: r.error });
    }
    return res.status(400).json({ success: false, error: '알 수 없는 action' });
  }
  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ success: false, error: 'Method not allowed' });
});
