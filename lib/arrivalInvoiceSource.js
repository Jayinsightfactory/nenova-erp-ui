import { readInvoiceCosts } from './invoiceReceiptCost.js';
import { arrivalWeekPredicate, normalizeArrivalWeek } from './arrivalImportPolicy.js';

const COUNTRY_NAMES = { TH:'태국', NL:'네덜란드', CN:'중국', CO:'콜롬비아', EC:'에콰도르', AU:'호주', US:'미국', VN:'베트남', NZ:'뉴질랜드' };
export const invoiceArrivalUnit = unit => ({ BUNCH:'단', STEM:'송이', BOX:'박스' }[String(unit).toUpperCase()] || String(unit || ''));

// Only the same live-validated approval used by the receipt/export screen may enter the main list.
export function invoiceArrivalRows(costs, candidate, year, week = '') {
  const actual = costs?.currentActual;
  const input = actual?.editableInput?.input;
  if (input?.expenseBasis === 'TEST_ONLY' || actual?.expenseBasis === 'TEST_ONLY') return [];
  if (!actual || costs.status !== 'APPROVED' || costs.documentCostStatus !== 'APPROVED'
    || actual.status !== 'APPROVED' || actual.storedStatus !== 'APPROVED' || actual.basis !== 'ACTUAL'
    || actual.liveReceiptStatus !== 'MATCH' || String(actual.orderYear) !== year
    || actual.documentId !== costs.documentId || actual.documentRevision !== costs.documentRevision
    || actual.operationId !== costs.operationId || actual.warehouseKey !== Number(candidate.WarehouseKey)
    || (candidate.DocumentId && actual.documentId !== String(candidate.DocumentId).toLowerCase())
    || (week && normalizeArrivalWeek(actual.orderWeek) !== normalizeArrivalWeek(week))) return [];
  const ids = new Set();
  return actual.lines.filter(line => line.quantity > 0 && line.costPerUnitKRW != null).map(line => {
    const id = `invoice:${actual.costRevisionId}:${line.lineId}`;
    if (ids.has(id)) throw new Error('인보이스 승인 원가에 중복 행이 있습니다. 원가 작업을 확인하세요.');
    ids.add(id);
    const c = line.componentAmounts;
    const fixed = c && Number.isFinite(c.customsKRW ?? 0) && Number.isFinite(c.otherKRW ?? 0)
      ? ((c.customsKRW ?? 0) + (c.otherKRW ?? 0)) / line.quantity : null;
    const variableTotal = c && ((c.cnfKRW ?? ((c.goodsKRW ?? NaN) + (c.freightKRW ?? NaN))) + (c.tariffKRW ?? 0));
    const reconciled = Number.isFinite(variableTotal) && fixed != null
      && Math.abs(variableTotal / line.quantity + fixed - line.costPerUnitKRW) < 0.01;
    return {
      ArrivalLineKey:id, ImportKey:0, OrderYear:year, OrderWeek:normalizeArrivalWeek(actual.orderWeek),
      CountryName:COUNTRY_NAMES[candidate.Country] || candidate.Country || '',
      FlowerNameRaw:'', ProductNameRaw:'', FarmNameRaw:candidate.FarmName || '',
      ProdKey:line.prodKey, FarmKey:candidate.FarmKey, Unit:invoiceArrivalUnit(line.unit), Quantity:line.quantity,
      SourceArrivalCostKRW:line.costPerUnitKRW, SelectedArrivalCostKRW:line.costPerUnitKRW,
      AllocationBasis:'SOURCE', MatchStatus:'MATCHED', IsCurrent:true,
      SourceFileName:candidate.SourceFileName || '', SheetName:actual.invoiceNo || '', SourceRow:null,
      Notes:`인보이스 자동 원가 · 송장 ${actual.invoiceNo || '-'} · 입고 ${actual.warehouseKey} · 승인 ${actual.revisionNo}`,
      CreatedAt:actual.createdAt, UpdatedAt:actual.approvedAt,
      SourceKind:'INVOICE', SourceRevision:actual.revisionNo,
      Currency:input?.nativeCurrency || '', ExchangeRate:input?.exchangeRateKRW ?? null,
      FixedPerUnitKRW:reconciled ? fixed : null,
      SourceStemsPerBunch:input?.lineInputs?.find(row => row.lineId === line.lineId)?.stemsPerBunch ?? null,
      ExpenseBasis:input?.expenseBasis || '',
    };
  });
}

