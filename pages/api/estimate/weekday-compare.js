import { query, sql } from '../../../lib/db.js';
import { withAuth } from '../../../lib/auth.js';
import { filterWeekdayCompareRows, normalizeWeekdayCompareRequest, normalizeWeekdayUnit, WEEKDAY_ORDER_OUT_QUANTITY_SQL } from '../../../lib/weekdayEstimateCompare.js';
import { weekdaySnapshotDigest } from '../../../lib/weekdayDistributionPolicy.js';

export default withAuth(async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).end();
  }
  let scope;
  try { scope = normalizeWeekdayCompareRequest(req.body); }
  catch (error) { return res.status(400).json({ success: false, error: error.message }); }

  const weekParams = Object.fromEntries(scope.weeks.map((week, i) => [`week${i}`, { type: sql.NVarChar(10), value: week }]));
  const prodParams = Object.fromEntries(scope.prodKeys.map((key, i) => [`prod${i}`, { type: sql.Int, value: key }]));
  const weekIn = scope.weeks.map((_, i) => `@week${i}`).join(',');
  const prodIn = scope.prodKeys.map((_, i) => `@prod${i}`).join(',');
  const params = {
    year: { type: sql.Int, value: scope.year },
    custKey: { type: sql.Int, value: scope.custKey },
    ...weekParams,
    ...prodParams,
  };

  try {
    const [orderResult, shipmentDetailResult, shipmentMasterResult, dayResult, productResult, lotResult, historyResult] = await Promise.all([
      query(
        `SELECT om.OrderYear, om.OrderWeek, om.CustKey, od.ProdKey,
                SUM(${WEEKDAY_ORDER_OUT_QUANTITY_SQL}) AS OrderOutQuantity
           FROM OrderMaster om
           JOIN OrderDetail od ON od.OrderMasterKey = om.OrderMasterKey
           JOIN Product p ON p.ProdKey = od.ProdKey
          WHERE om.OrderYear = @year AND om.CustKey = @custKey
            AND om.OrderWeek IN (${weekIn}) AND od.ProdKey IN (${prodIn})
            AND ISNULL(om.isDeleted,0)=0 AND ISNULL(od.isDeleted,0)=0 AND ISNULL(p.isDeleted,0)=0
            AND EXISTS (SELECT 1 FROM Customer c WHERE c.CustKey=om.CustKey AND ISNULL(c.isDeleted,0)=0)
          GROUP BY om.OrderYear, om.OrderWeek, om.CustKey, od.ProdKey`, params),
      query(
        `SELECT sm.OrderYear,sm.OrderWeek,sm.CustKey,sd.ProdKey,
                sd.SdetailKey,sd.ShipmentKey,sd.OutQuantity,sd.BoxQuantity,
                CONVERT(nvarchar(23),sd.ShipmentDtm,121) AS ShipmentTimestamp,
                sd.BunchQuantity,sd.SteamQuantity,sd.EstQuantity,
                sd.Cost AS DetailCost,sd.Amount AS DetailAmount,sd.Vat AS DetailVat,
                sd.isFix AS DetailIsFix,p.OutUnit
           FROM ShipmentMaster sm
           JOIN ShipmentDetail sd ON sd.ShipmentKey = sm.ShipmentKey AND sd.CustKey = sm.CustKey
           JOIN Product p ON p.ProdKey = sd.ProdKey
          WHERE sm.OrderYear = @year AND sm.CustKey = @custKey
            AND sm.OrderWeek IN (${weekIn}) AND sd.ProdKey IN (${prodIn})
            AND ISNULL(sm.isDeleted,0)=0 AND ISNULL(p.isDeleted,0)=0
            AND EXISTS (SELECT 1 FROM Customer c WHERE c.CustKey=sm.CustKey AND ISNULL(c.isDeleted,0)=0)`, params),
      query(
        `SELECT sm.OrderYear,sm.OrderWeek,sm.CustKey,sm.ShipmentKey,
                sm.isFix AS MasterIsFix,sm.OrderYearWeek
           FROM ShipmentMaster sm
          WHERE sm.OrderYear=@year AND sm.CustKey=@custKey
            AND sm.OrderWeek IN (${weekIn}) AND ISNULL(sm.isDeleted,0)=0
            AND EXISTS (SELECT 1 FROM Customer c WHERE c.CustKey=sm.CustKey AND ISNULL(c.isDeleted,0)=0)
          ORDER BY sm.OrderWeek,sm.ShipmentKey`, params),
      query(
        `SELECT sm.OrderYear, sm.OrderWeek, sm.CustKey, sd.ProdKey,
                sdd.SdateKey, sd.SdetailKey, sm.ShipmentKey,
                CONVERT(nvarchar(10), sdd.ShipmentDtm,120) AS ShipmentDate,
                CONVERT(nvarchar(23), sdd.ShipmentDtm,121) AS ShipmentTimestamp,
                pd.WeekDay, ISNULL(sdd.ShipmentQuantity,0) AS ShipmentQuantity,
                ISNULL(sdd.EstQuantity,0) AS EstimateQuantity,
                CAST(ISNULL(sd.isFix,0) AS int) AS DetailFixed,
                sdd.Cost, sdd.Amount, sdd.Vat
           FROM ShipmentMaster sm
           JOIN ShipmentDetail sd ON sd.ShipmentKey = sm.ShipmentKey AND sd.CustKey = sm.CustKey
           JOIN ShipmentDate sdd ON sdd.SdetailKey = sd.SdetailKey
           OUTER APPLY (
             SELECT CASE WHEN COUNT_BIG(*)=1 THEN MAX(calendar.WeekDay) ELSE NULL END AS WeekDay
               FROM PeriodDay calendar WHERE calendar.BaseYmd=sdd.ShipmentDtm
           ) pd
           JOIN Product p ON p.ProdKey = sd.ProdKey
          WHERE sm.OrderYear = @year AND sm.CustKey = @custKey
            AND sm.OrderWeek IN (${weekIn}) AND sd.ProdKey IN (${prodIn})
            AND ISNULL(sm.isDeleted,0)=0 AND ISNULL(p.isDeleted,0)=0
            AND EXISTS (SELECT 1 FROM Customer c WHERE c.CustKey=sm.CustKey AND ISNULL(c.isDeleted,0)=0)
          ORDER BY sdd.ShipmentDtm,sdd.SdateKey`, params),
      query(`SELECT ProdKey,ProdName,OutUnit,EstUnit,FlowerName,CounName,BunchOf1Box,SteamOf1Bunch,SteamOf1Box
               FROM Product WHERE ProdKey IN (${prodIn}) AND ISNULL(isDeleted,0)=0`, prodParams),
      query(`SELECT wm.OrderYear,wm.OrderWeek,wd.WdetailKey,wd.ProdKey,wm.WarehouseKey,
                    wm.FarmName,wd.OutQuantity,wd.OrderCode
               FROM WarehouseMaster wm JOIN WarehouseDetail wd ON wd.WarehouseKey=wm.WarehouseKey
               JOIN Product p ON p.ProdKey=wd.ProdKey
              WHERE wm.OrderYear=@year AND wm.OrderWeek IN (${weekIn}) AND wd.ProdKey IN (${prodIn})
                AND ISNULL(wm.isDeleted,0)=0 AND ISNULL(p.isDeleted,0)=0
              ORDER BY wm.OrderWeek,wd.ProdKey,wd.WdetailKey`, params),
      query(`SELECT TOP 1001 sm.OrderYear,sm.OrderWeek,sm.CustKey,sd.ProdKey,
                    sh.SdetailKey,CONVERT(nvarchar(23),sh.ChangeDtm,121) AS ChangeDtm,
                    sh.ChangeID,sh.ChangeType,CONVERT(nvarchar(10),sh.ShipmentDtm,120) AS ShipmentDate,
                    sh.BeforeValue,sh.AfterValue,sh.Descr
               FROM ShipmentHistory sh JOIN ShipmentDetail sd ON sd.SdetailKey=sh.SdetailKey
               JOIN ShipmentMaster sm ON sm.ShipmentKey=sd.ShipmentKey AND sd.CustKey=sm.CustKey
               JOIN Product p ON p.ProdKey=sd.ProdKey
              WHERE sm.OrderYear=@year AND sm.CustKey=@custKey AND sm.OrderWeek IN (${weekIn})
                AND sd.ProdKey IN (${prodIn}) AND ISNULL(sm.isDeleted,0)=0 AND ISNULL(p.isDeleted,0)=0
                AND EXISTS (SELECT 1 FROM Customer c WHERE c.CustKey=sm.CustKey AND ISNULL(c.isDeleted,0)=0)
              ORDER BY sh.ChangeDtm DESC,sh.SdetailKey`, params),
    ]);

    const indexRows = (rows, valueName) => new Map((rows || []).map((row) => [`${row.OrderWeek}|${Number(row.ProdKey)}`, { ...row, [valueName]: row[valueName] == null ? null : Number(row[valueName]) }]));
    const orders = indexRows(filterWeekdayCompareRows(orderResult.recordset, scope), 'OrderOutQuantity');
    const details = new Map();
    for (const row of filterWeekdayCompareRows(shipmentDetailResult.recordset, scope)) {
      const key = `${row.OrderWeek}|${Number(row.ProdKey)}`;
      const list = details.get(key) || [];
      list.push(row);
      details.set(key, list);
    }
    const masters = new Map();
    for (const row of shipmentMasterResult.recordset || []) {
      if (String(row.OrderYear) !== String(scope.year)
        || Number(row.CustKey) !== Number(scope.custKey)
        || !scope.weeks.includes(String(row.OrderWeek))) continue;
      const key = String(row.OrderWeek);
      const list = masters.get(key) || [];
      list.push(row);
      masters.set(key, list);
    }
    const productMap = new Map(productResult.recordset.map((row) => [Number(row.ProdKey), row]));
    const dates = new Map();
    for (const row of filterWeekdayCompareRows(dayResult.recordset, scope)) {
      const key = `${row.OrderWeek}|${Number(row.ProdKey)}`;
      const list = dates.get(key) || [];
      list.push({ date: row.ShipmentDate, timestamp: row.ShipmentTimestamp, sdateKey: row.SdateKey,
        sdetailKey: row.SdetailKey, shipmentKey: row.ShipmentKey, weekDay: row.WeekDay,
        shipmentQuantity: Number(row.ShipmentQuantity) || 0, estimateQuantity: Number(row.EstimateQuantity) || 0,
        detailFixed:Number(row.DetailFixed)===1,cost:row.Cost==null?null:Number(row.Cost),amount:row.Amount==null?null:Number(row.Amount),vat:row.Vat==null?null:Number(row.Vat) });
      dates.set(key, list);
    }
    const rows = [];
    for (const week of scope.weeks) for (const prodKey of scope.prodKeys) {
      const key = `${week}|${prodKey}`;
      const order = orders.get(key);
      const detailRows = details.get(key) || [];
      const masterRows = masters.get(week) || [];
      const shipment = detailRows.length ? {
        ShipmentOutQuantity: detailRows.reduce((sum, row) => sum + Number(row.OutQuantity || 0), 0),
        MinFixed: Math.min(...detailRows.map((row) => Number(row.DetailIsFix))),
        MaxFixed: Math.max(...detailRows.map((row) => Number(row.DetailIsFix))),
        OutUnit: detailRows[0].OutUnit,
        DetailRows: detailRows.length,
      } : null;
      const product = productMap.get(prodKey);
      const writeShapeSafe = masterRows.length === 1 && detailRows.length <= 1 && Boolean(product);
      const actual = writeShapeSafe ? {
        detailRows: detailRows.length,
        shipmentOutQuantity: detailRows.length ? Number(detailRows[0].OutQuantity) : null,
        shipmentDates: dates.get(key) || [],
        master: masterRows[0],
        detail: detailRows[0] || null,
        product,
      } : null;
      const snapshotDigest = actual ? weekdaySnapshotDigest({
        year: String(scope.year), orderWeek: week, custKey: scope.custKey, prodKey,
      }, actual) : null;
      rows.push({
        year: scope.year, orderWeek: week, custKey: scope.custKey, prodKey,
        orderOutQuantity: order?.OrderOutQuantity ?? null,
        shipmentOutQuantity: shipment?.ShipmentOutQuantity ?? null,
        fixed: shipment ? (Number(shipment.MinFixed) === Number(shipment.MaxFixed) ? Number(shipment.MaxFixed) === 1 : 'mixed') : null,
        masterFixed: masterRows.length === 1 ? (masterRows[0].MasterIsFix === true || masterRows[0].MasterIsFix === 1) : null,
        prodName: product?.ProdName || null,
        flowerName: product?.FlowerName || null,
        countryName: product?.CounName || null,
        outUnit: normalizeWeekdayUnit(product?.OutUnit ?? shipment?.OutUnit),
        rawOutUnit: product?.OutUnit ?? shipment?.OutUnit ?? null,
        estUnit: normalizeWeekdayUnit(product?.EstUnit),
        rawEstUnit: product?.EstUnit ?? null,
        packaging: product ? {
          bunchOf1Box: product.BunchOf1Box ?? null,
          steamOf1Bunch: product.SteamOf1Bunch ?? null,
          steamOf1Box: product.SteamOf1Box ?? null,
        } : null,
        detailRows: shipment ? Number(shipment.DetailRows) : 0,
        shipmentDates: dates.get(key) || [],
        snapshotDigest,
        state: !shipment ? 'NO_SHIPMENT' : shipment.MinFixed !== shipment.MaxFixed ? 'MIXED_FIX_REVIEW_REQUIRED' : Number(shipment.MaxFixed) === 1 ? 'FIXED_REVIEW_REQUIRED' : 'FOUND_UNFIXED',
      });
    }
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({
      success: true,
      readOnly: true,
      scope: { year: scope.year, custKey: scope.custKey, orderWeeks: scope.weeks, prodKeys: scope.prodKeys },
      rows,
      sourceLots: lotResult.recordset.map((row) => ({ year: Number(row.OrderYear), orderWeek: row.OrderWeek,
        prodKey: Number(row.ProdKey), wdetailKey: Number(row.WdetailKey), warehouseKey: Number(row.WarehouseKey),
        farmName: row.FarmName, incomingQuantity: Number(row.OutQuantity), orderCode: row.OrderCode,
        allocatedQuantity: null, remainingQuantity: null, provenanceState: 'CANDIDATE_NOT_ALLOCATION' })),
      history: filterWeekdayCompareRows(historyResult.recordset, scope).slice(0,1000),
      historyTruncated: historyResult.recordset.length > 1000,
      provenanceState: 'LEGACY_SOURCE_LOT_UNLINKED',
      historyNote: '확정 SP가 기록한 출고일 이력입니다. 삭제된 상세 또는 미확정 외부 변경의 전후 이력이 모두 복원되는 것은 아닙니다.',
      notes: ['이 API는 OrderYear + OrderWeek + CustKey + ProdKey로 ERP를 조회하며 쓰기는 하지 않습니다.', '날짜별 ShipmentQuantity와 EstQuantity는 서로 다른 단위 축이므로 합산/환산하지 않았습니다.', '확정 상태는 검토 필요로 표시하며 자동으로 분배 가능 판정하지 않습니다.'],
    });
  } catch (error) {
    console.error('[weekday-estimate-compare]', error);
    return res.status(500).json({ success: false, error: '전산 대조에 실패했습니다. 선택 범위와 DB 연결 상태를 확인하세요.' });
  }
});
