import { buildProdGroupWhere } from './shipmentProdGroups.js';
export function distributionReadProductWhere(group, alias='p') {
  const text=String(group||'');
  if(text.endsWith('::')&&text.slice(0,-2))return {clause:`AND ${alias}.CounName=@pgCountry`,params:{pgCountry:{value:text.slice(0,-2)}}};
  return buildProdGroupWhere(group,alias);
}
export function sqlDistributionWorkspaceCustomers(group) {
  const {clause,params}=distributionReadProductWhere(group);
  return {params,statement:`WITH ScopeCustomers AS (
    SELECT DISTINCT om.CustKey FROM OrderMaster om
    JOIN Customer candidateCustomer ON candidateCustomer.CustKey=om.CustKey AND candidateCustomer.isDeleted=0
    JOIN OrderDetail od ON od.OrderMasterKey=om.OrderMasterKey AND od.isDeleted=0
    JOIN Product p ON p.ProdKey=od.ProdKey AND p.isDeleted=0
    WHERE om.OrderYear=@year AND om.OrderWeek=@week AND om.isDeleted=0 ${clause}
  )
  SELECT c.CustKey,c.CustName,c.CustArea,c.OrderCode,
    CAST(CASE WHEN s.CustKey IS NULL THEN 1 ELSE 0 END AS bit) noOrder
    FROM Customer c LEFT JOIN ScopeCustomers s ON s.CustKey=c.CustKey
    WHERE c.isDeleted=0 AND (s.CustKey IS NOT NULL OR NOT EXISTS(SELECT 1 FROM ScopeCustomers))
    ORDER BY c.CustArea,c.CustName`};
}
