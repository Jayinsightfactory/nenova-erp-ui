import { createHash, randomUUID } from 'node:crypto';
import { getInvoiceDocument } from './invoiceReceiptDocuments.js';
import { receiptError } from './invoiceReceiptNative.js';

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const same = (a, b) => a != null && b != null && Number.isFinite(Number(a)) && Number.isFinite(Number(b)) && Math.abs(Number(a) - Number(b)) < 0.000001;
const key = (prod, price) => `${Number(prod)}:${Number(price).toFixed(6)}`;
const p = (type, value) => ({ type, value });
const fail = message => { throw receiptError('EXISTING_RECEIPT_MISMATCH', message, 409); };

// One source line keeps its own quantity; a grouped native row is never copied
// into every source line. All native rows, including costs, remain in the snapshot.
export function planExistingReceiptLink(document, header, details, farmName) {
  const country = document.reviewedMetadata?.country;
  if (!['NL', 'CN'].includes(country)) fail('기존 입고 원가 연결은 네덜란드 송이·중국 단 자료를 지원합니다.');
  const china = country === 'CN';
  if (!header || ![0, false].includes(header.isDeleted)
    || header.OrderYear !== document.orderYear || header.OrderWeek !== document.orderWeek
    || String(header.FarmName).trim() !== String(farmName).trim() || header.InvoiceNo !== document.invoiceNo
    || String(header.InputDate).slice(0, 4) !== document.invoiceYear) fail('기존 입고의 연도·차수·농장·송장 범위가 다릅니다.');
  if (!Array.isArray(details) || !details.length || !document.lines?.length) fail('상품행이 없습니다.');
  const goods = [], excluded = [];
  for (const row of details) {
    if (china && row.ProdKey == null && row.OutQuantity == null && row.EstQuantity == null
      && same(row.UPrice, 0) && same(row.TPrice, 0)) {
      // Unassigned non-financial native rows are preserved, not named or repaired.
      excluded.push(row);
    } else if ((row.ProdKey === 3100 && row.ProdName === 'Gross weight')
      || (row.ProdKey === 3101 && row.ProdName === 'Chargeable weight')) {
      if (!same(row.UPrice, 0) || !same(row.TPrice, 0)) fail('무게행에 금액이 있어 자동 연결할 수 없습니다.');
      excluded.push(row);
    } else if (row.ProdKey === 2182 && row.ProdName === '운송료') {
      const raw = document.rawMetadata || {};
      if (china) {
        const fees = raw.additionalCosts;
        if (!Array.isArray(fees) || !fees.length || fees.some(fee => fee.amount == null || !Number.isFinite(Number(fee.amount)) || Number(fee.amount) < 0)
          || !same(row.TPrice, fees.reduce((total, fee) => total + Number(fee.amount), 0))) fail('기존 운송료와 원본 부대비 합계가 다릅니다.');
      } else if (raw.freight == null || raw.handling == null || !same(row.TPrice, Number(raw.freight) + Number(raw.handling))) fail('기존 운송료와 송장 운송·서류비 합계가 다릅니다.');
      excluded.push(row);
    } else goods.push(row);
  }
  const native = new Map();
  for (const row of goods) {
    const id = key(row.ProdKey, row.UPrice);
    if (native.has(id)) fail('같은 품목·단가의 기존 상세가 여러 개여서 수동 확인이 필요합니다.');
    native.set(id, row);
  }
  const grouped = new Map();
  const lineMappings = document.lines.map(line => {
    const quantity = china ? line.bunchQuantity : line.stemQuantity;
    if (line.currency !== (china ? 'CNY' : 'EUR') || !(china ? ['단', 'BUNCH'] : ['송이', 'STEM']).includes(line.priceUnit)
      || !(Number(quantity) > 0) || line.unitPrice == null || Number(line.unitPrice) < 0
      || !same(line.lineAmount, Number(quantity) * Number(line.unitPrice))
      || line.reviewed?.confirmed !== true) fail(`${line.lineNo}행 품목·송이·가격 확인이 필요합니다.`);
    const id = key(line.prodKey, line.unitPrice), row = native.get(id);
    if (!row) fail(`${line.lineNo}행과 같은 품목·단가의 기존 입고가 없습니다.`);
    const total = grouped.get(id) || { quantity: 0, amount: 0 };
    total.quantity += Number(quantity); total.amount += Number(line.lineAmount); grouped.set(id, total);
    return { lineId: line.lineId, wdetailKey: row.WdetailKey, prodKey: row.ProdKey,
      outQuantity: Number(quantity), unit: china ? '단' : '송이', boxQuantity: null, bunchQuantity: china ? Number(quantity) : null,
      stemQuantity: line.stemQuantity == null ? null : Number(line.stemQuantity), unitPrice: Number(line.unitPrice), lineAmount: Number(line.lineAmount) };
  });
  if (grouped.size !== native.size) fail('원문에 없는 기존 입고 상품이 있습니다.');
  for (const [id, total] of grouped) {
    const row = native.get(id);
    if (!same(total.quantity, china ? row.BunchQuantity : row.SteamQuantity) || !same(total.amount, row.TPrice)) fail(`${row.ProdName}: 원문 합계와 기존 입고의 ${china ? '단수' : '송이수'}·금액이 다릅니다.`);
  }
  return { lineMappings, excludedDetailKeys: excluded.map(row => row.WdetailKey),
    goodsCount: goods.length, sourceCount: document.lines.length,
    quantityUnit: china ? '단' : '송이', quantity: lineMappings.reduce((sum, row) => sum + row.outQuantity, 0),
    stemQuantity: lineMappings.reduce((sum, row) => sum + (row.stemQuantity ?? 0), 0) };
}

