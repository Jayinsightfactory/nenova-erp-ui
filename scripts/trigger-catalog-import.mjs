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

  const scan = await fetch(`${BASE}/api/catalog/images/import-source?scan=1`, {
    method: 'POST',
    headers: { Cookie: cookie },
  });
  const data = await scan.json();
  console.log(JSON.stringify(data, null, 2));
}

main().catch(e => { console.error(e.message); process.exit(1); });
