const path = require('node:path');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');

function assertMappingWritersStopped(processes, root = process.cwd()) {
  if (!Array.isArray(processes)) throw new Error('PM2 process inventory is unavailable');
  const apps = processes.filter(p => p.name === 'nenova-erp');
  if (!apps.length || apps.some(p => p.pm2_env?.status !== 'stopped' || Number(p.pid) !== 0)) {
    throw new Error('Every nenova-erp instance must be stopped with PID 0 before migration');
  }
  const project = path.resolve(root);
  for (const p of processes) {
    // This dedicated service only recalculates pending stock; it never imports aliases.
    if (isStockRecovery(p, root)) continue;
    const cwd = p.pm2_env?.pm_cwd;
    const script = p.pm2_env?.pm_exec_path;
    const belongs = (cwd && path.resolve(cwd) === project)
      || (script && path.resolve(script).startsWith(project + path.sep));
    if (belongs && (Number(p.pid) !== 0 || !['stopped', 'errored'].includes(p.pm2_env?.status))) {
      throw new Error('Another process in this project is still active; mapping migration blocked');
    }
  }
  return true;
}

function isStockRecovery(p, root) {
  return p.name === 'nenova-stock-recovery'
    && p.pm2_env?.pm_exec_path === path.join(root, 'scripts', 'pending-stock-recovery-service.cjs');
}

function assertNoOtherMappingProcesses(processes, pm2, root, selfPid = process.pid) {
  const project = path.resolve(root);
  const byPid = new Map(processes.map(p => [p.pid, p]));
  const allowed = new Set(pm2.filter(p => isStockRecovery(p, root)).map(p => p.pid));
  let ancestor = selfPid;
  while (ancestor > 0 && !allowed.has(ancestor)) {
    allowed.add(ancestor);
    ancestor = byPid.get(ancestor)?.parentPid || 0;
  }
  for (const p of processes) {
    if (allowed.has(p.pid)) continue;
    // PM2's supervisor is not an application or alias writer.
    if (/^PM2 v[\d.]+: God Daemon \(/.test(p.args?.[0] || '')) continue;
    const belongs = (p.cwd && path.resolve(p.cwd) === project)
      || (p.args || []).some(arg => arg.startsWith(project + path.sep));
    if (belongs) throw new Error(`Non-stopped project process PID ${p.pid}; mapping migration blocked`);
  }
  return true;
}

function linuxProcesses() {
  if (process.platform !== 'linux') throw new Error('Production writer inspection requires Linux /proc');
  const found = [];
  for (const entry of fs.readdirSync('/proc')) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      const status = fs.readFileSync(`/proc/${entry}/status`, 'utf8');
      let cwd = null;
      try { cwd = fs.readlinkSync(`/proc/${entry}/cwd`); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      found.push({ pid: Number(entry), parentPid: Number(/^PPid:\s*(\d+)/m.exec(status)?.[1] || 0), cwd,
        args: fs.readFileSync(`/proc/${entry}/cmdline`, 'utf8').split('\0').filter(Boolean) });
    } catch (error) {
      if (error.code !== 'ENOENT' && error.code !== 'ESRCH') throw new Error('Cannot inspect all Linux process writers');
    }
  }
  return found;
}

function inspectMappingWritersStopped() {
  const result = spawnSync('pm2', ['jlist'], { encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) throw new Error('Cannot inspect PM2 writer state');
  const pm2 = JSON.parse(result.stdout);
  assertMappingWritersStopped(pm2);
  assertNoOtherMappingProcesses(linuxProcesses(), pm2, process.cwd());
}

module.exports = { assertMappingWritersStopped, assertNoOtherMappingProcesses, inspectMappingWritersStopped };
if (require.main === module) {
  try { inspectMappingWritersStopped(); console.log('Mapping file writers stopped'); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
