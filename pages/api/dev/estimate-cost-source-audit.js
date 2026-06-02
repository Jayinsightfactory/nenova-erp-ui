import { query, sql } from '../../../lib/db';
import { withAuth } from '../../../lib/auth';

function toInt(value, fallback = 50) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 300) : fallback;
}

async function hasObject(name) {
  const r = await query(
    `SELECT OBJECT_ID(@name) AS objectId`,
    { name: { type: sql.NVarChar, value: name } }
  );
  return !!r.recordset?.[0]?.objectId;
}

async function columnsFor(name) {
  const r = await query(
    `SELECT c.name, t.name AS typeName
       FROM sys.columns c
       JOIN sys.types t ON c.user_type_id = t.user_type_id
      WHERE c.object_id = OBJECT_ID(@name)
      ORDER BY c.column_id`,
    { name: { type: sql.NVarChar, value: name } }
  );
  return r.recordset || [];
}

async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ success: false, error: 'Method not allowed' });

  const limit = toInt(req.query.limit);
  const week = String(req.query.week || '').trim();
  const params = { limit: { type: sql.Int, value: limit } };
  let weekWhere = '';
  if (week) {
    weekWhere = 'AND sm.OrderWeek = @week';
    params.week = { type: sql.NVarChar, value: week };
  }

  const farmExists = await hasObject('dbo.ShipmentFarm');
  const [shipmentDetailColumns, shipmentDateColumns, viewShipmentColumns, shipmentFarmColumns] = await Promise.all([
    columnsFor('dbo.ShipmentDetail'),
    columnsFor('dbo.ShipmentDate'),
    columnsFor('dbo.ViewShipment'),
    farmExists ? columnsFor('dbo.ShipmentFarm') : Promise.resolve([]),
  ]);

  const farmColumnNames = new Set(shipmentFarmColumns.map(c => String(c.name)));
  const farmHasSdetailKey = farmColumnNames.has('SdetailKey');
  const farmHasCost = farmColumnNames.has('Cost');
  const farmHasAmount = farmColumnNames.has('Amount');
  const farmHasVat = farmColumnNames.has('Vat');

  const rows = await query(
    `SELECT TOP (@limit)
       sd.SdetailKey,
       sdt.SdateKey,
       sm.ShipmentKey,
       sm.OrderWeek,
       sm.CustKey,
       c.CustName,
       sd.ProdKey,
       p.ProdName,
       ISNULL(sd.Cost,0) AS DetailCost,
       ISNULL(sd.Amount,0) AS DetailAmount,
       ISNULL(sd.Vat,0) AS DetailVat,
       ISNULL(sdt.Cost,0) AS DateCost,
       ISNULL(sdt.Amount,0) AS DateAmount,
       ISNULL(sdt.Vat,0) AS DateVat,
       ISNULL(vs.Cost,0) AS ViewCost,
       ISNULL(vs.Amount,0) AS ViewAmount,
       ISNULL(vs.Vat,0) AS ViewVat,
       ISNULL(vs.DetailFix,0) AS DetailFix,
       ISNULL(vs.MasterFix,0) AS MasterFix,
       ISNULL(sd.OutQuantity,0) AS DetailOutQuantity,
       ISNULL(sd.EstQuantity,0) AS DetailEstQuantity,
       ISNULL(sdt.ShipmentQuantity,0) AS DateShipmentQuantity,
       ISNULL(sdt.EstQuantity,0) AS DateEstQuantity,
       CONVERT(NVARCHAR(10), sd.ShipmentDtm, 120) AS DetailShipmentDtm,
       CONVERT(NVARCHAR(10), sdt.ShipmentDtm, 120) AS DateShipmentDtm,
       LEFT(ISNULL(sd.Descr,''), 500) AS DetailDescr
     FROM ShipmentDetail sd
     JOIN ShipmentMaster sm ON sm.ShipmentKey = sd.ShipmentKey
     LEFT JOIN ShipmentDate sdt ON sdt.SdetailKey = sd.SdetailKey
     LEFT JOIN ViewShipment vs ON vs.SdetailKey = sd.SdetailKey
     LEFT JOIN Customer c ON c.CustKey = sm.CustKey
     LEFT JOIN Product p ON p.ProdKey = sd.ProdKey
     WHERE ISNULL(sm.isDeleted,0)=0
       AND (ISNULL(sd.Descr,'') LIKE N'%] 단가 %→%' OR ISNULL(sd.Descr,'') LIKE N'%단가 %>%')
       ${weekWhere}
     ORDER BY sd.SdetailKey DESC`,
    params
  );

  let farmRows = [];
  if (farmExists && farmHasSdetailKey) {
    const selectFarmCost = farmHasCost ? 'ISNULL(sf.Cost,0) AS FarmCost' : 'NULL AS FarmCost';
    const selectFarmAmount = farmHasAmount ? 'ISNULL(sf.Amount,0) AS FarmAmount' : 'NULL AS FarmAmount';
    const selectFarmVat = farmHasVat ? 'ISNULL(sf.Vat,0) AS FarmVat' : 'NULL AS FarmVat';
    const farm = await query(
      `SELECT TOP (@limit)
         sf.SdetailKey,
         COUNT(*) AS FarmRows,
         ${selectFarmCost},
         ${selectFarmAmount},
         ${selectFarmVat}
       FROM ShipmentFarm sf
       JOIN ShipmentDetail sd ON sd.SdetailKey = sf.SdetailKey
       JOIN ShipmentMaster sm ON sm.ShipmentKey = sd.ShipmentKey
       WHERE (ISNULL(sd.Descr,'') LIKE N'%] 단가 %→%' OR ISNULL(sd.Descr,'') LIKE N'%단가 %>%')
         ${weekWhere}
       GROUP BY sf.SdetailKey${farmHasCost ? ', sf.Cost' : ''}${farmHasAmount ? ', sf.Amount' : ''}${farmHasVat ? ', sf.Vat' : ''}
       ORDER BY sf.SdetailKey DESC`,
      params
    );
    farmRows = farm.recordset || [];
  }

  const grouped = await query(
    `WITH Edited AS (
       SELECT DISTINCT sm.OrderYearWeek, sm.CustKey, sd.ProdKey
       FROM ShipmentDetail sd
       JOIN ShipmentMaster sm ON sm.ShipmentKey = sd.ShipmentKey
       WHERE ISNULL(sm.isDeleted,0)=0
         AND (ISNULL(sd.Descr,'') LIKE N'%] 단가 %→%' OR ISNULL(sd.Descr,'') LIKE N'%단가 %>%')
         ${weekWhere}
     )
     SELECT TOP (@limit)
       sm.OrderYearWeek,
       sm.OrderWeek,
       sm.ShipmentKey,
       sd.SdetailKey,
       sm.CustKey,
       c.CustName,
       sd.ProdKey,
       p.ProdName,
       ISNULL(sd.Cost,0) AS DetailCost,
       ISNULL(sdt.Cost,0) AS DateCost,
       ISNULL(vs.Cost,0) AS ViewCost,
       ISNULL(sd.EstQuantity,0) AS DetailEstQuantity,
       ISNULL(sdt.EstQuantity,0) AS DateEstQuantity,
       ISNULL(sdt.ShipmentQuantity,0) AS DateShipmentQuantity,
       CASE WHEN (ISNULL(sd.Descr,'') LIKE N'%] 단가 %→%' OR ISNULL(sd.Descr,'') LIKE N'%단가 %>%') THEN 1 ELSE 0 END AS HasWebCostEdit,
       LEFT(ISNULL(sd.Descr,''), 300) AS DetailDescr
     FROM Edited e
     JOIN ShipmentMaster sm ON sm.OrderYearWeek=e.OrderYearWeek AND sm.CustKey=e.CustKey AND ISNULL(sm.isDeleted,0)=0
     JOIN ShipmentDetail sd ON sd.ShipmentKey=sm.ShipmentKey AND sd.ProdKey=e.ProdKey
     LEFT JOIN ShipmentDate sdt ON sdt.SdetailKey=sd.SdetailKey
     LEFT JOIN ViewShipment vs ON vs.SdetailKey=sd.SdetailKey
     LEFT JOIN Customer c ON c.CustKey=sm.CustKey
     LEFT JOIN Product p ON p.ProdKey=sd.ProdKey
     ORDER BY sm.OrderYearWeek DESC, sm.CustKey, sd.ProdKey, sm.OrderWeek, sd.SdetailKey`,
    params
  );

  const allMismatches = await query(
    `SELECT TOP (@limit)
       sm.OrderYearWeek,
       sm.OrderWeek,
       sm.ShipmentKey,
       sd.SdetailKey,
       sdt.SdateKey,
       sm.CustKey,
       c.CustName,
       sd.ProdKey,
       p.ProdName,
       ISNULL(sd.Cost,0) AS DetailCost,
       ISNULL(sd.Amount,0) AS DetailAmount,
       ISNULL(sd.Vat,0) AS DetailVat,
       ISNULL(sdt.Cost,0) AS DateCost,
       ISNULL(sdt.Amount,0) AS DateAmount,
       ISNULL(sdt.Vat,0) AS DateVat,
       ISNULL(vs.Cost,0) AS ViewCost,
       ISNULL(vs.Amount,0) AS ViewAmount,
       ISNULL(vs.Vat,0) AS ViewVat,
       ISNULL(sd.EstQuantity,0) AS DetailEstQuantity,
       ISNULL(sdt.EstQuantity,0) AS DateEstQuantity,
       ISNULL(sdt.ShipmentQuantity,0) AS DateShipmentQuantity,
       LEFT(ISNULL(sd.Descr,''), 300) AS DetailDescr
     FROM ShipmentDetail sd
     JOIN ShipmentMaster sm ON sm.ShipmentKey=sd.ShipmentKey
     LEFT JOIN ShipmentDate sdt ON sdt.SdetailKey=sd.SdetailKey
     LEFT JOIN ViewShipment vs ON vs.SdetailKey=sd.SdetailKey
     LEFT JOIN Customer c ON c.CustKey=sm.CustKey
     LEFT JOIN Product p ON p.ProdKey=sd.ProdKey
     WHERE ISNULL(sm.isDeleted,0)=0
       ${weekWhere}
       AND (
         ABS(ISNULL(sd.Cost,0) - ISNULL(sdt.Cost,0)) > 0.001
         OR ABS(ISNULL(sd.Amount,0) - ISNULL(sdt.Amount,0)) > 0.001
         OR ABS(ISNULL(sd.Vat,0) - ISNULL(sdt.Vat,0)) > 0.001
         OR ABS(ISNULL(sd.Cost,0) - ISNULL(vs.Cost,0)) > 0.001
         OR ABS(ISNULL(sd.Amount,0) - ISNULL(vs.Amount,0)) > 0.001
         OR ABS(ISNULL(sd.Vat,0) - ISNULL(vs.Vat,0)) > 0.001
       )
     ORDER BY sm.OrderYearWeek DESC, sm.OrderWeek DESC, sd.SdetailKey DESC`,
    params
  );

  return res.status(200).json({
    success: true,
    week: week || null,
    sourceColumns: {
      ShipmentDetail: shipmentDetailColumns,
      ShipmentDate: shipmentDateColumns,
      ViewShipment: viewShipmentColumns,
      ShipmentFarm: shipmentFarmColumns,
    },
    farmCapabilities: {
      exists: farmExists,
      hasSdetailKey: farmHasSdetailKey,
      hasCost: farmHasCost,
      hasAmount: farmHasAmount,
      hasVat: farmHasVat,
    },
    rows: rows.recordset || [],
    farmRows,
    groupedRows: grouped.recordset || [],
    allMismatches: allMismatches.recordset || [],
  });
}

export default withAuth(handler);
