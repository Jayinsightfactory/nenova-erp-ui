/**
 * pivot-volume-excel 2행(출고요일) 확인
 * node scripts/probe-nl-volume-excel-row2.mjs [week] [baseUrl] [orderYear]
 */
import fs from 'fs';
import XLSX from 'xlsx';

const BASE = process.argv[3] || process.env.SMOKE_BASE_URL || 'https://nenovaweb.com';
const USER = process.env.SMOKE_USER || 'nenovaSS3';
const PASS = process.env.SMOKE_PASS || '0000';
const WEEK = process.argv[2] || '25-02';
const ORDER_YEAR = process.argv[4] || '2026';

async function login() {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ userId: USER, password: PASS }),
  });
  const d = await r.json();
  if (!d.token) throw new Error(`Login failed: ${r.status} ${JSON.stringify(d)}`);
  return d.token;
}

async function main() {
  const token = await login();
  const qs = new URLSearchParams({
    orderYear: ORDER_YEAR,
    weekStart: WEEK,
    weekEnd: WEEK,
    species: 'country:네덜란드',
  });
  const r = await fetch(`${BASE}/api/stats/pivot-volume-excel?${qs}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${await r.text()}`);
  const buf = Buffer.from(await r.arrayBuffer());
  const out = `scripts/out-${WEEK}-nl-volume.xlsx`;
  fs.writeFileSync(out, buf);
  const wb = XLSX.read(buf, { type: 'buffer' });
  const sheet = wb.Sheets[wb.SheetNames.find(n => /네덜란드/.test(n)) || wb.SheetNames[0]];
  const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  console.log(`BASE=${BASE} WEEK=${WEEK} sheet=${wb.SheetNames.join(',')}`);
  console.log('Row1:', aoa[0]?.slice(0, 15));
  console.log('Row2 (days):', aoa[1]?.slice(0, 15));
  console.log('Row3 (cust):', aoa[2]?.slice(0, 15));
  const days = (aoa[1] || []).filter(v => /[일월화수목금토]/.test(String(v)));
  console.log(`\nNon-empty day cells in row2: ${days.length}`, days.slice(0, 20));
}

main().catch(e => { console.error(e); process.exit(1); });
