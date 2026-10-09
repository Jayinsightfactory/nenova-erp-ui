// POST /api/ecount/ingest — ECOUNT 스크래핑 결과 적재(+검증). 스크래퍼(Chrome/Playwright)가 호출.
// body: { dataset, rows[], screenTotal?, screenRowCnt?, periodFrom, periodTo, source?, note? }
// 인증: ① Authorization: Bearer <MOYI_API_TOKEN|AUTOMATION_API_TOKEN> (상주 데몬용, 쿠키 불필요)
//       ② 그 헤더가 없으면 기존 로그인 세션(withAuth) 폴백(브라우저에서 수동 호출용)
import { withAuth } from '../../../lib/auth';
import { withActionLog } from '../../../lib/withActionLog';
import { ingestEcount, DATASETS } from '../../../lib/ecountIngest';
import crypto from 'crypto';
import { checkAutomationAuth, getAutomationToken } from '../../../lib/automationAuth';

// 2026-10-08: 사장님 PC 상주 수집 데몬은 Orbit 이 내려주는 업무 드라이브 토큰(ORBIT_DRIVE_INGEST_TOKEN)만 갖는다.
//   이 엔드포인트(ECOUNT 적재)에 한해 그 토큰도 허용 — 다른 자동화 엔드포인트(automation/*)의 인증 범위는 그대로.
function driveTokenOk(req) {
  const want = process.env.ORBIT_DRIVE_INGEST_TOKEN, got = getAutomationToken(req);
  if (!want || !got) return false;
  const a = Buffer.from(got), b = Buffer.from(want);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function core(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });
  const { dataset, rows, screenTotal, screenRowCnt, periodFrom, periodTo, source, note } = req.body || {};
  if (!DATASETS[dataset]) return res.status(400).json({ success: false, error: `dataset 필요: ${Object.keys(DATASETS).join('/')}` });
  if (!Array.isArray(rows)) return res.status(400).json({ success: false, error: 'rows 배열 필요' });
  try {
    const actor = req.user?.userName || req.user?.userId || 'scraper';
    const r = await ingestEcount({ dataset, rows, screenTotal, screenRowCnt, periodFrom, periodTo, actor, source: source || 'chrome', note });
    return res.status(200).json({ success: true, ...r });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
}

const LOG_OPTS = { actionType: 'ECOUNT_INGEST', affectedTable: 'WebEcountSnapshot/WebEcountRow', riskLevel: 'LOW' };
const cookieAuthed = withAuth(withActionLog(core, LOG_OPTS));
const tokenAuthed = withActionLog(core, LOG_OPTS);

export default function handler(req, res) {
  // 토큰 헤더가 있으면 토큰 인증(상주 데몬). 없으면 로그인 세션 폴백.
  if (getAutomationToken(req)) {
    if (!driveTokenOk(req)) {
      const a = checkAutomationAuth(req);
      if (!a.ok) return res.status(a.status).json({ success: false, error: a.error });
    }
    req.user = { userId: 'ecount-scraper', userName: 'ecount-scraper' };
    return tokenAuthed(req, res);
  }
  return cookieAuthed(req, res);
}
// 2026-10-09: 판매현황 8,157행(10/9 00:42) 전송 시 HTTP 413(Next 기본 1MB) → 상한 확대. 행 수가 커도 적재되게.
export const config = { api: { bodyParser: { sizeLimit: '20mb' } } };
