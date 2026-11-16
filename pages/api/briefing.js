// GET /api/briefing — 아침 브리핑 카드 묶음(읽기 전용).
// 데스크톱 홈처럼 화면에서 여러 조회를 직접 부를 수 없는 곳을 위한 한 번짜리 창구.
//   - 새 SQL·새 계산식 없음: 로그인한 사람의 쿠키 그대로 기존 조회 API(GET)를 서버 안에서 불러
//     lib/morningBriefing.js 로 카드로만 바꾼다. 그래서 숫자·권한은 각 원본 화면과 같다.
//   - 관리자 전용 조회는 관리자일 때만 부른다. 조회 실패 항목은 '확인 못 함' 카드로 내려간다.
//   - 어떤 원장도 쓰지 않는다(GET 전용, 내부 호출도 전부 GET).
import { withAuth } from '../../lib/auth';
import { isAdminUser } from '../../lib/userAccess';
import { BRIEFING_SOURCES, buildBriefing, todayKst } from '../../lib/morningBriefing';

const TIMEOUT_MS = 12000;

async function readSource(source, headers) {
  const url = `http://127.0.0.1:${process.env.PORT || 3000}${source.path}`;
  try {
    const response = await fetch(url, { method: 'GET', headers, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(TIMEOUT_MS) });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data || data.success === false) {
      return { ok: false, status: response.status, error: data?.error || `조회 실패 (${response.status})` };
    }
    return { ok: true, data };
  } catch (error) {
    return { ok: false, status: 0, error: error?.name === 'TimeoutError' ? '응답이 늦어 불러오지 못했습니다' : '연결 실패' };
  }
}

async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ success: false, error: 'GET only' });
  }
  const token = req.cookies?.nenovaToken;
  if (!token) return res.status(401).json({ success: false, error: '로그인 쿠키가 필요합니다.' });
  const isAdmin = isAdminUser(req.user);
  const sources = BRIEFING_SOURCES.filter((source) => isAdmin || !source.adminOnly);
  // 기기 세션 갱신 규칙(데스크톱은 갱신 안 함)이 화면에서 직접 부를 때와 같도록 user-agent 도 그대로 넘긴다.
  const headers = { cookie: `nenovaToken=${token}`, 'user-agent': String(req.headers['user-agent'] || '') };
  const entries = await Promise.all(sources.map(async (source) => [source.id, await readSource(source, headers)]));
  const briefing = buildBriefing(Object.fromEntries(entries), { today: todayKst(), isAdmin });
  return res.status(200).json({ success: true, ownerId: req.user?.userId || '', generatedAt: new Date().toISOString(), ...briefing });
}

export default withAuth(handler);
