// pages/api/shipment/distribute-sp.js - run Nenova.exe distribution procedures
import { withAuth } from '../../../lib/auth';
import { withActionLog } from '../../../lib/withActionLog';
import { query, withTransaction, sql } from '../../../lib/db';
import { normalizeOrderWeek, normalizeOrderYear } from '../../../lib/orderUtils';
import { buildProdGroupWhere } from '../../../lib/shipmentProdGroups.js';

function paramName(row) {
  return String(row?.ParameterName || '').trim();
}

function typeName(row) {
  return String(row?.TypeName || '').trim().toLowerCase();
}

function isOutput(row) {
  return row?.IsOutput === true || row?.IsOutput === 1;
}

function isIntLike(row) {
  return /^(bigint|int|smallint|tinyint)$/.test(typeName(row));
}

function isTextLike(row) {
  return /^(nvarchar|varchar|nchar|char)$/.test(typeName(row));
}

function findParamByName(rows, patterns) {
  return rows.find(row => patterns.some(pattern => pattern.test(paramName(row))));
}

function sqlTypeDeclaration(row) {
  const t = typeName(row);
  if (!t) return 'NVARCHAR(MAX)';
  if (['nvarchar', 'nchar'].includes(t)) {
    const maxLength = Number(row.MaxLength || 0);
    const len = maxLength < 0 ? 'MAX' : Math.max(1, Math.floor(maxLength / 2));
    return `${t.toUpperCase()}(${len})`;
  }
  if (['varchar', 'char', 'varbinary', 'binary'].includes(t)) {
    const maxLength = Number(row.MaxLength || 0);
    const len = maxLength < 0 ? 'MAX' : Math.max(1, maxLength);
    return `${t.toUpperCase()}(${len})`;
  }
  if (['decimal', 'numeric'].includes(t)) {
    const precision = Number(row.Precision || 18);
    const scale = Number(row.Scale || 0);
    return `${t.toUpperCase()}(${precision},${scale})`;
  }
  return t.toUpperCase();
}

function outputAlias(name) {
  return String(name || '').replace(/^@/, '').replace(/[^\w가-힣]/g, '_') || 'OutputValue';
}

async function loadProcedureShape(procedureName) {
  const result = await query(
    `SELECT prm.parameter_id AS ParameterId,
            prm.name AS ParameterName,
            TYPE_NAME(prm.user_type_id) AS TypeName,
            prm.max_length AS MaxLength,
            prm.precision AS Precision,
            prm.scale AS Scale,
            prm.is_output AS IsOutput,
            prm.has_default_value AS HasDefaultValue
       FROM sys.parameters prm
      WHERE prm.object_id = OBJECT_ID(@proc, N'P')
      ORDER BY prm.parameter_id`,
    { proc: { type: sql.NVarChar, value: `dbo.${procedureName}` } }
  );
  const rows = result.recordset || [];
  if (!rows.length) throw new Error(`전산 SP dbo.${procedureName} 파라미터를 확인하지 못했습니다.`);
  return rows;
}

