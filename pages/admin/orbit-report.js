// pages/admin/orbit-report.js
// 직원 업무 심화 리포트 뷰어 — nenovaSS3 계정 전용(민감: 직원 관측데이터).
// 게이트: getServerSideProps 에서 JWT 검증 후 UserID 불일치면 notFound(404) → 존재 자체를 숨김.
// 렌더: 리포트는 /api/admin/orbit-report(동일 게이트) 를 iframe 로 불러 CSS 격리.
// NO_LAYOUT(_app.js) + 메뉴 popup 항목(components/Layout.js '연동' 그룹, userIds:['nenovaSS3']).
import { verifyReqUser } from '../../lib/auth';
import { isOrbitReportViewer } from '../../lib/orbitReportAccess';

export async function getServerSideProps({ req }) {
  const user = verifyReqUser(req);
  if (!isOrbitReportViewer(user)) {
    return { notFound: true };
  }
  return { props: { userId: user.userId } };
}

export default function OrbitReportPage({ userId }) {
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
        src="/api/admin/orbit-report"
        title="직원 업무 심화 리포트"
        style={{ border: 'none', width: '100%', flex: '1 1 auto' }}
      />
    </div>
  );
}
