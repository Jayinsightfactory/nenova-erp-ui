import XLSX from 'xlsx';
import { readFileSync, writeFileSync } from 'fs';

const pivotPath = 'C:/Users/USER/Downloads/Pivot 통계_2026-07-02.xlsx';
const portalPath = 'C:/Users/USER/Downloads/shilla-portal-june.tsv';

const portalRaw = `2026-06-04	[수입] 행사용꽃, 시네신스, 연핑크 (PK)	25	9200	230000
2026-06-04	[수입] 행사용꽃, 안스리움, 화이트 (EA)	109	8300	904700
2026-06-04	[수입] 행사용꽃, 안스리움, 화이트 (EA)	41	8300	340300
2026-06-04	[수입] 행사용꽃, 안스리움, 화이트 (EA)	228	8300	1892400
2026-06-04	[수입] 행사용꽃, 안스리움, 화이트 (EA)	15	8300	124500
2026-06-04	[수입] 행사용꽃, 안스리움, 화이트 (EA)	19	8300	157700
2026-06-04	[수입] 행사용꽃, 안스리움, 화이트 (EA)	39	8300	323700
2026-06-04	[수입] 행사용꽃, 안스리움, 화이트 (EA)	14	8300	116200
2026-06-04	[수입] 행사용꽃, 호접, 염색, 스프레이, 8송이, VN (EA)	96	26000	2496000
2026-06-04	[수입] 행사용꽃, 호접, 화이트, 8송이, VN (EA)	4	13000	52000
2026-06-04	[수입] 행사용꽃, 호접, 화이트, 8송이, VN (EA)	240	13000	3120000
2026-06-04	[수입] 행사용꽃, 수국, 연그린, 콜롬비아 (EA)	54	2750	148500
2026-06-04	[수입] 행사용꽃, 수국, 연그린, 콜롬비아 (EA)	310	2750	852500
2026-06-04	[수입] 행사용꽃, 수국, 연블루, 콜롬비아 (EA)	120	2398	287760
2026-06-04	[수입] 행사용꽃, 수국, 연블루, 콜롬비아 (EA)	11	2398	26378
2026-06-04	[수입] 행사용꽃, 수국, 연블루, 콜롬비아 (EA)	45	2398	107910
2026-06-04	[수입] 행사용꽃, 수국, 연블루, 콜롬비아 (EA)	62	2398	148676
2026-06-04	[수입] 행사용꽃, 장미, 쉬머, 피치 (PK)	20	11970	239400
2026-06-04	[수입] 행사용꽃, 카네이션, 프라도민트, 연그린 (PK)	45	14500	652500
2026-06-05	[수입] 행사용꽃, 시네신스, 화이트 (PK)	60	9200	552000
2026-06-05	[수입] 행사용꽃, 시네신스, 화이트 (PK)	16	9200	147200
2026-06-05	[수입] 행사용꽃, 시네신스, 화이트 (PK)	47	9200	432400
2026-06-05	[수입] 행사용꽃, 시네신스, 화이트 (PK)	36	9200	331200
2026-06-05	[수입] 행사용꽃, 시네신스, 화이트 (PK)	24	9200	220800
2026-06-05	[수입] 행사용꽃, 카네이션, 프라도민트, 연그린 (PK)	3	14500	43500
2026-06-05	[수입] 꽃, 카네이션, 로다스, 아이보리 (PK)	30	14500	435000
2026-06-10	[수입] 행사용꽃, 수국, 연그린, 콜롬비아 (EA)	505	2750	1388750
2026-06-10	[수입] 행사용꽃, 수국, 연블루, 콜롬비아 (EA)	100	2398	239800
2026-06-10	[수입] 행사용꽃, 수국, 연블루, 콜롬비아 (EA)	50	2398	119900
2026-06-10	[수입] 행사용꽃, 시네신스, 화이트 (PK)	182	9200	1674400
2026-06-10	[수입] 행사용꽃, 시네신스, 화이트 (PK)	40	9200	368000
2026-06-10	[수입] 행사용꽃, 장미, 몬디알, 연핑크 (PK)	50	11490	574500
2026-06-10	[수입] 행사용꽃, 시네신스, 연핑크 (PK)	20	9200	184000
2026-06-10	[수입] 행사용꽃, 시네신스, 화이트 (PK)	95	9200	874000
2026-06-10	[수입] 행사용꽃, 안스리움, 화이트 (EA)	159	8300	1319700
2026-06-10	[수입] 행사용꽃, 안스리움, 화이트 (EA)	152	8300	1261600
2026-06-10	[수입] 행사용꽃, 안스리움, 화이트 (EA)	42	8300	348600
2026-06-12	[수입] 행사용꽃, 호접, 염색, 스프레이, 8송이, VN (EA)	64	26000	1664000
2026-06-12	[수입] 행사용꽃, 호접, 화이트, 8송이, VN (EA)	268	1300	3484000
2026-06-17	[수입] 행사용꽃, 시네신스, 화이트 (PK)	27	9200	248400
2026-06-17	[수입] 행사용꽃, 안스리움, 화이트 (EA)	54	8300	448200
2026-06-17	[수입] 행사용꽃, 안스리움, 화이트 (EA)	29	8300	240700
2026-06-17	[수입] 행사용꽃, 안스리움, 화이트 (EA)	15	8300	124500
2026-06-17	[수입] 행사용꽃, 안스리움, 화이트 (EA)	15	8300	124500
2026-06-17	[수입] 행사용꽃, 안스리움, 화이트 (EA)	49	8300	406700
2026-06-17	[수입] 행사용꽃, 수국, 연그린, 콜롬비아 (EA)	322	2750	885500
2026-06-17	[수입] 행사용꽃, 수국, 연그린, 콜롬비아 (EA)	8	2750	22000
2026-06-17	[수입] 행사용꽃, 수국, 연블루, 콜롬비아 (EA)	10	2398	23980
2026-06-17	[수입] 행사용꽃, 시네신스, 화이트 (PK)	106	9200	975200
2026-06-17	[수입] 행사용꽃, 시네신스, 화이트 (PK)	62	9200	570400
2026-06-17	[수입] 행사용꽃, 시네신스, 화이트 (PK)	40	9200	368000
2026-06-17	[수입] 행사용꽃, 시네신스, 화이트 (PK)	74	9200	680800
2026-06-17	[수입] 행사용꽃, 시네신스, 화이트 (PK)	82	9200	754400
2026-06-17	[수입] 행사용꽃, 시네신스, 화이트 (PK)	15	9200	138000
2026-06-17	[수입] 행사용꽃, 호접, 화이트, 8송이, VN (EA)	313	13000	4069000
2026-06-17	[수입] 행사용꽃, 호접, 화이트, 8송이, VN (EA)	7	13000	91000
2026-06-24	[수입] 행사용꽃, 시네신스, 화이트 (PK)	110	9200	1012000
2026-06-24	[수입] 행사용꽃, 시네신스, 화이트 (PK)	50	9200	460000
2026-06-24	[수입] 행사용꽃, 시네신스, 화이트 (PK)	144	9200	1324800
2026-06-24	[수입] 행사용꽃, 안스리움, 화이트 (EA)	58	8300	481400
2026-06-24	[수입] 행사용꽃, 안스리움, 화이트 (EA)	50	8300	415000
2026-06-24	[수입] 행사용꽃, 안스리움, 화이트 (EA)	30	8300	249000
2026-06-24	[수입] 행사용꽃, 안스리움, 화이트 (EA)	40	8300	332000
2026-06-24	[수입] 행사용꽃, 수국, 연그린, 콜롬비아 (EA)	190	2750	522500
2026-06-24	[수입] 행사용꽃, 시네신스, 화이트 (PK)	60	9200	552000
2026-06-24	[수입] 행사용꽃, 시네신스, 화이트 (PK)	57	9200	524400
2026-06-24	[수입] 행사용꽃, 장미, 몬디알, 연핑크 (PK)	6	11490	68940
2026-06-26	[수입] 행사용꽃, 호접, 화이트, 8송이, VN (EA)	332	13000	4316000
2026-06-04	[수입] 행사용꽃, 수국, 진그린, 콜롬비아 (EA)	120	2750	330000
2026-06-26	[수입] 행사용꽃, 안스리움, 화이트 (EA)	3	8300	24900`;

