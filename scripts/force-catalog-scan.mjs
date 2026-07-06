import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, '../.env.local');
for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) process.env[m[1].trim()] = m[2].trim();
}

const BASE = process.env.NENOVA_BASE || 'https://nenovaweb.com';

async function tryLogin(userId, password) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, password }),
  });
  const data = await res.json();
  const cookie = res.headers.get('set-cookie')?.split(';')[0];
  return { ok: res.ok && data.success, cookie, userId };
}

async function main() {
  const { query } = await import('../lib/db.js');
  const r = await query(
    `SELECT TOP 8 UserID, Password FROM UserInfo WHERE isDeleted=0 ORDER BY CASE WHEN Authority LIKE '%admin%' THEN 0 ELSE 1 END, UserID`,
  );
  let cookie = null;
  for (const u of r.recordset) {
    const t = await tryLogin(u.UserID, u.Password);
    if (t.ok) { cookie = t.cookie; console.log('Login:', t.userId); break; }
  }
  if (!cookie) throw new Error('login failed');

  for (const url of [`${BASE}/api/catalog/images/import-source?scan=1&force=1`]) {
    console.log('\nPOST', url);
    const res = await fetch(url, { method: 'POST', headers: { Cookie: cookie } });
    const data = await res.json().catch(async () => ({ raw: (await res.text()).slice(0, 200) }));
    console.log('status', res.status);
    if (data.matchedCount != null) {
      console.log('matchedCount', data.matchedCount);
      console.log('extractEngine', data.sources?.[0]?.extractEngine);
      console.log('skipped', data.skipped?.length || 0);
      console.log('unmatched', data.unmatched?.length || 0);
      console.log('sample', data.matched?.slice(0, 3));
    } else {
      console.log(JSON.stringify(data).slice(0, 400));
    }
  }
}

main().catch(e => { console.error(e); process.exit(1); });
