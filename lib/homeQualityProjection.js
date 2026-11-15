import {qualityScope, qualitySignals, qualitySourceCoverage} from './farmQuality.js';
import {buildQualityInbox} from './farmQualityInbox.js';

// A home read needs case membership and the last three events. Fetch the five
// year-scoped sets in one round trip. An empty year needs no source analysis.
const homeQualitySql = `
SELECT CaseKey, OrderYear, InboxKey, SourceKey, Title, Status, DueDate, UpdatedAt,
       Version, FarmName, ProductName
FROM dbo.WebFarmQualityCase WHERE OrderYear=@year ORDER BY UpdatedAt DESC;
IF @@ROWCOUNT=0 RETURN;

SELECT d.DeductionKey, d.OrderYear, d.OrderWeek, d.CustKey, d.CustName, d.ProdKey,
       d.ProdName, d.FarmKey, d.FarmName, d.SourceUnit, d.Quantity, d.OriginalQuantity,
       d.ImportConfirmed, d.IsDeleted, p.FlowerName,
       COALESCE(NULLIF(p.DisplayName,N''),p.ProdName,d.ProdName) ProductName,
       COALESCE(NULLIF(LTRIM(RTRIM(d.FarmName)),N''),NULLIF(LTRIM(RTRIM(f.FarmName)),N''),N'') ResolvedFarmName
FROM dbo.WebSalesDefectDeduction d
LEFT JOIN dbo.Product p ON p.ProdKey=d.ProdKey
LEFT JOIN dbo.Farm f ON f.FarmKey=d.FarmKey AND ISNULL(f.isDeleted,0)=0
WHERE d.OrderYear=@year AND d.DeductionType=N'불량차감';
SELECT InboxKey, OrderYear, Version, Excluded, ExcludedAt, ExclusionReason
FROM dbo.WebFarmQualityInbox WHERE OrderYear=@year;
SELECT InboxKey, SourceKey, OrderYear, LinkedAt
FROM dbo.WebFarmQualityInboxSource WHERE OrderYear=@year;
SELECT c.CaseKey, e.Kind, e.Body, e.CreatedAt
FROM dbo.WebFarmQualityCase c CROSS APPLY (
  SELECT TOP (3) EventKey, Kind, Body, CreatedAt FROM dbo.WebFarmQualityEvent
  WHERE CaseKey=c.CaseKey ORDER BY EventKey DESC
) e WHERE c.OrderYear=@year ORDER BY c.CaseKey, e.EventKey;`;

const asIso = value => value instanceof Date ? value.toISOString() : value || null;

export async function loadHomeQuality(input, runQuery) {
  const scope = qualityScope(input);
  const {recordsets} = await runQuery(homeQualitySql, scope.year);
  const [records, sources, inboxes, links, events] = recordsets;
  if (!records.length) return {cases:[], coverage:{rows:[]}, inbox:{items:[]}};
  const recent = new Map();
  for (const row of events) {
    const key = String(row.CaseKey).toLowerCase();
    if (!recent.has(key)) recent.set(key, []);
    recent.get(key).push({Kind:row.Kind, Body:row.Body, CreatedAt:asIso(row.CreatedAt)});
  }
  const cases = records.map(row => {
    const CaseKey = String(row.CaseKey).toLowerCase();
    const RecentEvents = recent.get(CaseKey) || [];
    return {...row, CaseKey, RecentEvents, LatestBody:RecentEvents.at(-1)?.Body,
      UpdatedAt:asIso(row.UpdatedAt), DueDate:asIso(row.DueDate)?.slice(0,10) || null};
  });
  // Inbox identity uses the original deduction name. The case anchor may use
  // the farm master fallback, just as the detailed feedback page does.
  const signals = qualitySignals(sources, scope);
  const inbox = buildQualityInbox({scope, sources, signals, inboxes, links, cases:records});
  const coverage = qualitySourceCoverage(sources.map(row => ({...row, FarmName:row.ResolvedFarmName})), scope);
  return {cases, inbox:{items:inbox.items.filter(item => item.caseKeys.length)}, coverage};
}
