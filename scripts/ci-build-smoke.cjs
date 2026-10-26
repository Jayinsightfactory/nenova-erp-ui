const {spawn} = require('node:child_process');
const http = require('node:http');
// No production credentials, writes or authenticated pages. Terminate only our child.
const child = spawn(process.execPath, [require.resolve('next/dist/bin/next'), 'start', '-p', '19426'], {
  env: {...process.env, DB_SERVER:'', NEXT_DIST_DIR:'.next-build'}, stdio:['ignore','ignore','inherit'], windowsHide:true,
});
const probe = () => new Promise(resolve => {
  const req = http.get('http://127.0.0.1:19426/login', res => {res.resume(); resolve(res.statusCode === 200);});
  req.setTimeout(3000, () => req.destroy()); req.on('error', () => resolve(false));
});
(async () => {
  try {
    for (let n=0;n<30;n++) {
      if (child.exitCode !== null) throw Error('CI_START_EXITED');
      if (await probe()) { console.log('CI_LOGIN_SMOKE_PASS'); return; }
      await new Promise(resolve => setTimeout(resolve,1000));
    }
    throw Error('CI_LOGIN_SMOKE_TIMEOUT');
  } finally { child.kill(); }
})().catch(error => {console.error(error.message); process.exitCode=1;});
