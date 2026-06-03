// pages/api/shipment/distribute-sp.js - run Nenova.exe distribution procedures
import { withAuth } from '../../../lib/auth';
import { withActionLog } from '../../../lib/withActionLog';
import { query, withTransaction, sql } from '../../../lib/db';
import { normalizeOrderWeek, normalizeOrderYear } from '../../../lib/orderUtils';

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

function resolveShape(procedureName, shapeRows, action) {
  const inputs = shapeRows.filter(row => !isOutput(row));
  const outputs = shapeRows.filter(row => isOutput(row));
  const expectedCount = action === 'one' ? 3 : 2;
  let yearParam = findParamByName(inputs, [/year/i, /yyyy/i, /yr/i, /년도/, /연도/]);
  let weekParam = findParamByName(inputs, [/week/i, /wk/i, /차수/, /주차/]);
  let prodParam = action === 'one'
    ? findParamByName(inputs, [/prod/i, /product/i, /flower/i, /품목/, /item/i])
    : null;
  let mappingMode = 'name';

  if ((!yearParam || !weekParam || (action === 'one' && !prodParam)) && inputs.length === expectedCount) {
    const positionLooksSafe = action === 'one'
      ? isIntLike(inputs[0]) && isTextLike(inputs[1]) && isIntLike(inputs[2])
      : isIntLike(inputs[0]) && isTextLike(inputs[1]);
    if (positionLooksSafe) {
      yearParam = inputs[0];
      weekParam = inputs[1];
      prodParam = action === 'one' ? inputs[2] : null;
      mappingMode = 'position';
    }
  }

  const mapped = new Set([yearParam, weekParam, prodParam].filter(Boolean).map(paramName));
  const extraInputs = inputs.filter(row => !mapped.has(paramName(row)));
  if (!yearParam || !weekParam || (action === 'one' && !prodParam) || extraInputs.length) {
    const desc = inputs.map(row => `${paramName(row)} ${row.TypeName}`).join(', ');
    throw new Error(`dbo.${procedureName} 파라미터 구조가 안전한 ${expectedCount}입력 형태로 확인되지 않았습니다. 확인값: ${desc}`);
  }

  return { yearParam, weekParam, prodParam, outputs, mappingMode };
}

async function assertWeekNotFixed(q, week, prodKey = null) {
  const params = { wk: { type: sql.NVarChar, value: week } };
  let prodClause = '';
  if (prodKey) {
    params.pk = { type: sql.Int, value: Number(prodKey) };
    prodClause = 'AND sd.ProdKey=@pk';
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

async function loadSummary(q, week, prodKey = null) {
  const params = { wk: { type: sql.NVarChar, value: week } };
  let prodClause = '';
  if (prodKey) {
    params.pk = { type: sql.Int, value: Number(prodKey) };
    prodClause = 'AND sd.ProdKey=@pk';
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

async function executeProcedure(q, { procedureName, action, shapeRows, orderYear, week, prodKey }) {
  const shape = resolveShape(procedureName, shapeRows, action);
  const outputDecl = shape.outputs.map((row, i) => `DECLARE @out${i} ${sqlTypeDeclaration(row)};`).join('\n');
  const inputAssignments = [
    `${paramName(shape.yearParam)}=@argYear`,
    `${paramName(shape.weekParam)}=@argWeek`,
  ];
  if (action === 'one') inputAssignments.push(`${paramName(shape.prodParam)}=@argProdKey`);
  const outputAssignments = shape.outputs.map((row, i) => `${paramName(row)}=@out${i} OUTPUT`);
  const selectOutputs = shape.outputs.map((row, i) => `@out${i} AS [${outputAlias(paramName(row))}]`);
  const selectSql = [`@returnCode AS ReturnCode`, ...selectOutputs].join(', ');

  const execSql = `
DECLARE @returnCode INT;
${outputDecl}
EXEC @returnCode = dbo.${procedureName} ${[...inputAssignments, ...outputAssignments].join(', ')};
SELECT ${selectSql}, @mappingMode AS MappingMode;`;

  const params = {
    argYear: { type: sql.Int, value: Number(orderYear) },
    argWeek: { type: sql.NVarChar, value: week },
    mappingMode: { type: sql.NVarChar, value: shape.mappingMode },
  };
  if (action === 'one') params.argProdKey = { type: sql.Int, value: Number(prodKey) };

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
  if (!['total', 'one'].includes(action)) return res.status(400).json({ success: false, error: 'action은 total 또는 one만 가능합니다.' });

  try {
    const week = normalizeOrderWeek(req.body?.week || '');
    const orderYear = normalizeOrderYear(String(req.body?.year || req.body?.week || ''), new Date().getFullYear().toString());
    const prodKey = action === 'one' ? Number(req.body?.prodKey || 0) : null;
    if (!week) throw new Error('차수 필요');
    if (action === 'one' && !prodKey) throw new Error('개별 출고분배는 품목 선택이 필요합니다.');

    const procedureName = action === 'one' ? 'usp_DistributeOne' : 'usp_DistributeTotal';
    const shapeRows = await loadProcedureShape(procedureName);

    const result = await withTransaction(async (tQ) => {
      await assertWeekNotFixed(tQ, week, prodKey);
      const keyNumbering = await assertKeyNumberingReady(tQ);
      const before = await loadSummary(tQ, week, prodKey);
      const execResult = await executeProcedure(tQ, { procedureName, action, shapeRows, orderYear, week, prodKey });
      const failures = failureSignals(execResult);
      if (failures.length) {
        throw new Error(`${procedureName} 실패 반환값: ${failures.map(row => `${row.key}=${row.value}`).join(', ')}`);
      }
      const after = await loadSummary(tQ, week, prodKey);
      if (after.dateIssueCount > 0) throw new Error(`전산 분배 후 출고일/출고수량 불일치 ${after.dateIssueCount}건이 감지되어 롤백했습니다.`);
      if (after.duplicateDetailGroups > 0) throw new Error(`전산 분배 후 중복 출고상세 ${after.duplicateDetailGroups}그룹이 감지되어 롤백했습니다.`);
      return { keyNumbering, before, after, execResult };
    }, { retries: 3, baseDelay: 250 });

    const logs = [
      `${week}차 ${action === 'one' ? '개별' : '일괄'} 출고분배 완료`,
      `실행 경로: dbo.${procedureName}`,
      `분배 전: 품목 ${result.before.productCount}개, 업체 ${result.before.customerCount}곳, 출고합계 ${result.before.outQuantity}`,
      `분배 후: 품목 ${result.after.productCount}개, 업체 ${result.after.customerCount}곳, 출고합계 ${result.after.outQuantity}`,
      `출고일 문제 ${result.after.dateIssueCount}건, 중복 출고상세 ${result.after.duplicateDetailGroups}그룹`,
    ];

    return res.status(200).json({
      success: true,
      action,
      week,
      orderYear,
      prodKey,
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
