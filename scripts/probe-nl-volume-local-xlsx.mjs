/**
 * 로컬 DB + pivotVolumeCustDays 로 NL 물량표 2행(출고요일) 생성 검증
 * node scripts/probe-nl-volume-local-xlsx.mjs [week] [orderYear]
 */
import fs from 'fs';
import XLSX from 'xlsx-js-style';

for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) process.env[m[1].trim()] = m[2].trim();
}
const { query, sql } = await import('../lib/db.js');
const { extractDays, pickDataDay } = await import('../lib/pivotVolumeCustDays.js');

const week = process.argv[2] || '25-02';
const orderYear = process.argv[3] || '2026';
const yw = `${orderYear}${week.replace('-', '')}`;

const r = await query(
  `SELECT DISTINCT c.CustKey, c.CustName, c.OrderCode, ISNULL(c.Descr,'') AS custDescr, c.CustArea AS area
   FROM OrderMaster om
   JOIN OrderDetail od ON od.OrderMasterKey = om.OrderMasterKey AND od.isDeleted = 0
   JOIN Product p ON p.ProdKey = od.ProdKey AND p.isDeleted = 0
   JOIN Customer c ON c.CustKey = om.CustKey
   WHERE om.isDeleted = 0
     AND om.OrderYear + REPLACE(om.OrderWeek, '-', '') = @yw
     AND p.CounName = N'네덜란드'
     AND od.OutQuantity > 0
   ORDER BY c.CustArea, c.CustName`,
  { yw: { type: sql.NVarChar, value: yw } },
);

const cols = r.recordset.map(c => ({
  label: String(c.custDescr || '').split('/')[0]?.trim() || c.CustName,
  day: pickDataDay(extractDays(c, '네덜란드')),
  cl: c.OrderCode,
}));

const aoa = [[], [], []];
aoa[0][0] = `차수(${week.replace('-', '')}) 품종(네덜란드)`;
aoa[1][0] = '';
aoa[2][0] = '';
cols.forEach((col, i) => {
  const idx = i + 1;
  aoa[0][idx] = i === 0 ? '지방' : '';
  aoa[1][idx] = col.day;
  aoa[2][idx] = `${col.label}\n${col.cl}`;
});

const ws = XLSX.utils.aoa_to_sheet(aoa);
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, '네덜란드');
const out = `scripts/out-local-${week}-nl-days.xlsx`;
fs.writeFileSync(out, XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));

console.log(`Wrote ${out}`);
console.log('Row2 days:', aoa[1].slice(1));
console.log('Non-empty:', aoa[1].filter(v => /[일월화수목금토]/.test(String(v))));
