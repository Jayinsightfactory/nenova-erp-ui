import { createHash } from 'node:crypto';
import { warehouseFarmChoicesSql } from './warehouseFarmChoices.js';
import { readInvoiceReceiptEligibility } from './invoiceReceiptEligibility.js';
import { receiptError } from './invoiceReceiptNative.js';
import { isMatchingDuplicateWarehouseRow } from './packingDuplicateCheck.js';

export function manualWarehouseFileName(meta, items) {
  const digest = createHash('sha256').update(JSON.stringify([meta, items])).digest('hex');
  return `manual-${meta.operationId}-${digest}`;
}

export async function readManualWarehouseAttempt(query, types, meta, items, actor, locked = false) {
  const fileName = manualWarehouseFileName(meta, items);
  const filePrefix = `manual-${meta.operationId}-`;
  const hint = locked ? 'WITH (UPDLOCK,HOLDLOCK)' : '';
  const { recordset } = await query(`/* manual-warehouse:attempt */
    SELECT WarehouseKey,FileName,CreateID,isDeleted FROM dbo.WarehouseMaster ${hint}
    WHERE LEFT(FileName,LEN(@filePrefix))=@filePrefix`, { filePrefix: { type: types.NVarChar, value: filePrefix } });
  if (recordset.length === 0) return { fileName, replay: null };
  const prior = recordset[0];
  if (recordset.length !== 1 || prior.isDeleted || prior.FileName !== fileName || prior.CreateID !== actor) {
    throw receiptError('WAREHOUSE_MANUAL_RETRY_CONFLICT', '이 수기 업로드 요청 번호의 내용이 다릅니다. 기존 입고를 먼저 확인하세요.');
  }
  return { fileName, replay: prior.WarehouseKey };
}

export async function assertManualWarehouseEligible(query, types, meta, items, locked = false) {
  const params = {
    year: { type: types.NVarChar, value: meta.orderYear }, week: { type: types.NVarChar, value: meta.orderWeek },
    farm: { type: types.NVarChar, value: meta.farmName }, invoice: { type: types.NVarChar, value: meta.invoiceNo },
  };
  const farms = (await query(warehouseFarmChoicesSql({ locked, selected: true, activeOnly: true }), params)).recordset;
  if (farms.length !== 1 || farms[0].FarmName !== meta.farmName) {
    throw receiptError('WAREHOUSE_MANUAL_FARM_CHANGED', '현재 등록된 농장을 다시 선택하세요.', 400);
  }
  if (meta.invoiceNo) {
    const hint = locked ? 'WITH (UPDLOCK,HOLDLOCK)' : '';
    const duplicates = await query(`/* manual-warehouse:linked-or-duplicate */
      SELECT WarehouseKey, FarmName, InvoiceNo, N'WM' AS SourceKind FROM dbo.WarehouseMaster ${hint}
      WHERE OrderYear=@year AND OrderWeek=@week AND ISNULL(isDeleted,0)=0
      UNION ALL
      SELECT NULL AS WarehouseKey, NULL AS FarmName, InvoiceNo, N'DOC' AS SourceKind FROM dbo.WebInvoiceDocument ${hint}
      WHERE OrderYear=@year AND OrderWeek=@week
        AND (FarmKey=@farmKey OR FarmKey IS NULL)`, {
      ...params, farmKey: { type: types.Int, value: farms[0].FarmKey },
    });
    const matched = (duplicates.recordset || []).some(row => {
      if (row.SourceKind === 'DOC') {
        return isMatchingDuplicateWarehouseRow({ InvoiceNo: row.InvoiceNo }, { invoiceNo: meta.invoiceNo });
      }
      return isMatchingDuplicateWarehouseRow(row, { farmName: meta.farmName, invoiceNo: meta.invoiceNo });
    });
    if (matched) throw receiptError('DUPLICATE_INVOICE', '같은 범위의 입고 또는 인보이스 문서가 있습니다. 기존 자료에서 확인하세요.');
  }
  const queryFn = locked ? (statement, parameters) => query(statement
    .replaceAll('FROM dbo.StockMaster', 'FROM dbo.StockMaster WITH (HOLDLOCK)')
    .replaceAll('JOIN dbo.ViewShipment vs', 'JOIN dbo.ViewShipment vs WITH (HOLDLOCK)'), parameters) : query;
  const eligibility = await readInvoiceReceiptEligibility({ queryFn, types, ...meta, prodKeys: [...new Set(items.map(item => item.prodKey))] });
  if (!eligibility.canProceed) throw receiptError(eligibility.code, eligibility.message);
}