// nenova.exe 전산 SP 파라미터를 이름 기준으로 매핑한다.
//  usp_DistributeOne  : @DistributionType,@OrderYear,@OrderWeek,@ProdKey,@iUserID,@oResult(out)
//  usp_DistributeTotal: @DistributionType,@OrderYear,@OrderWeek,@CountryFlower,@iUserID,@oResult(out)
// 모든 입력 파라미터를 인식·전달해야 SP 가 정상 실행된다(구버전은 year/week/prod 만 넘겨 실행 실패).
function resolveShape(procedureName, shapeRows, action) {
  const inputs = shapeRows.filter(row => !isOutput(row));
  const outputs = shapeRows.filter(row => isOutput(row));
  const yearParam = findParamByName(inputs, [/year/i, /년도/, /연도/]);
  const weekParam = findParamByName(inputs, [/week/i, /차수/, /주차/]);
  const distTypeParam = findParamByName(inputs, [/distribut.*type/i, /^@?distributiontype$/i, /type/i]);
  const userParam = findParamByName(inputs, [/user/i, /userid/i]);
  const prodParam = findParamByName(inputs, [/prod/i, /product/i, /품목/, /item/i]);
  const countryFlowerParam = findParamByName(inputs, [/country/i, /flower/i, /꽃/]);

  if (!yearParam || !weekParam) {
    const desc = inputs.map(row => `${paramName(row)} ${row.TypeName}`).join(', ');
    throw new Error(`dbo.${procedureName} 연도/차수 파라미터를 확인하지 못했습니다. 확인값: ${desc}`);
  }
  const targetOk = ['one', 'group'].includes(action) ? !!prodParam : true;
  if (!targetOk) {
    throw new Error(`dbo.${procedureName} 품목(ProdKey) 파라미터를 확인하지 못했습니다.`);
  }
  // 안전장치: 인식하지 못한 입력이 있으면 중단 (예상치 못한 시그니처)
  const mapped = new Set([yearParam, weekParam, distTypeParam, userParam, prodParam, countryFlowerParam].filter(Boolean).map(paramName));
  const extraInputs = inputs.filter(row => !mapped.has(paramName(row)));
  if (extraInputs.length) {
    throw new Error(`dbo.${procedureName} 미인식 파라미터: ${extraInputs.map(row => `${paramName(row)} ${row.TypeName}`).join(', ')}`);
  }

  return { yearParam, weekParam, distTypeParam, userParam, prodParam, countryFlowerParam, outputs };
}

async function loadGroupProducts(q, week, prodGroup) {
  const { clause: groupClause, params: groupParams } = buildProdGroupWhere(prodGroup);
  const result = await q(
    `SELECT DISTINCT p.ProdKey, p.ProdName
       FROM OrderMaster om
       JOIN OrderDetail od ON od.OrderMasterKey=om.OrderMasterKey
       JOIN Product p ON p.ProdKey=od.ProdKey
      WHERE om.OrderWeek=@wk
        AND ISNULL(om.isDeleted,0)=0
        AND ISNULL(od.isDeleted,0)=0
        AND ISNULL(p.isDeleted,0)=0
        ${groupClause}
      ORDER BY p.ProdName`,
    {
      wk: { type: sql.NVarChar, value: week },
      ...groupParams,
    }
  );
  return result.recordset || [];
}

function prodFilterClause(prodKeys) {
  if (!prodKeys?.length) return '';
  return `AND sd.ProdKey IN (${prodKeys.map((_, i) => `@pk${i}`).join(',')})`;
}

function prodFilterParams(prodKeys) {
  const params = {};
  (prodKeys || []).forEach((prodKey, i) => {
    params[`pk${i}`] = { type: sql.Int, value: Number(prodKey) };
  });
  return params;
}

async function assertWeekNotFixed(q, week, prodKey = null, prodKeys = []) {
  const params = { wk: { type: sql.NVarChar, value: week } };
  let prodClause = '';
  if (prodKey) {
    params.pk = { type: sql.Int, value: Number(prodKey) };
    prodClause = 'AND sd.ProdKey=@pk';
  } else if (prodKeys.length) {
    Object.assign(params, prodFilterParams(prodKeys));
    prodClause = prodFilterClause(prodKeys);
  }
  const fixed = await q(
    `SELECT TOP 10 c.CustName, p.ProdName, sm.isFix AS MasterFix, sd.isFix AS DetailFix
       FROM ShipmentMaster sm
       JOIN ShipmentDetail sd ON sd.ShipmentKey=sm.ShipmentKey
       LEFT JOIN Customer c ON c.CustKey=sm.CustKey
       LEFT JOIN Product p ON p.ProdKey=sd.ProdKey
      WHERE sm.OrderWeek=@wk
        AND ISNULL(sm.isDeleted,0)=0
        ${prodClause}
        AND (ISNULL(sm.isFix,0)=1 OR ISNULL(sd.isFix,0)=1)`,
    params
  );
  if ((fixed.recordset || []).length) {
    const sample = fixed.recordset.slice(0, 3).map(row => `${row.CustName || ''} / ${row.ProdName || ''}`).join(', ');
    throw new Error(`확정된 출고가 있어 전산 분배를 실행하지 않습니다. 예: ${sample}`);
  }
}