// fix typo in one line - user had 13000 not 1300
const portalFixed = portalRaw.replace('268\t1300\t', '268\t13000\t');

const rows = XLSX.utils.sheet_to_json(XLSX.readFile(pivotPath).Sheets.Sheet, { header: 1, defval: '' });
const weekRow = rows[4];
const shillaWeekCols = {};
rows[7].forEach((c, i) => { if (String(c).includes('신라')) shillaWeekCols[i] = weekRow[i]; });

const pivotLines = [];
for (let r = 8; r < rows.length; r++) {
  const row = rows[r];
  const country = row[0]; const flower = row[4]; const prod = row[7]; const outDate = row[3];
  if (!prod && !flower && !country) continue;
  if (String(prod).includes('Total')) continue;
  const name = [country, flower, prod].filter(Boolean).join(' / ');
  for (const [ci, week] of Object.entries(shillaWeekCols)) {
    const q = Number(row[Number(ci)]);
    if (q > 0) pivotLines.push({ week, name, prod: prod || name, q, outDate: String(outDate || '') });
  }
}

const juneWeeks = ['23-02', '24-01', '24-02', '25-01', '25-02', '26-01', '26-02'];
const portal = portalFixed.trim().split('\n').map((line) => {
  const [date, name, qty, price, amt] = line.split('\t');
  return { date, name, qty: +qty, price: +price, amt: +amt };
});

