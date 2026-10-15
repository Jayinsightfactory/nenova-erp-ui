'use strict';
// Read-only deployment check: never calculates or changes the gate.
const fs = require('node:fs');
const path = require('node:path');
async function main() {
  const directory = process.env.NENOVA_STOCK_RECOVERY_DIR;
  if (process.env.NENOVA_PENDING_STOCK_RECOVERY !== '1' || !directory) throw Error('RECOVERY_NOT_CONFIGURED');
  const started = Date.now();
  for (let i = 0; i < 45; i++) {
    try {
      const beat = JSON.parse(fs.readFileSync(path.join(directory, 'heartbeat.json'), 'utf8'));
      if (['skipped', 'recovered'].includes(beat.status) && beat.workerRevision === 1 && Number.isInteger(beat.pid) && beat.pid > 0 && Date.parse(beat.at) >= started - 10000) {
        process.kill(beat.pid, 0);
        console.log('Pending stock recovery worker heartbeat verified (read-only).'); return;
      }
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw Error('RECOVERY_HEARTBEAT_NOT_CONFIRMED');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