async function assertKeyNumberingReady(q) {
  const result = await q(
    `SELECT v.Category,
            ISNULL(kn.LastKeyNo,0) AS LastKeyNo,
            v.ActualMaxKey,
            CASE WHEN ISNULL(kn.LastKeyNo,0) < v.ActualMaxKey THEN 1 ELSE 0 END AS NeedsSync
       FROM (
         SELECT N'ShipmentMasterKey' AS Category, ISNULL(MAX(ShipmentKey),0) AS ActualMaxKey FROM ShipmentMaster
         UNION ALL
         SELECT N'ShipmentDetailKey' AS Category, ISNULL(MAX(SdetailKey),0) AS ActualMaxKey FROM ShipmentDetail
       ) v
       LEFT JOIN KeyNumbering kn ON kn.Category = v.Category`
  );
  const issues = (result.recordset || []).filter(row => Number(row.NeedsSync) === 1);
  if (issues.length) {
    const msg = issues.map(row => `${row.Category}: LastKeyNo ${row.LastKeyNo}, 실제최대 ${row.ActualMaxKey}`).join(' / ');
    throw new Error(`KeyNumbering이 실제 키보다 뒤처져 있어 전산 분배를 중단합니다. ${msg}`);
  }
  return result.recordset || [];
}

async function loadSummary(q, week, prodKey = null, prodKeys = []) {
  const params = { wk: { type: sql.NVarChar, value: week } };
  let prodClause = '';
  if (prodKey) {
    params.pk = { type: sql.Int, value: Number(prodKey) };
    prodClause = 'AND sd.ProdKey=@pk';
  } else if (prodKeys.length) {
    Object.assign(params, prodFilterParams(prodKeys));
    prodClause = prodFilterClause(prodKeys);
  }
  const result = await q(
    `WITH detail AS (
       SELECT sm.CustKey, sd.ProdKey, sd.SdetailKey, sd.OutQuantity, sd.ShipmentDtm,
              ISNULL(sdt.DateQty,0) AS DateQty,
              sdt.MinShipmentDate,
              sdt.MaxShipmentDate
         FROM ShipmentMaster sm
         JOIN ShipmentDetail sd ON sd.ShipmentKey=sm.ShipmentKey
         OUTER APPLY (
           SELECT SUM(ISNULL(ShipmentQuantity,0)) AS DateQty,
                  MIN(CONVERT(date, ShipmentDtm)) AS MinShipmentDate,
                  MAX(CONVERT(date, ShipmentDtm)) AS MaxShipmentDate
             FROM ShipmentDate
            WHERE SdetailKey=sd.SdetailKey
         ) sdt
        WHERE sm.OrderWeek=@wk
          AND ISNULL(sm.isDeleted,0)=0
          ${prodClause}
     ),
     dup AS (
       SELECT CustKey, ProdKey
         FROM detail
        GROUP BY CustKey, ProdKey
       HAVING COUNT(*) > 1
     )
     SELECT COUNT(DISTINCT CustKey) AS CustomerCount,
            COUNT(DISTINCT ProdKey) AS ProductCount,
            COUNT(SdetailKey) AS DetailCount,
            SUM(ISNULL(OutQuantity,0)) AS OutQuantity,
            SUM(ISNULL(DateQty,0)) AS DateQuantity,
            SUM(CASE WHEN ISNULL(OutQuantity,0) <> 0
                       AND (ShipmentDtm IS NULL
                            OR ABS(ISNULL(DateQty,0) - ISNULL(OutQuantity,0)) > 0.001
                            OR CONVERT(date,ShipmentDtm) <> MinShipmentDate
                            OR CONVERT(date,ShipmentDtm) <> MaxShipmentDate)
                     THEN 1 ELSE 0 END) AS DateIssueCount,
            (SELECT COUNT(*) FROM dup) AS DuplicateDetailGroups
       FROM detail`,
    params
  );
  const row = result.recordset?.[0] || {};
  return {
    customerCount: Number(row.CustomerCount || 0),
    productCount: Number(row.ProductCount || 0),
    detailCount: Number(row.DetailCount || 0),
    outQuantity: Number(row.OutQuantity || 0),
    dateQuantity: Number(row.DateQuantity || 0),
    dateIssueCount: Number(row.DateIssueCount || 0),
    duplicateDetailGroups: Number(row.DuplicateDetailGroups || 0),
  };
}

