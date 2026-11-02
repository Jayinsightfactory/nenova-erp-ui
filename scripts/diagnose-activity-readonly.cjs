const fs = require('node:fs');
const cp = require('node:child_process');
const path = require('node:path');
const processes = JSON.parse(cp.execFileSync('pm2', ['jlist'], { encoding: 'utf8', timeout: 15000 }));
const app = processes.find(p => p.name === 'nenova-erp');
const file = app?.pm2_env?.pm_err_log_path;
const counts = {};
if (file) {
  const size = fs.statSync(file).size;
  const bytes = Math.min(size, 4 * 1024 * 1024);
  const fd = fs.openSync(file, 'r');
  const buffer = Buffer.alloc(bytes);
  try { fs.readSync(fd, buffer, 0, bytes, size - bytes); } finally { fs.closeSync(fd); }
  for (const line of buffer.toString('utf8').split(/\r?\n/)) {
    const match = line.match(/\[user-activity\] write_failed ([A-Z0-9_]+)/);
    if (match) counts[match[1]] = (counts[match[1]] || 0) + 1;
  }
}
console.log(JSON.stringify({ section: 'activity_diagnostic', codes: counts,
  sourceWorkerExists: fs.existsSync('/var/www/nenova-erp/lib/userActivityWorker.cjs'),
  bundledWorkerExists: fs.existsSync('/var/www/nenova-erp/.next/server/pages/api/work/userActivityWorker.cjs') }));
