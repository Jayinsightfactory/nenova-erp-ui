export function startWeekdayAutoRefresh({ run, canRun, isVisible, setIntervalFn = setInterval, clearIntervalFn = clearInterval, intervalMs = 30000 }) {
  let running = false, disposed = false;
  async function trigger() {
    if (disposed || running || !isVisible() || !canRun()) return false;
    running = true;
    try { await run(); return true; } catch { return false; } finally { running = false; }
  }
  const timer = setIntervalFn(() => { void trigger(); }, intervalMs);
  return { trigger, dispose() { disposed = true; clearIntervalFn(timer); } };
}

export function weekdayAutoRefreshFailures(results, ancillary, carryover) {
  return [
    // A rejected baseline candidate is still unavailable for confirmation. It is
    // not a failed distribution read (legacy dates can have NULL EstQuantity).
    ...results.flatMap(result => (result.candidates || [])
      .filter(candidate => candidate.errorCode !== 'INVALID_ERP_DATES').map(candidate => candidate.error)),
    ...ancillary.flatMap(result => [result.confirmationFailure, result.wilsonFailure, result.earlyFailure]),
    !carryover ? '이월 조회 응답을 확인할 수 없습니다.' : '',
  ].filter(Boolean);
}
