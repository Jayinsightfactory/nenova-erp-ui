// pages/api/kakao/diag.js
// 카카오 Google Sheet 연결 진단 (읽기 전용, 시크릿 노출 없음).
//   GET → 환경변수 존재여부 / 서비스계정 이메일 / 시트ID / 각 탭 1~2행 읽기 테스트 결과.
import { withAuth } from '../../../lib/auth';
import { getKakaoSheetId, readSheetValues } from '../../../lib/googleSheets';

function svcEmail() {
  try {
    const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || process.env.KAKAO_GOOGLE_SERVICE_ACCOUNT_JSON || process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON || '';
    if (!raw.trim()) return null;
    const j = JSON.parse(raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8'));
    return j.client_email || null;
  } catch { return null; }
}

async function handler(req, res) {
  const env = {
    serviceAccountSet: !!(process.env.GOOGLE_SERVICE_ACCOUNT_JSON || process.env.KAKAO_GOOGLE_SERVICE_ACCOUNT_JSON || process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON),
    serviceAccountEmail: svcEmail(),       // 시트에 이 이메일을 공유했어야 함
    sheetIdSet: !!(process.env.KAKAO_SHEET_ID || process.env.GOOGLE_SHEET_URL),
    sheetId: getKakaoSheetId(),
  };

  const tabs = {};
  for (const name of ['비즈니스이벤트', '이벤트로그', '의사결정추적']) {
    try {
      const v = await readSheetValues({ spreadsheetId: env.sheetId, range: `${name}!A1:A3` });
      tabs[name] = { ok: true, rows: (v || []).length };
    } catch (e) { tabs[name] = { ok: false, error: e.message }; }
  }

  const allOk = env.serviceAccountSet && Object.values(tabs).every(t => t.ok);
  let hint = '';
  if (!env.serviceAccountSet) hint = '서버에 GOOGLE_SERVICE_ACCOUNT_JSON 환경변수가 없습니다. (연결 안 됨)';
  else if (!allOk) {
    const firstErr = Object.values(tabs).find(t => !t.ok)?.error || '';
    if (/permission|PERMISSION|403/.test(firstErr)) hint = `시트가 서비스계정(${env.serviceAccountEmail})에 공유되지 않았습니다. 시트 공유에 이 이메일을 뷰어로 추가하세요.`;
    else if (/token|invalid_grant|JWT|401/.test(firstErr)) hint = '서비스계정 키가 만료/폐기됐을 수 있습니다. 키를 재발급해 env를 갱신하세요.';
    else hint = `시트 조회 실패: ${firstErr}`;
  } else hint = '정상 연결됨.';

  return res.status(200).json({ success: true, connected: allOk, env, tabs, hint });
}

export default withAuth(handler);
