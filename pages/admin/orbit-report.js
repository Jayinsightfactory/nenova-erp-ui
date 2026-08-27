// pages/admin/orbit-report.js
// 직원 업무 심화 리포트 뷰어 — nenovaSS3 계정 전용(민감: 직원 관측데이터).
// 게이트: getServerSideProps 에서 JWT 검증 후 UserID 불일치면 notFound(404) → 존재 자체를 숨김.
//        HTML(data/, 비공개)은 인가 통과 후에만 prop 으로 전달되고, iframe srcDoc 로 CSS 격리 렌더.
//        (별도 pages/api 라우트를 두지 않음 — ERP 계약 가드 대상 회피 + 서버측 단일 게이트로 충분)
// NO_LAYOUT(_app.js) + 메뉴 popup 항목(components/Layout.js '연동' 그룹, userIds:['nenovaSS3']).
import fs from 'fs';
import path from 'path';
import { verifyReqUser } from '../../lib/auth';
import { isOrbitReportViewer } from '../../lib/orbitReportAccess';

export async function getServerSideProps({ req }) {
  const user = verifyReqUser(req);
  if (!isOrbitReportViewer(user)) {
    return { notFound: true };
  }
  let html = '';
  try {
    html = fs.readFileSync(path.join(process.cwd(), 'data', 'orbit-report.html'), 'utf8');
  } catch {
    html = '<!doctype html><meta charset="utf-8"><body style="font-family:sans-serif;padding:24px">리포트 파일을 불러오지 못했습니다.</body>';
  }
  return { props: { userId: user.userId, html } };
}

export default function OrbitReportPage({ userId, html }) {
  return (
    <div style={{ position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column', background: '#0e1016' }}>
      <div style={{
        flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 12,
        padding: '8px 14px', background: '#171a21', color: '#e7eaf0', borderBottom: '1px solid #262b35',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Malgun Gothic", sans-serif', fontSize: 13,
      }}>
        <a href="/dashboard" style={{ color: '#5b8dff', textDecoration: 'none', fontWeight: 700 }}>← ERP</a>
        <b style={{ fontSize: 14 }}>직원 업무 심화 리포트</b>
        <span style={{ color: '#98a1b2' }}>Orbit AI · 실 관측데이터 · {userId} 전용</span>
      </div>
      <iframe
        title="직원 업무 심화 리포트"
        srcDoc={html}
        style={{ border: 'none', width: '100%', flex: '1 1 auto' }}
      />
    </div>
  );
}