async function executeProcedure(q, { procedureName, action, shapeRows, orderYear, week, prodKey, countryFlower, distributionType, uid }) {
  const shape = resolveShape(procedureName, shapeRows, action);
  const outputDecl = shape.outputs.map((row, i) => `DECLARE @out${i} ${sqlTypeDeclaration(row)};`).join('\n');

  const inputAssignments = [
    `${paramName(shape.yearParam)}=@argYear`,
    `${paramName(shape.weekParam)}=@argWeek`,
  ];
  const params = {
    argYear: { type: sql.Int, value: Number(orderYear) },
    argWeek: { type: sql.NVarChar, value: week },
  };
  if (shape.distTypeParam) {
    inputAssignments.push(`${paramName(shape.distTypeParam)}=@argDistType`);
    params.argDistType = { type: sql.Int, value: Number(distributionType) === 2 ? 2 : 1 }; // 2=우선, 1=비율
  }
  if (shape.prodParam && ['one', 'group'].includes(action)) {
    inputAssignments.push(`${paramName(shape.prodParam)}=@argProdKey`);
    params.argProdKey = { type: sql.Int, value: Number(prodKey) };
  }
  if (shape.countryFlowerParam && action === 'total') {
    inputAssignments.push(`${paramName(shape.countryFlowerParam)}=@argCountryFlower`);
    params.argCountryFlower = { type: sql.NVarChar, value: String(countryFlower || '') };
  }
  if (shape.userParam) {
    inputAssignments.push(`${paramName(shape.userParam)}=@argUser`);
    params.argUser = { type: sql.NVarChar, value: String(uid || 'admin') };
  }

  const outputAssignments = shape.outputs.map((row, i) => `${paramName(row)}=@out${i} OUTPUT`);
  const selectOutputs = shape.outputs.map((row, i) => `@out${i} AS [${outputAlias(paramName(row))}]`);
  const selectSql = [`@returnCode AS ReturnCode`, ...selectOutputs].join(', ');

  const execSql = `
DECLARE @returnCode INT;
${outputDecl}
EXEC @returnCode = dbo.${procedureName} ${[...inputAssignments, ...outputAssignments].join(', ')};
SELECT ${selectSql};`;

  const result = await q(execSql, params);
  const recordsets = result.recordsets || [];
  const finalRecordset = recordsets.length ? recordsets[recordsets.length - 1] : result.recordset;
  return finalRecordset?.[0] || {};
}

function failureSignals(execResult) {
  return Object.entries(execResult || {})
    .filter(([key, value]) => /return|result|error|err|code/i.test(key) && key !== 'MappingMode' && value !== null && value !== undefined && value !== '')
    .map(([key, value]) => ({ key, value, numeric: Number(value) }))
    .filter(row => Number.isFinite(row.numeric) && row.numeric !== 0);
}

