'use strict';

function pmLiveStatus(body) {
  const data = body?.data && typeof body.data === 'object' ? body.data : {};
  const agent = Array.isArray(data.agents) ? data.agents.find(item => item?.id === 'pm') : null;
  const ageSec = Number.isFinite(body?.ageSec) ? Math.max(0, body.ageSec) : null;
  const fresh = ageSec !== null && ageSec <= 180;
  const knownAgent = agent && ['working', 'idle'].includes(agent.status);
  const state = fresh && agent?.status === 'working' ? 'live'
    : fresh && knownAgent ? 'active'
      : body?.receivedAt || data.generatedAt ? 'stale' : 'offline';
  return {
    ok: Boolean(fresh && knownAgent), state, ageSec,
    generatedAt: typeof data.generatedAt === 'string' ? data.generatedAt : '',
    receivedAt: typeof body?.receivedAt === 'string' ? body.receivedAt : '',
    activity: typeof agent?.activity === 'string' ? agent.activity.slice(0, 240)
      : typeof data.pmDetail?.now === 'string' ? data.pmDetail.now.slice(0, 240) : '',
    status: typeof agent?.status === 'string' ? agent.status : 'unknown',
  };
}

module.exports = { pmLiveStatus };
