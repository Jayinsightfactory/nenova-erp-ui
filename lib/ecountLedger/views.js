// ecount.cmp_* 대조 뷰 생성(CREATE OR ALTER VIEW, 멱등). Raw 열 이름이 이카운트 헤더(한글) 또는 옛 적재 키(영문)라
// 실제 존재하는 열만 COALESCE 로 흡수해 SQL 을 만든다. dbo 는 SELECT 만, 쓰기는 ecount 스키마의 뷰 정의뿐.
import { query, sql } from '../db.js';
import { getRawColumns } from './schema.js';
import { qualifiedRaw, quoteIdent } from './core.js';

export const VIEW_NAMES = ['cmp_sales_daily', 'cmp_ar_balance', 'cmp_customer_master', 'cmp_product_master'];

export const CANDIDATES = {
  date: ['일자', '판매일자', '입출금일', 'refDate'],
  cust: ['거래처명', '거래처', '상호', 'custName'],
  custCode: ['거래처코드', 'custCode'],
  total: ['합계', 'total'],
  balance: ['잔액', 'balance'],
  prodName: ['품목명', '품목명(규격)', 'prodName'],
  prodCode: ['품목코드', 'prodCode'],
};

// 존재하는 후보 열만 COALESCE(NULLIF(LTRIM(RTRIM(..)),'')). 없으면 NULL.
export function pick(cols, list, alias = 'r') {
  // 정확 일치 우선, 없으면 접두 일치(이카운트 헤더 '일자-No.', '단가(vat포함)' 처럼 접미가 붙는 경우 흡수)
  const have = new Map(cols.map((c) => [c.toLowerCase(), c]));
  const exact = list.map((n) => have.get(n.toLowerCase())).filter(Boolean);
  const prefix = exact.length ? [] : list.flatMap((n) => cols.filter((c) => c.toLowerCase().startsWith(n.toLowerCase()) && /^[-(（ \s]/.test(c.slice(n.length))));
  const hit = [...new Set([...exact, ...prefix])];
  if (!hit.length) return 'CAST(NULL AS NVARCHAR(400))';
  const parts = hit.map((c) => `NULLIF(LTRIM(RTRIM(${alias}.${quoteIdent(c)})), N'')`);
  return parts.length === 1 ? parts[0] : `COALESCE(${parts.join(', ')})`;
}
const NUM = (x) => `TRY_CONVERT(DECIMAL(18,2), REPLACE(REPLACE(REPLACE(${x}, N',', N''), N' ', N''), N'₩', N''))`;
const DATE = (x) => `TRY_CONVERT(DATE, REPLACE(LEFT(LTRIM(${x}), 10), N'/', N'-'))`;

// 이름 → CustKey (CustName 과 Customer.Descr 첫 '/' 앞 간판명 둘 다)
const CUST_NAME_MAP = `nm AS (
  SELECT Name, MIN(CustKey) AS CustKey FROM (
    SELECT LTRIM(RTRIM(c.CustName)) AS Name, c.CustKey FROM dbo.Customer c WHERE ISNULL(c.isDeleted, 0) = 0
    UNION ALL
    SELECT LTRIM(RTRIM(LEFT(c.Descr, CHARINDEX(N'/', c.Descr + N'/') - 1))), c.CustKey FROM dbo.Customer c WHERE ISNULL(c.isDeleted, 0) = 0 AND c.Descr IS NOT NULL
  ) x WHERE Name IS NOT NULL AND Name <> N'' GROUP BY Name
)`;

export function buildSalesDaily(cols) {
  const date = pick(cols, CANDIDATES.date); const cust = pick(cols, CANDIDATES.cust); const tot = pick(cols, CANDIDATES.total);
  if (/^CAST\(NULL/.test(date) || /^CAST\(NULL/.test(tot)) return null;
  return `CREATE OR ALTER VIEW ecount.cmp_sales_daily AS
WITH ${CUST_NAME_MAP},
ecraw AS (
  SELECT ${DATE(date)} AS SaleDate, ${cust} AS EcName, ${NUM(tot)} AS Amt
  FROM ${qualifiedRaw('E040207')} r WHERE r.IsSubtotal = 0
),
ecn AS (SELECT SaleDate, EcName, SUM(Amt) AS EcAmt FROM ecraw WHERE SaleDate IS NOT NULL GROUP BY SaleDate, EcName),
ecm AS (SELECT e.SaleDate, e.EcName, e.EcAmt, nm.CustKey FROM ecn e LEFT JOIN nm ON nm.Name = LTRIM(RTRIM(e.EcName))),
ecc AS (
  SELECT SaleDate, CustKey, MAX(EcName) AS EcName, SUM(EcAmt) AS EcAmt FROM ecm
  GROUP BY SaleDate, CustKey, CASE WHEN CustKey IS NULL THEN EcName END
),
rng AS (SELECT MIN(SaleDate) AS d1, MAX(SaleDate) AS d2 FROM ecc),
ours AS (
  SELECT CAST(sd.ShipmentDtm AS DATE) AS SaleDate, sm.CustKey, SUM(ISNULL(sd.Amount, 0) + ISNULL(sd.Vat, 0)) AS OurAmt
  FROM dbo.ShipmentMaster sm
  JOIN dbo.ShipmentDetail sd ON sm.ShipmentKey = sd.ShipmentKey
  CROSS JOIN rng
  WHERE sm.isDeleted = 0 AND ISNULL(sd.isFix, 0) = 1
    AND CAST(sd.ShipmentDtm AS DATE) BETWEEN rng.d1 AND rng.d2
  GROUP BY CAST(sd.ShipmentDtm AS DATE), sm.CustKey
)
SELECT COALESCE(e.SaleDate, o.SaleDate) AS SaleDate,
       COALESCE(e.CustKey, o.CustKey) AS CustKey,
       COALESCE(e.EcName, cu.CustName) AS CustName,
       ISNULL(e.EcAmt, 0) AS EcountAmt,
       ISNULL(o.OurAmt, 0) AS OurAmt,
       ISNULL(e.EcAmt, 0) - ISNULL(o.OurAmt, 0) AS Diff,
       CASE WHEN e.SaleDate IS NULL THEN N'ours_only' WHEN o.SaleDate IS NULL THEN N'ecount_only' ELSE N'both' END AS MatchState
FROM ecc e
FULL OUTER JOIN ours o ON e.SaleDate = o.SaleDate AND e.CustKey = o.CustKey
LEFT JOIN dbo.Customer cu ON cu.CustKey = COALESCE(e.CustKey, o.CustKey)`;
}

export function buildArBalance(cols, hasLedger) {
  const cust = pick(cols, CANDIDATES.cust); const bal = pick(cols, CANDIDATES.balance);
  if (/^CAST\(NULL/.test(cust) || /^CAST\(NULL/.test(bal)) return null;
  const paid = hasLedger
    ? `SELECT CustKey, SUM(Amount) AS TotalPaid FROM dbo.ReceivableLedger WHERE LedgerType = N'입금' AND isDeleted = 0 GROUP BY CustKey`
    : `SELECT CAST(NULL AS INT) AS CustKey, CAST(0 AS DECIMAL(18,2)) AS TotalPaid WHERE 1 = 0`;
  // lib/mgmt/receivables.js getArBalances 와 같은 계산: 청구=isFix=1 Amount+Vat, 입금=ReceivableLedger 입금, 거래처=청구가 있는 곳
  return `CREATE OR ALTER VIEW ecount.cmp_ar_balance AS
WITH ${CUST_NAME_MAP},
ecr AS (
  SELECT ${cust} AS EcName, ${NUM(bal)} AS EcBalance,
         ROW_NUMBER() OVER (PARTITION BY ${cust} ORDER BY r.BatchKey DESC, r.RowKey DESC) AS rn
  FROM ${qualifiedRaw('E040214')} r WHERE r.IsSubtotal = 0
),
ecm AS (SELECT e.EcName, e.EcBalance, nm.CustKey FROM ecr e LEFT JOIN nm ON nm.Name = LTRIM(RTRIM(e.EcName)) WHERE e.rn = 1 AND e.EcName IS NOT NULL),
ecc AS (SELECT CustKey, MAX(EcName) AS EcName, SUM(EcBalance) AS EcBalance FROM ecm GROUP BY CustKey, CASE WHEN CustKey IS NULL THEN EcName END),
sales AS (
  SELECT sm.CustKey, SUM(ISNULL(sd.Amount, 0) + ISNULL(sd.Vat, 0)) AS TotalSales
  FROM dbo.ShipmentMaster sm
  JOIN dbo.ShipmentDetail sd ON sm.ShipmentKey = sd.ShipmentKey
  JOIN dbo.Customer c ON sm.CustKey = c.CustKey AND c.isDeleted = 0
  JOIN dbo.Product p ON sd.ProdKey = p.ProdKey AND p.isDeleted = 0
  WHERE sm.isDeleted = 0 AND ISNULL(sd.isFix, 0) = 1
  GROUP BY sm.CustKey
),
paid AS (${paid}),
ours AS (SELECT s.CustKey, s.TotalSales - ISNULL(p.TotalPaid, 0) AS OurBalance FROM sales s LEFT JOIN paid p ON p.CustKey = s.CustKey)
SELECT COALESCE(e.CustKey, o.CustKey) AS CustKey,
       COALESCE(e.EcName, cu.CustName) AS CustName,
       ISNULL(e.EcBalance, 0) AS EcountBalance,
       ISNULL(o.OurBalance, 0) AS OurBalance,
       ISNULL(e.EcBalance, 0) - ISNULL(o.OurBalance, 0) AS Diff,
       CASE WHEN e.EcName IS NULL THEN N'ours_only' WHEN e.CustKey IS NULL OR o.CustKey IS NULL THEN N'ecount_only' ELSE N'both' END AS MatchState
FROM ecc e
FULL OUTER JOIN ours o ON e.CustKey = o.CustKey
LEFT JOIN dbo.Customer cu ON cu.CustKey = COALESCE(e.CustKey, o.CustKey)`;
}

export function buildCustomerMaster(cols) {
  const name = pick(cols, CANDIDATES.cust); const code = pick(cols, CANDIDATES.custCode);
  if (/^CAST\(NULL/.test(name)) return null;
  return `CREATE OR ALTER VIEW ecount.cmp_customer_master AS
WITH ${CUST_NAME_MAP},
ec AS (SELECT DISTINCT ${code} AS EcCode, ${name} AS EcName FROM ${qualifiedRaw('E010101')} r WHERE r.IsSubtotal = 0)
SELECT e.EcCode, e.EcName, COALESCE(nm.CustKey, cc.CustKey) AS CustKey,
       CASE WHEN COALESCE(nm.CustKey, cc.CustKey) IS NULL THEN 0 ELSE 1 END AS Matched
FROM ec e
LEFT JOIN nm ON nm.Name = LTRIM(RTRIM(e.EcName))
LEFT JOIN dbo.Customer cc ON cc.CustCode = e.EcCode AND ISNULL(cc.isDeleted, 0) = 0
WHERE e.EcName IS NOT NULL OR e.EcCode IS NOT NULL`;
}

export function buildProductMaster(cols) {
  const name = pick(cols, CANDIDATES.prodName); const code = pick(cols, CANDIDATES.prodCode);
  if (/^CAST\(NULL/.test(name)) return null;
  return `CREATE OR ALTER VIEW ecount.cmp_product_master AS
WITH pm AS (
  SELECT Name, MIN(ProdKey) AS ProdKey FROM (
    SELECT LTRIM(RTRIM(p.ProdName)) AS Name, p.ProdKey FROM dbo.Product p WHERE ISNULL(p.isDeleted, 0) = 0
    UNION ALL SELECT LTRIM(RTRIM(p.DisplayName)), p.ProdKey FROM dbo.Product p WHERE ISNULL(p.isDeleted, 0) = 0 AND p.DisplayName IS NOT NULL
  ) x WHERE Name IS NOT NULL AND Name <> N'' GROUP BY Name
),
ec AS (SELECT DISTINCT ${code} AS EcCode, ${name} AS EcName FROM ${qualifiedRaw('E040103')} r WHERE r.IsSubtotal = 0)
SELECT e.EcCode, e.EcName, COALESCE(pm.ProdKey, pc.ProdKey) AS ProdKey,
       CASE WHEN COALESCE(pm.ProdKey, pc.ProdKey) IS NULL THEN 0 ELSE 1 END AS Matched
FROM ec e
LEFT JOIN pm ON pm.Name = LTRIM(RTRIM(e.EcName))
LEFT JOIN dbo.Product pc ON pc.ProdCode = e.EcCode AND ISNULL(pc.isDeleted, 0) = 0
WHERE e.EcName IS NOT NULL OR e.EcCode IS NOT NULL`;
}

async function rawExists(prgId) {
  const r = await query(`SELECT OBJECT_ID(@t, N'U') AS id`, { t: { type: sql.NVarChar, value: `ecount.Raw_${prgId}` } });
  return !!r.recordset[0].id;
}

// 존재하는 Raw 테이블에 대해서만 뷰 생성. 반환: 생성/건너뜀 목록
export async function ensureCompareViews() {
  const out = { created: [], skipped: [] };
  const ledger = await query(`SELECT OBJECT_ID(N'dbo.ReceivableLedger', N'U') AS id`);
  const hasLedger = !!ledger.recordset[0].id;
  const plan = [
    ['cmp_sales_daily', 'E040207', (c) => buildSalesDaily(c)],
    ['cmp_ar_balance', 'E040214', (c) => buildArBalance(c, hasLedger)],
    ['cmp_customer_master', 'E010101', (c) => buildCustomerMaster(c)],
    ['cmp_product_master', 'E040103', (c) => buildProductMaster(c)],
  ];
  for (const [view, prg, build] of plan) {
    if (!(await rawExists(prg))) { out.skipped.push(`${view}: Raw_${prg} 없음`); continue; }
    const ddl = build(await getRawColumns(prg));
    if (!ddl) { out.skipped.push(`${view}: 필요한 열(일자/합계/거래처명/잔액) 없음`); continue; }
    await query(ddl);
    out.created.push(view);
  }
  return out;
}
