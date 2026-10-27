import { latestWednesdaySlot, loadProfitReportCalendar, resolveWeeklySchedule } from './profitReportWeeklySchedule.js';

export function profitWeeklySchedulerEnabled(env = process.env) {
  return env.NODE_ENV === 'production' && Boolean(env.DB_SERVER)
    && env.NEXT_RUNTIME !== 'edge' && env.NEXT_PHASE !== 'phase-production-build'
    && env.npm_lifecycle_event !== 'build' && !/\bnext\s+build\b/.test(env.npm_lifecycle_script || '')
    && env.PROFIT_REPORT_WEEKLY_SCHEDULER_DISABLED !== '1';
}

/** The save service owns the DB application lock, persisted-slot and active-confirm checks. */
export function createProfitWeeklyRunner({ loadCalendar = loadProfitReportCalendar, save, now = () => new Date() } = {}) {
  let running = false;
  let completedSlot = null;
  return async function run() {
    if (running) return { action: 'skipped', reason: 'running' };
    const capturedNow = now();
    const slot = latestWednesdaySlot(capturedNow);
    if (completedSlot === slot.key) return { action: 'skipped', reason: 'completed_slot' };
    running = true;
    try {
      const rows = await loadCalendar(slot.dateOnly);
      const schedule = resolveWeeklySchedule(rows, capturedNow);
      const result = await save({
        orderYear: schedule.target.orderYear, major: schedule.target.major,
        reason: 'WEEKLY', actor: `weekly-scheduler:${slot.key}`, scheduleSlot: slot.key,
      });
      if (result?.action === 'saved' || (result?.action === 'skipped'
          && ['confirmed', 'schedule_duplicate', 'existing_policy_cache'].includes(result.reason))) {
        completedSlot = slot.key;
      } else if (result?.action !== 'busy' && result?.reason !== 'busy') {
        throw new Error('주간 보고서 저장 결과를 확인하지 못했습니다.');
      }
      return { ...result, scheduleSlot: slot.key, target: schedule.target };
    } finally { running = false; }
  };
}

export function startProfitReportWeeklyScheduler({ env = process.env, timers = globalThis, log = console } = {}) {
  if (!profitWeeklySchedulerEnabled(env)) return null;
  if (globalThis._profitReportWeeklyScheduler) return globalThis._profitReportWeeklyScheduler;
  const runner = createProfitWeeklyRunner({
    save: async args => {
      const { saveProfitReportCache } = await import('../pages/api/sales/profit-report.js');
      return saveProfitReportCache(args);
    },
  });
  const state = { timer: null, stopped: false };
  const arm = ms => {
    if (state.stopped) return;
    state.timer = timers.setTimeout(tick, ms);
    state.timer?.unref?.();
  };
  async function tick() {
    let retry = false;
    try {
      const result = await runner();
      retry = result?.action === 'busy' || result?.reason === 'busy';
      if (result?.action === 'saved') log.info('[profit-weekly-cache] saved', result.target.orderYear, result.target.major, result.scheduleSlot);
    } catch (error) {
      retry = true;
      // No SQL text, credentials, customer details or payload in scheduler logs.
      log.warn('[profit-weekly-cache] retry required', String(error?.code || 'SAVE_FAILED'));
    } finally { arm(retry ? 300000 : 60000); }
  }
  state.stop = () => { state.stopped = true; timers.clearTimeout(state.timer); delete globalThis._profitReportWeeklyScheduler; };
  globalThis._profitReportWeeklyScheduler = state;
  arm(15000);
  return state;
}
