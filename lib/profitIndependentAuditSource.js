import { createHash } from 'node:crypto';
import { getPool, sql } from './db.js';
import { CASE_CATEGORY, refreshProfitCategorySql, stockablePurchaseItemSql } from './profitReport.js';
import { auditStockRange, STOCK_SP_SHA256 } from './profitIndependentAudit.mjs';

const scopeSql = alias => `((${alias}.OrderYear=@year AND TRY_CONVERT(int,LEFT(${alias}.OrderWeek,2)) BETWEEN 1 AND @major)
  OR (${alias}.OrderYear=@previousYear AND TRY_CONVERT(int,LEFT(${alias}.OrderWeek,2)) BETWEEN 52 AND 53))`;
export function independentSourceSql() {
  return `
SELECT sm.StockKey,sm.OrderYear,sm.OrderWeek,sm.OrderYearWeek FROM StockMaster sm
 WHERE ${scopeSql('sm')} ORDER BY sm.OrderYear,sm.OrderWeek,sm.StockKey;
SELECT ps.StockKey,ps.ProdKey,ps.Stock FROM ProductStock ps JOIN StockMaster sm ON sm.StockKey=ps.StockKey
 WHERE ${scopeSql('sm')} ORDER BY ps.StockKey,ps.ProdKey,ps.Stock;
SELECT p.ProdKey,p.ProdName,p.DisplayName,p.OutUnit,p.EstUnit,p.BunchOf1Box,p.SteamOf1Box,p.SteamOf1Bunch,
 p.isDeleted,${CASE_CATEGORY} AS Category,CASE WHEN ${stockablePurchaseItemSql('p')} THEN 1 ELSE 0 END AS Stockable
 FROM Product p ORDER BY p.ProdKey;
SELECT v.OrderYear,v.OrderWeek,v.ProdKey,v.OutQuantity FROM ViewWarehouse v
 WHERE ${scopeSql('v')} ORDER BY v.OrderYear,v.OrderWeek,v.ProdKey,v.OutQuantity;
SELECT v.OrderYear,v.OrderWeek,v.ProdKey,v.OutQuantity FROM ViewShipment v
 WHERE ${scopeSql('v')} AND v.DetailFix=1 ORDER BY v.OrderYear,v.OrderWeek,v.ProdKey,v.OutQuantity;
SELECT h.StockHistoryKey,h.OrderYear,h.OrderWeek,h.ProdKey,h.BeforeValue,h.AfterValue,h.ChangeType,h.Descr,
 (SELECT COUNT(*) FROM CodeInfo ci WHERE ci.Category=N'StockType' AND ci.Descr=h.ChangeType) AS TypeMatches
 FROM StockHistory h WHERE ${scopeSql('h')}
 AND EXISTS(SELECT 1 FROM CodeInfo ci WHERE ci.Category=N'StockType' AND ci.Descr=h.ChangeType)
 ORDER BY h.StockHistoryKey;
SELECT e.OrderYear,e.OrderWeek,e.ProdKey,e.Price,e.EvidenceStatus,e.SourceRef,e.EffectiveAt,e.ConfirmedBy,e.ConfirmedAt
 FROM WebStockPriceEvidence e WHERE ${scopeSql('e')}
 ORDER BY e.OrderYear,e.OrderWeek,e.ProdKey,e.Price;
SELECT OBJECT_DEFINITION(OBJECT_ID(N'dbo.usp_StockCalculation')) AS Definition;
SELECT COUNT(*) AS InvalidCount FROM StockMaster sm WHERE sm.OrderYear=@year
 AND (sm.OrderWeek IS NULL OR sm.OrderWeek NOT LIKE N'[0-9][0-9]-[0-9][0-9]');
`;
}

export async function readIndependentSources(scope, signal) {
  signal?.throwIfAborted();
  const pool = await getPool();
  const request = pool.request();
  request.input('year', sql.NVarChar, scope.year);
  request.input('previousYear', sql.NVarChar, String(Number(scope.year) - 1));
  request.input('major', sql.Int, Number(scope.major));
  const cancel = () => request.cancel();
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    const result = await request.query(independentSourceSql());
    signal?.throwIfAborted();
    if (result.recordsets.reduce((n, rows) => n + rows.length, 0) > 600000) throw new Error('AUDIT_SOURCE_LIMIT');
    const [masters, stocks, products, incoming, outgoing, adjustments, prices, definitions, invalid] = result.recordsets;
    const policyHash = createHash('sha256').update(definitions[0]?.Definition || '').digest('hex');
    const data = { masters, stocks, products, incoming, outgoing, adjustments, prices };
    // Hash every relevant source row, not COUNT/CHECKSUM or only rounded aggregates.
    const hash = createHash('sha256').update(JSON.stringify({ data, policyHash, invalid })).digest('hex');
    return { data, hash, policyHash, invalidKeyCount: invalid[0]?.InvalidCount || 0 };
  } finally { signal?.removeEventListener('abort', cancel); }
}

export async function collectIndependentAudit(scope, signal) {
  refreshProfitCategorySql(true);
  const startedAt = new Date().toISOString();
  const before = await readIndependentSources(scope, signal);
  const after = await readIndependentSources(scope, signal);
  const integrity = { status: before.hash !== after.hash ? 'STALE' : after.policyHash !== STOCK_SP_SHA256 ? 'POLICY_CONFLICT' : 'STABLE_OBSERVED',
    startedAt, finishedAt: new Date().toISOString(), sourceHash: after.hash, policyHash: after.policyHash,
    atomicSnapshot: false, invalidKeyCount: after.invalidKeyCount };
  const result = auditStockRange(after.data, scope, integrity);
  return { ...result, legacyMarkerCount: after.invalidKeyCount };
}
