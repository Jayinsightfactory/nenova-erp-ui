import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, '../.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) process.env[m[1].trim()] = m[2].trim();
  }
}

const { query } = await import('../lib/db.js');
let refPptx = null;
try {
  refPptx = fs.readdirSync(path.join(__dirname, '../_catalog-ref-browser'))
    .find(f => f.endsWith('.pptx'));
} catch { /* ignore */ }
const PPTX = process.env.CATALOG_PPTX
  || (refPptx ? path.join(__dirname, '../_catalog-ref-browser', refPptx) : null)
  || 'C:\\Users\\USER\\Documents\\카카오톡 받은 파일\\카달로그 추출기(브라우저)\\카달로그_통합본.pptx';
const BASE = process.env.NENOVA_BASE || 'https://nenovaweb.com';
const FORCE = process.env.CATALOG_FORCE !== '0';

async function tryLogin(userId, password) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, password }),
  });
  const data = await res.json();
  const cookie = res.headers.get('set-cookie')?.split(';')[0];
  return { ok: res.ok && data.success, cookie, data };
}

async function main() {
  if (!fs.existsSync(PPTX)) throw new Error(`파일 없음: ${PPTX}`);

  const admins = await query(
    `SELECT TOP 5 UserID, UserName, Password FROM UserInfo WHERE isDeleted=0 AND Authority LIKE '%admin%' ORDER BY UserID`,
  );
  const users = admins.recordset?.length
    ? admins.recordset
    : (await query(`SELECT TOP 5 UserID, UserName, Password FROM UserInfo WHERE isDeleted=0 ORDER BY UserID`)).recordset;

  let cookie = null;
  for (const u of users) {
    const r = await tryLogin(u.UserID, u.Password);
    if (r.ok) {
      cookie = r.cookie;
      console.log('Login OK:', u.UserID);
      break;
    }
  }
  if (!cookie) throw new Error('로그인 실패');

  const buf = fs.readFileSync(PPTX);
  const fd = new FormData();
  fd.append('file', new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' }), '카달로그_통합본.pptx');

  const forceQ = FORCE ? '?force=1' : '';
  const up = await fetch(`${BASE}/api/catalog/images/import-source${forceQ}`, {
    method: 'POST',
    headers: { Cookie: cookie },
    body: fd,
  });
  const upData = await up.json();
  console.log('Import:', JSON.stringify(upData, null, 2));
  if (!up.ok || !upData.success) process.exit(1);

  // 서버 _bulk_import에도 저장 (자동 import용)
  const up2 = await fetch(`${BASE}/api/catalog/images/upload-integrated`, {
    method: 'POST',
    headers: { Cookie: cookie },
    body: fd,
  }).catch(() => null);
  if (up2) {
    const d2 = await up2.json();
    console.log('Server copy:', JSON.stringify(d2, null, 2));
  }
}

main().catch(e => { console.error(e.message); process.exit(1); });
