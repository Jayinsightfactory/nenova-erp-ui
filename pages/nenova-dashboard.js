/**
 * pages/nenova-dashboard.js
 * Orbit AI 연결 분석 대시보드 — Railway 서버로 full-screen 리다이렉트
 */

export async function getServerSideProps() {
  return {
    redirect: {
      destination: 'https://mindmap-viewer-production-adb2.up.railway.app/nenova-dashboard.html',
      permanent: false,
    },
  };
}

export default function NenovaDashboard() {
  return null;
}