async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });
  const action = String(req.body?.action || 'total').trim();
  if (!['total', 'one', 'group'].includes(action)) return res.status(400).json({ success: false, error: 'action은 total, group, one만 가능합니다.' });

  try {
    const week = normalizeOrderWeek(req.body?.week || '');
    const orderYear = normalizeOrderYear(String(req.body?.year || req.body?.week || ''), new Date().getFullYear().toString());
    const prodKey = action === 'one' ? Number(req.body?.prodKey || 0) : null;
    const prodGroup = String(req.body?.prodGroup || '').trim();
    const countryFlower = String(req.body?.countryFlower || '').trim();
    const distributionType = Number(req.body?.distributionType) === 2 ? 2 : 1; // 2=우선, 1=비율(기본)
    const uid = req.user?.userId || 'admin';
    if (!week) throw new Error('차수 필요');
    if (action === 'one' && !prodKey) throw new Error('개별 출고분배는 품목 선택이 필요합니다.');
    if (action === 'group' && !prodGroup) throw new Error('꽃/품목그룹을 선택하세요.');

    const procedureName = ['one', 'group'].includes(action) ? 'usp_DistributeOne' : 'usp_DistributeTotal';
    const shapeRows = await loadProcedureShape(procedureName);

    const result = await withTransaction(async (tQ) => {
      const groupProducts = action === 'group' ? await loadGroupProducts(tQ, week, prodGroup) : [];
      if (action === 'group' && groupProducts.length === 0) throw new Error(`${week}차 ${prodGroup} 주문 품목이 없습니다.`);
      const prodKeys = groupProducts.map(row => Number(row.ProdKey));
      await assertWeekNotFixed(tQ, week, prodKey, prodKeys);
      const keyNumbering = await assertKeyNumberingReady(tQ);
      const before = await loadSummary(tQ, week, prodKey, prodKeys);
      const executed = [];
      if (action === 'group') {
        for (const product of groupProducts) {
          const execResult = await executeProcedure(tQ, { procedureName, action, shapeRows, orderYear, week, prodKey: product.ProdKey, countryFlower, distributionType, uid });
          const failures = failureSignals(execResult);
          if (failures.length) {
            throw new Error(`${product.ProdName} ${procedureName} 실패 반환값: ${failures.map(row => `${row.key}=${row.value}`).join(', ')}`);
          }
          executed.push({ prodKey: product.ProdKey, prodName: product.ProdName, execResult });
        }
      } else {
        const execResult = await executeProcedure(tQ, { procedureName, action, shapeRows, orderYear, week, prodKey, countryFlower, distributionType, uid });
        const failures = failureSignals(execResult);
        if (failures.length) {
          throw new Error(`${procedureName} 실패 반환값: ${failures.map(row => `${row.key}=${row.value}`).join(', ')}`);
        }
        executed.push({ prodKey, execResult });
      }
      const after = await loadSummary(tQ, week, prodKey, prodKeys);
      if (after.dateIssueCount > 0) throw new Error(`전산 분배 후 출고일/출고수량 불일치 ${after.dateIssueCount}건이 감지되어 롤백했습니다.`);
      if (after.duplicateDetailGroups > 0) throw new Error(`전산 분배 후 중복 출고상세 ${after.duplicateDetailGroups}그룹이 감지되어 롤백했습니다.`);
      return { keyNumbering, before, after, executed };
    }, { retries: 3, baseDelay: 250 });

    const logs = [
      `${week}차 ${action === 'one' ? '개별' : action === 'group' ? `${prodGroup} 일괄` : '전체 일괄'} 출고분배 완료`,
      `실행 경로: dbo.${procedureName}`,
      action === 'group' ? `선택 꽃/품목그룹: ${prodGroup}, 실행 품목 ${result.executed.length}개` : null,
      `분배 전: 품목 ${result.before.productCount}개, 업체 ${result.before.customerCount}곳, 출고합계 ${result.before.outQuantity}`,
      `분배 후: 품목 ${result.after.productCount}개, 업체 ${result.after.customerCount}곳, 출고합계 ${result.after.outQuantity}`,
      `출고일 문제 ${result.after.dateIssueCount}건, 중복 출고상세 ${result.after.duplicateDetailGroups}그룹`,
    ].filter(Boolean);

    return res.status(200).json({
      success: true,
      action,
      week,
      orderYear,
      prodKey,
      prodGroup,
      procedureName,
      logs,
      ...result,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}

export default withAuth(withActionLog(handler, {
  actionType: 'SHIPMENT_DISTRIBUTE_SP',
  affectedTable: 'dbo.usp_DistributeTotal/One',
  riskLevel: 'HIGH',
}));
