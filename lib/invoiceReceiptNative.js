import { randomUUID } from 'node:crypto';

export function receiptError(code, message, statusCode = 409) {
  return Object.assign(new Error(message), { code, statusCode });
}
const idleFields = ['Mode','LockedAt','Action','OrderYear','OrderWeek','OwnerSessionID','OwnerToken','CalcProdKey'];
export const receiptTransactionCheckSql = `IF @@SPID<>@sessionId OR @@TRANCOUNT<>@transactionCount OR XACT_STATE()<>1
 OR ISNULL(APPLOCK_MODE(N'public',@marker,N'Transaction'),N'NoLock')<>N'Exclusive'
 THROW 51062,'INVOICE_ORIGINAL_TRANSACTION_LOST',1;`;

// Acquire the SAME native gate row, not a web-only substitute. Never clear/take over RUN/WAIT.
export async function acquireInvoiceReceiptGate(queryFn, types) {
  const result = await queryFn(`SELECT *,@@SPID SessionID,@@TRANCOUNT TransactionCount,XACT_STATE() TransactionState
    FROM dbo.NenovaStockWeekGate WITH (UPDLOCK,HOLDLOCK,NOWAIT) WHERE GateKey='1'`);
  const gate = result.recordset?.[0];
  if (result.recordset?.length !== 1 || gate.ProtocolVersion !== 2)
    throw receiptError('STOCK_GATE_CAPABILITY_REQUIRED','재고 게이트 V2를 확인해야 합니다.');
  if (!idleFields.every(k => gate[k] === null) || ![0,false].includes(gate.PendingCalc))
    throw receiptError('STOCK_GATE_BUSY','다른 재고 작업 또는 미완료 계산이 있습니다. 기존 잠금은 변경하지 않았습니다.');
  if (gate.TransactionCount <= 0 || gate.TransactionState !== 1)
    throw receiptError('INVOICE_TRANSACTION_REQUIRED','입고 저장 트랜잭션을 확인하지 못했습니다.');
  const capability = await queryFn('EXEC dbo.usp_NenovaStockWeekGateCapability;');
  if (capability.recordset?.length !== 1 || capability.recordset[0].ProtocolVersion !== 2
    || ![true,1].includes(capability.recordset[0].IsReady))
    throw receiptError('STOCK_GATE_CAPABILITY_REQUIRED','재고 게이트가 준비되지 않았습니다.');
  const params = {sessionId:{type:types.Int,value:gate.SessionID},
    transactionCount:{type:types.Int,value:gate.TransactionCount},
    marker:{type:types.NVarChar,value:`NenovaInvoiceReceipt:${randomUUID()}`}};
  await queryFn(`DECLARE @r int;
    EXEC @r=sys.sp_getapplock @Resource=@marker,@LockMode=N'Exclusive',@LockOwner=N'Transaction',@LockTimeout=0;
    IF @r IS NULL OR @r<0 THROW 51062,'INVOICE_TRANSACTION_MARKER_FAILED',1;
    ${receiptTransactionCheckSql}`,params);
  return params;
}

export async function nextInvoiceWarehouseKey(queryFn, types, transactionParams) {
  const result = await queryFn(`${receiptTransactionCheckSql}
    DECLARE @key int=NULL,@rc int=NULL;
    EXEC @rc=dbo.usp_GetNextKey @iCategory=N'WarehouseKey',@iInterval=1,@oNextKey=@key OUTPUT;
    ${receiptTransactionCheckSql}
    IF @rc IS NULL OR @rc<>0 OR @key IS NULL OR @key<=0 THROW 51065,'INVOICE_KEY_FAILED',1;
    SELECT @key WarehouseKey;`,transactionParams);
  const rows=result.recordsets?.at(-1) || result.recordset;
  if (rows?.length!==1 || !Number.isInteger(rows[0].WarehouseKey) || rows[0].WarehouseKey<=0)
    throw receiptError('INVOICE_KEY_FAILED','입고번호를 확인하지 못했습니다.');
  return rows[0].WarehouseKey;
}

export async function calculateInvoiceStock(queryFn, types, transactionParams, document, actor) {
  const params={...transactionParams, year:{type:types.NVarChar,value:document.orderYear},
    week:{type:types.NVarChar,value:document.orderWeek},uid:{type:types.NVarChar,value:actor}};
  // Native packing upload uses ProdKey=0: the selected and subsequent StockMaster cascade.
  const result=await queryFn(`${receiptTransactionCheckSql}
    DECLARE @r int=NULL,@rc int=NULL,@msg nvarchar(max)=NULL;
    EXEC @rc=dbo.usp_StockCalculation @OrderYear=@year,@OrderWeek=@week,@ProdKey=0,
      @iUserID=@uid,@oResult=@r OUTPUT,@oMessage=@msg OUTPUT;
    ${receiptTransactionCheckSql}
    IF @r IS NULL OR @rc IS NULL OR @r<>0 OR @rc<>0 THROW 51064,'INVOICE_STOCK_CALC_FAILED',1;
    IF NOT EXISTS(SELECT 1 FROM dbo.NenovaStockWeekGate WHERE GateKey='1' AND ProtocolVersion=2
      AND Mode IS NULL AND PendingCalc=0 AND OwnerToken IS NULL AND OwnerSessionID IS NULL
      AND LockedAt IS NULL AND Action IS NULL AND OrderYear IS NULL AND OrderWeek IS NULL AND CalcProdKey IS NULL)
      THROW 51063,'INVOICE_GATE_NOT_IDLE_AFTER_CALC',1;
    SELECT @r result,@rc returnCode;`,params);
  const rows=result.recordsets?.at(-1)||result.recordset;
  if(rows?.length!==1||rows[0].result!==0||rows[0].returnCode!==0)
    throw receiptError('INVOICE_STOCK_CALC_FAILED','재고 계산 성공을 확인하지 못했습니다.');
}
