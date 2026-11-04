const { randomUUID } = require('node:crypto');
const store = require('./userActivityStore.cjs');
const asyncStore = require('./userActivityAsync.cjs');
const { responseEvidence } = require('./userActivityEvidence.cjs');
const ATTACHED = Symbol.for('nenova.userActivity.attached');
const RETRY = Symbol.for('nenova.userActivity.retry');
const retryState = () => globalThis[RETRY] ||= { queue: [], dropped: 0, timer: null, running: false };
async function retryPending() {
  const state = retryState();
  if (state.running) return;
  state.running = true;
  try {
  for (let n = 0; n < 50 && state.queue.length; n++) {
    const item = state.queue[0];
    try { await asyncStore.appendEvents(item.user, [item.event], item.source, { recordedBy: 'server' }); state.queue.shift(); }
    catch { break; }
  }
  if (!state.queue.length && state.timer) { clearInterval(state.timer); state.timer = null; }
  } finally { state.running = false; }
}
async function persist(user, event, source) {
  try { await asyncStore.appendEvents(user, [event], source, { recordedBy: 'server' }); }
  catch (error) {
    console.error('[user-activity] write_failed', error.code || 'STORE_ERROR');
    const state = retryState();
    if (state.queue.length >= 1000) state.dropped++;
    else state.queue.push({ user: { userId: user.userId, userName: user.userName }, event, source });
    if (!state.timer) { state.timer = setInterval(() => { void retryPending(); }, 5000); state.timer.unref?.(); }
  }
}
function attachRequestAudit(req, res, user) {
  const route = store.cleanPath(req.url);
  const query = new URL(req.url, 'http://localhost').searchParams;
  if (!user?.userId || (route === '/api/work/activity' && (req.method === 'POST' || query.get('me') === '1'))) return;
  const existing = res[ATTACHED];
  const state = existing || { user, started: Date.now(), outcome: 'unknown', completed: false, wrapped: false };
  state.user = user;
  res[ATTACHED] = state;
  if (!state.wrapped && typeof res.json === 'function') {
    state.wrapped = true;
    const original = res.json;
    res.json = function (body) { state.evidence = responseEvidence(body); if (body && typeof body === 'object') { if (body.success === false || body.ok === false) state.outcome = 'failure'; else if (body.success === true || body.ok === true) state.outcome = 'success'; } return original.call(this, body); };
  }
  if (existing) return;
  const record = closed => {
    if (state.completed) return; state.completed = true;
    void persist(state.user, { id: randomUUID(), kind: 'api', path: route, pagePath: req.headers?.['x-nenova-page-path'], method: req.method, status: res.statusCode, outcome: closed || res.statusCode >= 400 ? 'failure' : state.outcome, duration: Date.now() - state.started, actionId: req.headers?.['x-nenova-action-id'], sessionId: req.headers?.['x-nenova-session-id'], workflowId: req.headers?.['x-nenova-workflow-id'], requestId: req.headers?.['x-nenova-request-id'] || randomUUID(), sequence: Number(req.headers?.['x-nenova-sequence']), startedAt: new Date(state.started).toISOString(), stage: closed ? 'disconnected' : 'response', evidence: state.evidence }, store.sourceFromRequest(req));
  };
  res.once('finish', () => record(false));
  res.once('close', () => record(!res.writableFinished));
}
module.exports = { attachRequestAudit, retryPending };
