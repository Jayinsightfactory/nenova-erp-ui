import { sql } from './db.js';

// All adjustment entry points share global PK allocators. Acquire before any
// lease/ERP lock, including the first entry in an atomic batch. SQL owns the
// lock until this transaction ends; a process-local queue is insufficient.
export const SHIPMENT_ADJUSTMENT_TRANSACTION_OPTIONS = { retries: 5, baseDelay: 250 };
export async function acquireShipmentAdjustmentLock(tQ) {
  const result = await tQ(`DECLARE @result int;
    EXEC @result = sys.sp_getapplock
      @Resource=@resource, @LockMode='Exclusive', @LockOwner='Transaction', @LockTimeout=10000;
    SELECT @result AS lockResult;`, {
    resource: { type: sql.NVarChar, value: 'nenova:shipment-adjustment-write:v1' },
  });
  const code = result.recordset?.[0]?.lockResult;
  if (!Number.isInteger(code) || code < 0) {
    const error = new Error('다른 분배 저장이 진행 중이어서 이번 요청을 저장하지 않았습니다. 잠시 후 다시 실행해 주세요.');
    error.code = 'ERP_DISTRIBUTION_BUSY';
    error.statusCode = 503;
    throw error;
  }
}