export async function previewExistingReceiptLink({ queryFn, types, documentId, revision, locked = false }) {
  const document = await getInvoiceDocument({ queryFn, types, documentId });
  if (!document || document.revision !== revision) fail('저장 문서 버전이 변경되었습니다.');
  if (document.operations.some(op => op.status === 'COMMITTED')) fail('이미 입고에 연결된 문서입니다. 원가 화면에서 계속하세요.');
  const params = { year: p(types.NVarChar, document.orderYear), week: p(types.NVarChar, document.orderWeek),
    farm: p(types.Int, document.farmKey), invoice: p(types.NVarChar, document.invoiceNo), invoiceYear: p(types.NVarChar, document.invoiceYear) };
  const farm = (await queryFn('/* existing-cost:farm */ SELECT FarmName FROM dbo.Farm WHERE FarmKey=@farm AND isDeleted=0', params)).recordset;
  if (farm?.length !== 1) fail('활성 농장을 선택하세요.');
  params.farmName = p(types.NVarChar, farm[0].FarmName);
  const headers = (await queryFn(`/* existing-cost:header */ SELECT WarehouseKey,OrderYear,OrderWeek,FarmName,InvoiceNo,OrderNo,
    CONVERT(varchar(10),InputDate,23) InputDate,GrossWeight,ChargeableWeight,FreightRateUSD,DocFeeUSD,isDeleted
    FROM dbo.WarehouseMaster ${locked ? 'WITH (UPDLOCK,HOLDLOCK)' : ''}
    WHERE OrderYear=@year AND OrderWeek=@week AND FarmName=@farmName AND InvoiceNo=@invoice
      AND YEAR(InputDate)=TRY_CONVERT(int,@invoiceYear) AND isDeleted=0`, params)).recordset;
  if (headers?.length !== 1) fail('같은 범위의 기존 입고가 정확히 1건이어야 합니다.');
  const header = headers[0]; params.wk = p(types.Int, header.WarehouseKey);
  const details = (await queryFn(`/* existing-cost:details */ SELECT d.WdetailKey,d.ProdKey,d.BoxQuantity,d.BunchQuantity,d.SteamQuantity,d.OutQuantity,
    d.EstQuantity,d.UPrice,d.TPrice,p.ProdName FROM dbo.WarehouseDetail d ${locked ? 'WITH (UPDLOCK,HOLDLOCK)' : ''}
    LEFT JOIN dbo.Product p ON p.ProdKey=d.ProdKey WHERE d.WarehouseKey=@wk ORDER BY d.WdetailKey`, params)).recordset;
  const conflicts = (await queryFn(`/* existing-cost:conflict */ SELECT OperationId FROM dbo.WebInvoiceOperation ${locked ? 'WITH (UPDLOCK,HOLDLOCK)' : ''}
    WHERE WarehouseKey=@wk AND Status=N'COMMITTED'`, params)).recordset;
  if (!Array.isArray(conflicts) || conflicts.length) fail('다른 웹 문서에 연결된 입고입니다.');
  const plan = planExistingReceiptLink(document, header, details, farm[0].FarmName);
  const receiptSnapshot = { header, details };
  return { ...plan, document, warehouseKey: header.WarehouseKey, receiptSnapshot,
    receiptDigest: hash(receiptSnapshot), baselineDigest: hash({ document, receiptSnapshot }), canLink: true };
}

