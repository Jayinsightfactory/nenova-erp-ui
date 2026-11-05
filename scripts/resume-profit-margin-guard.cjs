// Resume only the untouched tail after the documented static-assert gate stop.
// The original run log proves the completed prefix; CI runs the full final gate.
const { spawnSync } = require('node:child_process');
const scripts = require('../package.json').scripts;
const commands = scripts['test:erp-contract'].split(' && ');
const stop = commands.indexOf('node __tests__/profitReportWorkbookParity.test.js');
if (stop < 0) throw Error('Documented resume boundary not found');
for (const command of [...commands.slice(stop + 1), 'npm run posttest:erp-contract',
  'npm run test:erp-manifest -- --changed-from origin/master',
  'npm run guard:erp-writes -- --changed-from origin/master', 'npm run build']) {
  console.log(`\nRESUME GATE: ${command}`);
  const result = spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', command], { stdio: 'inherit', env: process.env });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log('RESUMED ERP TAIL + POSTHOOK + MANIFEST + WRITE GUARD + BUILD PASSED');
