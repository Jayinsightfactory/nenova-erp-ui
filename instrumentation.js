// Next 서버 부팅 훅 — 판매등록 히스토리 스냅샷 스케줄러 기동
// (화 17:00 최종분배 / 수 16:00 점검 / 30분 변경감지 — lib/salesSnapshot.js)
export async function register() {
  if (process.env.NEXT_RUNTIME === 'edge') return;
  try {
    const { startSalesSnapshotScheduler } = await import('./lib/salesSnapshot');
    startSalesSnapshotScheduler();
  } catch (e) {
    console.warn('[instrumentation] salesSnapshot 스케줄러 시작 실패(무시):', e.message);
  }
}