export async function linkExistingReceipt({ withTransactionFn, types, documentId, revision, baselineDigest, operationId, actor }) {
  if (!/^[a-f0-9]{64}$/.test(baselineDigest || '') || !/^[a-f0-9-]{36}$/i.test(operationId || '') || !actor) fail('검증 결과와 작업 식별자가 필요합니다.');
  const requestHash = Buffer.from(hash({ documentId, revision, baselineDigest, operationId, actor }), 'hex');
  return withTransactionFn(async queryFn => {
    const params = { id: p(types.UniqueIdentifier, documentId), revision: p(types.Int, revision), op: p(types.UniqueIdentifier, operationId),
      actor: p(types.NVarChar, actor), hash: p(types.Binary(32), requestHash), part: p(types.UniqueIdentifier, randomUUID()) };
    // Serialize web-only attachment operations; native receipt writes are never called.
    await queryFn(`/* existing-cost:lock */ DECLARE @r int; EXEC @r=sys.sp_getapplock @Resource=N'NenovaWeb:InvoiceExistingLink',@LockMode=N'Exclusive',@LockOwner=N'Transaction',@LockTimeout=10000;
      IF @r<0 THROW 51070,N'LINK_BUSY',1;
      SELECT DocumentId FROM dbo.WebInvoiceDocument WITH (UPDLOCK,HOLDLOCK) WHERE DocumentId=@id`, params);
    const existing = (await queryFn('/* existing-cost:retry */ SELECT RequestHash,Status,ResultJson FROM dbo.WebInvoiceOperation WHERE OperationId=@op', params)).recordset;
    if (existing?.length) {
      if (!Buffer.from(existing[0].RequestHash).equals(requestHash) || existing[0].Status !== 'COMMITTED') fail('동일 작업번호의 요청 또는 상태가 다릅니다.');
      return JSON.parse(existing[0].ResultJson);
    }
    const preview = await previewExistingReceiptLink({ queryFn, types, documentId, revision, locked: true });
    if (preview.baselineDigest !== baselineDigest) fail('검증 후 전산 또는 문서 값이 변경되었습니다. 다시 대조하세요.');
    const result = { operationId, documentId, revision, warehouseKey: preview.warehouseKey, linkMode: preview.document.reviewedMetadata.country === 'CN' ? 'EXISTING_CN' : 'EXISTING_NL',
      receiptDigest: preview.receiptDigest, receiptSnapshot: preview.receiptSnapshot, lineMappings: preview.lineMappings,
      excludedDetailKeys: preview.excludedDetailKeys, erpChanged: false };
    params.wk = p(types.Int, preview.warehouseKey); params.result = p(types.NVarChar(types.MAX), JSON.stringify(result));
    await queryFn(`/* existing-cost:save */ INSERT dbo.WebInvoiceOperation
      (OperationId,DocumentId,DocumentRevision,ReceiptPartId,RequestHash,Action,Status,WarehouseKey,ResultJson,Actor,CreatedAt,CompletedAt)
      VALUES(@op,@id,@revision,@part,@hash,N'LINK_EXISTING_COST',N'COMMITTED',@wk,@result,@actor,SYSUTCDATETIME(),SYSUTCDATETIME());
      UPDATE dbo.WebInvoiceDocument SET ReceiptStatus=N'COMMITTED',CostStatus=N'PENDING',UpdatedBy=@actor,UpdatedAt=SYSUTCDATETIME()
      WHERE DocumentId=@id AND Revision=@revision;
      IF @@ROWCOUNT<>1 THROW 51071,N'LINK_DOCUMENT_CHANGED',1;
      INSERT dbo.WebInvoiceHistory(DocumentId,Revision,OperationId,Action,AfterJson,Reason,Actor,CreatedAt)
      VALUES(@id,@revision,@op,N'LINK_EXISTING_COST',@result,N'기존 입고 보존, 원가만 연결',@actor,SYSUTCDATETIME());`, params);
    const readback = (await queryFn(`/* existing-cost:readback */ SELECT o.ResultJson,d.ReceiptStatus
      FROM dbo.WebInvoiceOperation o JOIN dbo.WebInvoiceDocument d ON d.DocumentId=o.DocumentId
      WHERE o.OperationId=@op AND o.DocumentId=@id AND o.DocumentRevision=@revision
      AND d.Revision=@revision AND o.Status=N'COMMITTED' AND o.Action=N'LINK_EXISTING_COST'`, params)).recordset;
    if (readback?.length !== 1 || readback[0].ReceiptStatus !== 'COMMITTED'
      || readback[0].ResultJson !== JSON.stringify(result)) fail('원가 연결 저장 후 재조회가 일치하지 않습니다. 연결을 취소합니다.');
    return result;
  }, { retries: 0 });
}