function normPortalName(n) {
  return n.replace(/^\[수입\]\s*/, '').replace(/^꽃,\s*/, '행사용꽃, ').trim();
}

function portalKey(n) {
  const s = normPortalName(n);
  const m = s.match(/행사용꽃,\s*([^,]+),\s*([^,(]+)/);
  if (!m) return s;
  return `${m[1].trim()}|${m[2].trim()}`;
}

const portalByDate = {};
const portalByProduct = {};
portal.forEach((p) => {
  portalByDate[p.date] = (portalByDate[p.date] || 0) + p.amt;
  const k = portalKey(p.name);
  if (!portalByProduct[k]) portalByProduct[k] = { qty: 0, amt: 0, lines: 0, samples: [] };
  portalByProduct[k].qty += p.qty;
  portalByProduct[k].amt += p.amt;
  portalByProduct[k].lines += 1;
  if (portalByProduct[k].samples.length < 2) portalByProduct[k].samples.push(p.name);
});

const pivotJune = pivotLines.filter((l) => juneWeeks.includes(l.week));
const pivotByWeek = {};
pivotJune.forEach((l) => { pivotByWeek[l.week] = (pivotByWeek[l.week] || 0) + l.q; });

const mappings = [
  { portal: '안스리움|화이트', pivot: /Anthurium Graciosa/i, unit: 'EA' },
  { portal: '호접|화이트', pivot: /White 8/i, unit: 'EA' },
  { portal: '호접|염색', pivot: /Spray.*blue|Spray/i, unit: 'EA' },
  { portal: '수국|연그린', pivot: /S\/GN|연그린/i, unit: 'EA' },
  { portal: '수국|연블루', pivot: /Blue|블루/i, unit: 'EA' },
  { portal: '수국|진그린', pivot: /Esmeral|진그린/i, unit: 'EA' },
  { portal: '시네신스|화이트', pivot: /Sinensis white/i, unit: 'PK' },
  { portal: '시네신스|연핑크', pivot: /light pink/i, unit: 'PK' },
  { portal: '장미|몬디알', pivot: /Mondial/i, unit: 'PK' },
  { portal: '장미|쉬머', pivot: /Shimmer/i, unit: 'PK' },
  { portal: '카네이션|프라도민트', pivot: /Prado|프라도/i, unit: 'PK' },
  { portal: '카네이션|로다스', pivot: /Rodas|로다스/i, unit: 'PK' },
];

console.log('=== PIVOT: 신라 출고 by 차수 (수량만) ===');
Object.entries(pivotByWeek).forEach(([w, q]) => console.log(w, q.toFixed(2)));

console.log('\n=== PORTAL: 6월 일자별 금액 ===');
Object.entries(portalByDate).sort().forEach(([d, a]) => console.log(d, Math.round(a).toLocaleString()));

const portalTotalAmt = portal.reduce((s, p) => s + p.amt, 0);
const portalTotalQty = portal.reduce((s, p) => s + p.qty, 0);
console.log('\nPORTAL TOTAL qty', portalTotalQty, 'amt', Math.round(portalTotalAmt).toLocaleString());

console.log('\n=== 품목별 비교 (portal qty vs pivot qty in weeks 23-02~26-02) ===');
console.log('portalKey'.padEnd(22), 'pQty'.padStart(7), 'pAmt'.padStart(12), 'pvQty'.padStart(8), 'diff'.padStart(8));
for (const m of mappings) {
  const p = portalByProduct[m.portal] || { qty: 0, amt: 0 };
  const pv = pivotJune.filter((l) => m.pivot.test(l.prod) || m.pivot.test(l.name)).reduce((s, l) => s + l.q, 0);
  console.log(
    m.portal.padEnd(22),
    String(p.qty).padStart(7),
    Math.round(p.amt).toLocaleString().padStart(12),
    pv.toFixed(1).padStart(8),
    (p.qty - pv).toFixed(1).padStart(8),
  );
}

console.log('\n=== PIVOT rows with outDate filled ===');
const withDate = pivotLines.filter((l) => l.outDate);
console.log('count', withDate.length, withDate.slice(0, 5));

console.log('\n=== PIVOT june weeks detail (top) ===');
const byProd = {};
pivotJune.forEach((l) => { byProd[l.prod] = (byProd[l.prod] || 0) + l.q; });
Object.entries(byProd).sort((a, b) => b[1] - a[1]).slice(0, 15).forEach(([p, q]) => console.log(q.toFixed(2).padStart(8), p));