export async function loadArrivalInvoiceRows({ queryFn, types, year, week = '', readCosts = readInvoiceCosts }) {
  const ready = await queryFn(`/* arrival-invoice:schema */ SELECT CASE WHEN
    OBJECT_ID(N'dbo.WebInvoiceCostRevision',N'U') IS NOT NULL AND OBJECT_ID(N'dbo.WebInvoiceCostLine',N'U') IS NOT NULL
    AND OBJECT_ID(N'dbo.WebInvoiceDocument',N'U') IS NOT NULL AND OBJECT_ID(N'dbo.WebInvoiceOperation',N'U') IS NOT NULL
    THEN 1 ELSE 0 END AS Available`);
  if (!ready.recordset?.[0]?.Available) return { rows:[], warnings:[] };
  const params = { year:{type:types.NVarChar,value:year} };
  if (week) params.week={type:types.NVarChar,value:week};
  const candidates = await queryFn(`/* arrival-invoice:candidates */ SELECT DISTINCT o.WarehouseKey,d.DocumentId,d.FarmKey,
    wm.FarmName,JSON_VALUE(d.ReviewedMetadataJson,'$.country') AS Country,d.OriginalFileName AS SourceFileName
    FROM dbo.WebInvoiceOperation o JOIN dbo.WebInvoiceDocument d ON d.DocumentId=o.DocumentId
    JOIN dbo.WarehouseMaster wm ON wm.WarehouseKey=o.WarehouseKey
    WHERE d.OrderYear=@year AND CONVERT(nvarchar(4),wm.OrderYear)=@year
    ${week ? `AND ${arrivalWeekPredicate('d.OrderWeek')}` : ''}
    AND o.Status=N'COMMITTED' AND EXISTS (SELECT 1 FROM dbo.WebInvoiceCostRevision r
      WHERE r.WarehouseKey=o.WarehouseKey AND r.Basis=N'ACTUAL' AND r.Status=N'APPROVED')`,params);
  const rows=[],warnings=[],groups=new Map();
  for (const candidate of candidates.recordset) {
    const key = candidate.WarehouseKey;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(candidate);
  }
  const receipts = [...groups.values()];
  // Two workers bound SQL pressure; no persistent cache can hide receipt changes.
  let next=0;
  async function worker(){
    while(next<receipts.length){
      const candidatesForReceipt=receipts[next++];
      const candidate=candidatesForReceipt[0];
      const costs=await readCosts({queryFn,types,warehouseKey:candidate.WarehouseKey});
      const matchingCandidate=candidatesForReceipt.find(row => String(row.DocumentId).toLowerCase() === costs?.currentActual?.documentId);
      const current=matchingCandidate ? invoiceArrivalRows(costs,matchingCandidate,year,week) : [];
      rows.push(...current);
      if(!current.length) warnings.push(`입고 ${candidate.WarehouseKey}: 원가 승인 후 문서·입고가 변경됐거나 현재 승인 원가가 없어 자동 원가를 제외했습니다.`);
    }
  }
  await Promise.all([worker(),worker()]);
  return {rows,warnings};
}

// Explicit types keep paging/filtering in SQL and never expose raw source/snapshot JSON.
const fields={
  ArrivalLineKey:'nvarchar(120)',ImportKey:'int',OrderYear:'nvarchar(4)',OrderWeek:'nvarchar(10)',CountryName:'nvarchar(100)',
  FlowerNameRaw:'nvarchar(200)',ProductNameRaw:'nvarchar(500)',FarmNameRaw:'nvarchar(200)',ProdKey:'int',FarmKey:'int',
  Unit:'nvarchar(40)',Quantity:'decimal(28,6)',FobUSD:'decimal(28,6)',FreightPerUnitUSD:'decimal(28,6)',
  CustomsPerUnitKRW:'decimal(28,6)',OtherPerUnitKRW:'decimal(28,6)',SourceArrivalCostKRW:'decimal(28,6)',SourceArrivalCostVatKRW:'decimal(28,6)',
  SelectedArrivalCostKRW:'decimal(28,6)',ExchangeRate:'decimal(28,6)',GrossWeight:'decimal(28,6)',ChargeableWeight:'decimal(28,6)',
  FreightUSD:'decimal(28,6)',InvoiceUSD:'decimal(28,6)',WeightMetricShare:'decimal(28,8)',VolumeMetricShare:'decimal(28,8)',ValueMetricShare:'decimal(28,8)',
  AllocationBasis:'nvarchar(20)',MatchStatus:'nvarchar(40)',SourceFileName:'nvarchar(500)',SheetName:'nvarchar(200)',SourceRow:'int',Notes:'nvarchar(2000)',
  IsCurrent:'bit',CreatedAt:'datetime2',UpdatedAt:'datetime2',SourceKind:'nvarchar(20)',SourceRevision:'int',
};
const sameScope = `v.OrderYear=b.OrderYear AND v.ProdKey=b.ProdKey AND v.FarmKey=b.FarmKey
  AND v.CountryName=b.CountryName AND v.Unit=b.Unit
  AND TRY_CONVERT(int,PARSENAME(REPLACE(v.OrderWeek,N'-',N'.'),2))=TRY_CONVERT(int,PARSENAME(REPLACE(b.OrderWeek,N'-',N'.'),2))
  AND TRY_CONVERT(int,PARSENAME(REPLACE(v.OrderWeek,N'-',N'.'),1))=TRY_CONVERT(int,PARSENAME(REPLACE(b.OrderWeek,N'-',N'.'),1))`;
export function arrivalInvoiceSourceCte(includeHistory=false){
  const cols=Object.keys(fields);
  const legacy=cols.map(key=>key==='ArrivalLineKey'?'CONVERT(nvarchar(120),b.ArrivalLineKey) AS ArrivalLineKey':key==='SourceKind'?"N'EXCEL' AS SourceKind":key==='SourceRevision'?'NULL AS SourceRevision':`b.${key}`).join(',');
  return `WITH invoiceArrival AS (SELECT * FROM OPENJSON(@invoiceArrivalJson) WITH (${Object.entries(fields).map(([k,t])=>`${k} ${t}`).join(',')})),
    arrivalSource AS (
      SELECT ${legacy} FROM dbo.WebArrivalCostLine b
      ${includeHistory?'':`WHERE NOT EXISTS (SELECT 1 FROM invoiceArrival v WHERE ${sameScope})`}
      UNION ALL SELECT ${cols.map(k=>`v.${k}`).join(',')} FROM invoiceArrival v
    )`;
}
export const arrivalInvoiceComparisonSql = `OUTER APPLY (SELECT b.ArrivalLineKey,b.SourceFileName,b.SelectedArrivalCostKRW,b.Unit
  FROM dbo.WebArrivalCostLine b WHERE b.IsCurrent=1 AND l.SourceKind=N'INVOICE'
  AND ${sameScope.replaceAll('v.','l.')} FOR JSON PATH) legacyComparison(LegacyComparisonJson)`;
