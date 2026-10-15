'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { startService } = require('../scripts/pending-stock-recovery-service.cjs');
test('dedicated production service loads environment before starting and awaits stop', async () => {
  const calls = [];
  const service = startService({ env: { NODE_ENV: 'production', NENOVA_PENDING_STOCK_RECOVERY: '1', NENOVA_STOCK_RECOVERY_DIR: '/fixture' },
    loadEnv: () => calls.push('env'), startWorker: ({directory}) => { calls.push(directory); return { stop: async () => calls.push('stop') }; } });
  assert.deepEqual(calls, ['env', '/fixture']); await service.stop(); assert.equal(calls.at(-1), 'stop');
});
test('service requires production opt-in and persistent directory before loading anything', () => {
  for (const env of [{}, {NODE_ENV:'production'}, {NODE_ENV:'production',NENOVA_PENDING_STOCK_RECOVERY:'1'}]) {
    assert.throws(() => startService({env,loadEnv:()=>assert.fail('must not load')}), /NOT_CONFIGURED/);
  }
});
test('next start deployment starts a dedicated PM2 service; web host cannot double-start it', () => {
  const deploy=fs.readFileSync('.github/workflows/deploy.yml','utf8');
  assert.match(deploy,/pm2 start scripts\/pending-stock-recovery-service.cjs --name nenova-stock-recovery/);
  assert.match(deploy,/pm2 restart nenova-stock-recovery --update-env/);
  assert.doesNotMatch(fs.readFileSync('web.js','utf8'),/startRecoveryWorker/);
});
