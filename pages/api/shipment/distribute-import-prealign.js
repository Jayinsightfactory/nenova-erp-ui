import fs from 'fs';
import formidable from 'formidable';
import XLSX from 'xlsx';
import { withAuth } from '../../../lib/auth';
import { withActionLog } from '../../../lib/withActionLog';
import { query, sql, isDeadlockError } from '../../../lib/db';
import { normalizeOrderYear } from '../../../lib/orderUtils';
import { parseAllocationWorkbook, buildImportPreview } from '../../../lib/shipmentImport';

export const config = {
  api: { bodyParser: false },
};

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function queryWithDeadlockRetry(q, params = {}, options = {}) {
  const retries = Number(options.retries ?? 3);
  const baseDelay = Number(options.baseDelay ?? 200);
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await query(q, params);
    } catch (err) {
      if (!isDeadlockError(err) || attempt >= retries) throw err;
      await sleep(baseDelay * Math.pow(2, attempt));
    }
  }
}

function paramName(row) {
  return String(row?.ParameterName || row?.name || '').trim();
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
  const clean = String(name || '').replace(/^@/, '').replace(/[^\w가-힣]/g, '_');
  return clean || 'OutputValue';
}

async function loadDistributeOneShape() {
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
      WHERE prm.object_id = OBJECT_ID(N'dbo.usp_DistributeOne', N'P')
      ORDER BY prm.parameter_id`
  );
  const rows = result.recordset || [];
  if (rows.length === 0) {
    throw new Error('전산 분배 SP dbo.usp_DistributeOne 파라미터를 확인하지 못했습니다. SP 존재/권한을 먼저 확인하세요.');
  }
  return rows;
}

function resolveDistributeOneShape(shapeRows) {
  const inputs = shapeRows.filter(row => !isOutput(row));
  const outputs = shapeRows.filter(row => isOutput(row));
  let yearParam = findParamByName(inputs, [/year/i, /yyyy/i, /yr/i, /년도/, /연도/]);
  let weekParam = findParamByName(inputs, [/week/i, /wk/i, /차수/, /주차/]);
  let prodParam = findParamByName(inputs, [/prod/i, /product/i, /flower/i, /품목/, /item/i]);
  let mappingMode = 'name';

  if ((!yearParam || !weekParam || !prodParam) && inputs.length === 3 && isIntLike(inputs[0]) && isTextLike(inputs[1]) && isIntLike(inputs[2])) {
    [yearParam, weekParam, prodParam] = inputs;
    mappingMode = 'position';
  }

  const mapped = new Set([yearParam, weekParam, prodParam].filter(Boolean).map(paramName));
  const extraInputs = inputs.filter(row => !mapped.has(paramName(row)));
  if (!yearParam || !weekParam || !prodParam || extraInputs.length > 0) {
    const desc = inputs.map(row => `${paramName(row)} ${row.TypeName}${isOutput(row) ? ' OUTPUT' : ''}`).join(', ');
    throw new Error(`dbo.usp_DistributeOne 파라미터 구조가 웹에서 안전하게 호출 가능한 3입력(연도/차수/품목) 형태로 확인되지 않았습니다. 확인값: ${desc}`);
  }

  return { yearParam, weekParam, prodParam, outputs, mappingMode };
}

async function assertKeyNumberingReady() {
  const result = await query(
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
  if (issues.length > 0) {
    const msg = issues.map(row => `${row.Category}: LastKeyNo ${row.LastKeyNo}, 실제최대 ${row.ActualMaxKey}`).join(' / ');
    throw new Error(`KeyNumbering이 실제 키보다 뒤처져 있어 전산 SP 분배를 중단합니다. ${msg}`);
  }
  return result.recordset || [];
}

function productValuesSql(prodKeys) {
  return prodKeys.map((_, i) => `(@pk${i})`).join(',');
}

function productParams(prodKeys) {
  const params = {};
  prodKeys.forEach((prodKey, i) => {
    params[`pk${i}`] = { type: sql.Int, value: Number(prodKey) };
  });
  return params;
}

async function assertProductsNotFixed(week, prodKeys) {
  if (!prodKeys.length) return [];
  const result = await query(
    `WITH target(ProdKey) AS (SELECT * FROM (VALUES ${productValuesSql(prodKeys)}) v(ProdKey))
     SELECT TOP 50 sd.ProdKey, p.ProdName, sm.CustKey, c.CustName, sm.isFix AS MasterFix, sd.isFix AS DetailFix
       FROM target t
       JOIN ShipmentDetail sd ON sd.ProdKey=t.ProdKey
       JOIN ShipmentMaster sm ON sm.ShipmentKey=sd.ShipmentKey
       LEFT JOIN Product p ON p.ProdKey=sd.ProdKey
       LEFT JOIN Customer c ON c.CustKey=sm.CustKey
      WHERE sm.OrderWeek=@week
        AND ISNULL(sm.isDeleted,0)=0
        AND (ISNULL(sm.isFix,0)=1 OR ISNULL(sd.isFix,0)=1)
      ORDER BY p.ProdName, c.CustName`,
    { week: { type: sql.NVarChar, value: week }, ...productParams(prodKeys) }
  );
  if ((result.recordset || []).length > 0) {
    const sample = result.recordset.slice(0, 5).map(row => `${row.CustName || row.CustKey} / ${row.ProdName || row.ProdKey}`).join(', ');
    throw new Error(`확정된 출고가 포함된 품목이 있어 전산 SP 분배를 중단합니다. 예: ${sample}`);
  }
  return result.recordset || [];
}

async function loadProductShipmentSummary(week, prodKeys) {
  if (!prodKeys.length) return [];
  const result = await query(
    `WITH target(ProdKey) AS (SELECT * FROM (VALUES ${productValuesSql(prodKeys)}) v(ProdKey)),
          detail AS (
            SELECT sd.ProdKey, sm.CustKey, sd.SdetailKey, sd.OutQuantity, sd.ShipmentDtm,
                   ISNULL(sdt.DateQty,0) AS DateQty,
                   sdt.MinShipmentDate,
                   sdt.MaxShipmentDate
              FROM ShipmentMaster sm
              JOIN ShipmentDetail sd ON sd.ShipmentKey=sm.ShipmentKey
              JOIN target t ON t.ProdKey=sd.ProdKey
              OUTER APPLY (
                SELECT SUM(ISNULL(ShipmentQuantity,0)) AS DateQty,
                       MIN(CONVERT(date, ShipmentDtm)) AS MinShipmentDate,
                       MAX(CONVERT(date, ShipmentDtm)) AS MaxShipmentDate
                  FROM ShipmentDate
                 WHERE SdetailKey=sd.SdetailKey
              ) sdt
             WHERE sm.OrderWeek=@week
               AND ISNULL(sm.isDeleted,0)=0
          )
     SELECT t.ProdKey,
            p.ProdName,
            COUNT(DISTINCT d.CustKey) AS CustomerCount,
            COUNT(d.SdetailKey) AS DetailCount,
            SUM(ISNULL(d.OutQuantity,0)) AS OutQuantity,
            SUM(ISNULL(d.DateQty,0)) AS DateQuantity,
            SUM(CASE WHEN ISNULL(d.OutQuantity,0) <> 0
                       AND (d.ShipmentDtm IS NULL
                            OR ABS(ISNULL(d.DateQty,0) - ISNULL(d.OutQuantity,0)) > 0.001
                            OR CONVERT(date,d.ShipmentDtm) <> d.MinShipmentDate
                            OR CONVERT(date,d.ShipmentDtm) <> d.MaxShipmentDate)
                     THEN 1 ELSE 0 END) AS DateIssueCount
       FROM target t
       LEFT JOIN Product p ON p.ProdKey=t.ProdKey
       LEFT JOIN detail d ON d.ProdKey=t.ProdKey
      GROUP BY t.ProdKey, p.ProdName
      ORDER BY p.ProdName`,
    { week: { type: sql.NVarChar, value: week }, ...productParams(prodKeys) }
  );
  return result.recordset || [];
}

async function executeDistributeOne({ shapeRows, orderYear, week, prodKey }) {
  const shape = resolveDistributeOneShape(shapeRows);
  const outputDecl = shape.outputs.map((row, i) => `DECLARE @out${i} ${sqlTypeDeclaration(row)};`).join('\n');
  const inputAssignments = [
    `${paramName(shape.yearParam)}=@argYear`,
    `${paramName(shape.weekParam)}=@argWeek`,
    `${paramName(shape.prodParam)}=@argProdKey`,
  ];
  const outputAssignments = shape.outputs.map((row, i) => `${paramName(row)}=@out${i} OUTPUT`);
  const selectOutputs = shape.outputs.map((row, i) => `@out${i} AS [${outputAlias(paramName(row))}]`);
  const selectSql = [`@returnCode AS ReturnCode`, ...selectOutputs].join(', ');
  const execSql = `
DECLARE @returnCode INT;
${outputDecl}
EXEC @returnCode = dbo.usp_DistributeOne ${[...inputAssignments, ...outputAssignments].join(', ')};
SELECT ${selectSql}, @mappingMode AS MappingMode;`;

  const result = await queryWithDeadlockRetry(execSql, {
    argYear: { type: sql.Int, value: Number(orderYear) },
    argWeek: { type: sql.NVarChar, value: week },
    argProdKey: { type: sql.Int, value: Number(prodKey) },
    mappingMode: { type: sql.NVarChar, value: shape.mappingMode },
  }, { retries: 3, baseDelay: 250 });

  const recordsets = result.recordsets || [];
  const finalRecordset = recordsets.length ? recordsets[recordsets.length - 1] : result.recordset;
  return finalRecordset?.[0] || {};
}

function buildProductTargets(rows) {
  const byProd = new Map();
  for (const row of rows || []) {
    if (!row?.prodKey) continue;
    const prodKey = Number(row.prodKey);
    if (!prodKey || byProd.has(prodKey)) continue;
    byProd.set(prodKey, {
      prodKey,
      prodName: row.displayName || row.prodName || row.productLabel || String(prodKey),
    });
  }
  return [...byProd.values()];
}

function procedureFailureSignals(execResult) {
  return Object.entries(execResult || {})
    .filter(([key, value]) => /return|result|error|err|code/i.test(key) && key !== 'MappingMode' && value !== null && value !== undefined && value !== '')
    .map(([key, value]) => ({ key, value, numeric: Number(value) }))
    .filter(row => Number.isFinite(row.numeric) && row.numeric !== 0);
}

async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });
  if (process.env.SHIPMENT_IMPORT_PREDISTRIBUTE_SP_ENABLED !== 'true') {
    return res.status(409).json({
      success: false,
      error: '업로드 품종 일괄분배는 웹 직접저장 경로를 제거했고, 전산 SP(usp_DistributeOne) 파라미터 검증 후에만 활성화됩니다. 먼저 검증하기로 변경분을 확인한 뒤 승인 후 주문등록+분배를 사용하세요.',
    });
  }

  const form = formidable({
    maxFileSize: 30 * 1024 * 1024,
    keepExtensions: true,
    multiples: false,
  });

  let fields, files;
  try {
    [fields, files] = await new Promise((resolve, reject) => {
      form.parse(req, (err, flds, fls) => (err ? reject(err) : resolve([flds, fls])));
    });
  } catch (e) {
    return res.status(400).json({ success: false, error: `업로드 파싱 실패: ${e.message}` });
  }

  const file = Array.isArray(files.file) ? files.file[0] : files.file;
  const week = Array.isArray(fields.week) ? fields.week[0] : fields.week;
  const year = Array.isArray(fields.year) ? fields.year[0] : fields.year;
  if (!file) return res.status(400).json({ success: false, error: 'file 필드 필요' });
  if (!week) return res.status(400).json({ success: false, error: 'week 필요' });

  try {
    const workbook = XLSX.readFile(file.filepath, { cellDates: false, cellNF: false, cellStyles: false });
    const parsed = parseAllocationWorkbook(XLSX, workbook, { sourceName: file.originalFilename || 'upload.xlsx' });
    const preview = await buildImportPreview({ parsedRows: parsed.rows, rawWeek: week });
    const matchedRows = (preview.rows || []).filter(r => r.custKey && r.prodKey);
    const productTargets = buildProductTargets(matchedRows);
    if (productTargets.length === 0) throw new Error('업로드 파일에서 DB 품목으로 매칭된 행이 없습니다.');

    const normalizedWeek = preview.week || week;
    const orderYear = normalizeOrderYear(String(year || week || ''), new Date().getFullYear().toString());
    const prodKeys = productTargets.map(row => row.prodKey);
    const shapeRows = await loadDistributeOneShape();
    resolveDistributeOneShape(shapeRows);
    const keyNumbering = await assertKeyNumberingReady();
    await assertProductsNotFixed(normalizedWeek, prodKeys);
    const beforeSummary = await loadProductShipmentSummary(normalizedWeek, prodKeys);
    const beforeByProd = new Map(beforeSummary.map(row => [Number(row.ProdKey), row]));

    const appliedRows = [];
    for (const target of productTargets) {
      const before = beforeByProd.get(Number(target.prodKey)) || {};
      const execResult = await executeDistributeOne({
        shapeRows,
        orderYear,
        week: normalizedWeek,
        prodKey: target.prodKey,
      });
      const failures = procedureFailureSignals(execResult);
      if (failures.length > 0) {
        const signalText = failures.map(row => `${row.key}=${row.value}`).join(', ');
        throw new Error(`${before.ProdName || target.prodName}: dbo.usp_DistributeOne 실패 반환값이 감지되어 중단했습니다. ${signalText}`);
      }
      appliedRows.push({
        prodKey: target.prodKey,
        prodName: before.ProdName || target.prodName,
        beforeOutQty: Number(before.OutQuantity || 0),
        returnCode: execResult.ReturnCode,
        mappingMode: execResult.MappingMode,
        procedureResult: execResult,
      });
    }

    const afterSummary = await loadProductShipmentSummary(normalizedWeek, prodKeys);
    const afterByProd = new Map(afterSummary.map(row => [Number(row.ProdKey), row]));
    const finalRows = appliedRows.map(row => {
      const after = afterByProd.get(Number(row.prodKey)) || {};
      return {
        ...row,
        afterOutQty: Number(after.OutQuantity || 0),
        customerCount: Number(after.CustomerCount || 0),
        detailCount: Number(after.DetailCount || 0),
        dateIssueCount: Number(after.DateIssueCount || 0),
        log: `${row.prodName}: 전산 usp_DistributeOne 실행, 분배합계 ${row.beforeOutQty} → ${Number(after.OutQuantity || 0)}, 업체 ${Number(after.CustomerCount || 0)}곳, 출고일 문제 ${Number(after.DateIssueCount || 0)}건`,
      };
    });
    const dateIssueCount = finalRows.reduce((sum, row) => sum + Number(row.dateIssueCount || 0), 0);
    if (dateIssueCount > 0) {
      throw new Error(`전산 SP 실행 후 출고일/출고수량 불일치가 ${dateIssueCount}건 감지되어 결과 확인이 필요합니다.`);
    }

    const result = {
      success: true,
      week: normalizedWeek,
      appliedCount: finalRows.length,
      skippedNoChangeCount: 0,
      keyNumbering,
      appliedRows: finalRows,
      logs: [
        `${normalizedWeek}차 업로드 품종 전산 SP 일괄분배 완료`,
        `실행 경로: dbo.usp_DistributeOne (${finalRows.length}개 품목, 주문등록 수량 기준)`,
        ...finalRows.map(row => row.log),
      ],
    };

    return res.status(200).json({
      ...result,
      affected: result.appliedCount || 0,
      fileName: file.originalFilename || 'upload.xlsx',
      unmatchedCount: (preview.unmatched || []).length,
      parseLogs: [...parsed.logs, ...preview.logs],
      logs: [
        ...result.logs,
        (preview.unmatched || []).length > 0
          ? `미매칭 ${(preview.unmatched || []).length}건은 사전분배 대상에서 제외됨`
          : '미매칭 없이 사전분배 대상 추출 완료',
      ],
    });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  } finally {
    try { fs.unlinkSync(file.filepath); } catch {}
  }
}

export default withAuth(withActionLog(handler, {
  actionType: 'SHIPMENT_IMPORT_PREDISTRIBUTE',
  affectedTable: 'dbo.usp_DistributeOne',
  riskLevel: 'HIGH',
}));
