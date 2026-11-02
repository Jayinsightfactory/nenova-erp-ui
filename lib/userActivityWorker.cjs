const { parentPort } = require('node:worker_threads');
const store = require('./userActivityStore.cjs');

parentPort.on('message', ({ id, user, events, source, options, activityDir }) => {
  try {
    if (activityDir) process.env.NENOVA_ACTIVITY_DIR = activityDir;
    else delete process.env.NENOVA_ACTIVITY_DIR;
    parentPort.postMessage({ id, result: store.appendEvents(user, events, source, options) });
  } catch (error) {
    parentPort.postMessage({ id, error: { message: error.message, code: error.code || '' } });
  }
});
