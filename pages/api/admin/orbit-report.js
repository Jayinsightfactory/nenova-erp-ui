// pages/api/admin/orbit-report.js
// Orbit 직원 심화 리포트 HTML 스트리밍. nenovaSS3 계정 전용(민감: 직원 관측데이터).
// 이중 게이트 중 서버측 2차 — 페이지(getServerSideProps)에 이어 원본 엔드포인트 자체를 막는다.
import fs from 'fs';
import path from 'path';
import { withAuth } from '../../../lib/auth';
import { isOrbitReportViewer } from '../../../lib/orbitReportAccess';

async function handler(req, res) {
  if (!isOrbitReportViewer(req.user)) {
    return res.status(403).json({ success: false, error: '이 리포트에 접근할 권한이 없습니다.' });
  }
  try {
    const html = fs.readFileSync(path.join(process.cwd(), 'data', 'orbit-report.html'), 'utf8');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    return res.status(200).send(html);
  } catch (err) {
    console.error('[orbit-report] 파일 로드 실패:', err);
    return res.status(500).json({ success: false, error: '리포트를 불러오지 못했습니다.' });
  }
}

export default withAuth(handler);
