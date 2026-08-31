import { query, withTransaction, sql } from './db.js';
import { assertShipmentImportSnapshotSchema, canonicalJson } from './shipmentImportSnapshot.js';

const ENTITY_TYPES = new Set(['OrderMaster', 'OrderDetail', 'ShipmentMaster', 'ShipmentDetail', 'ShipmentDate', 'ShipmentFarm']);

function parseJson(value, fallback = null) {
  if (value == null || value === '') return fallback;
  return JSON.parse(value);
}

function pInt(value) { return { type: sql.Int, value: Number(value) }; }
function pText(value, length = 500) { return { type: sql.NVarChar(length), value: value == null ? null : String(value).slice(0, length) }; }
function pFloat(value) { return { type: sql.Float, value: value == null ? null : Number(value) }; }
function pDate(value) { return { type: sql.DateTime, value: value ? new Date(value) : null }; }

async function readCurrentEntity(tQ, snapshot) {
  const key = Number(snapshot.EntityKey);
  switch (snapshot.EntityType) {
    case 'OrderMaster': {
      const r = await tQ('SELECT TOP 1 * FROM OrderMaster WITH (UPDLOCK,HOLDLOCK) WHERE OrderMasterKey=@key', { key: pInt(key) });
      return canonicalJson(r.recordset?.[0] || null);
    }
    case 'OrderDetail': {
      const r = await tQ('SELECT TOP 1 * FROM OrderDetail WITH (UPDLOCK,HOLDLOCK) WHERE OrderDetailKey=@key', { key: pInt(key) });
      return canonicalJson(r.recordset?.[0] || null);
    }
    case 'ShipmentMaster': {
      const r = await tQ('SELECT TOP 1 * FROM ShipmentMaster WITH (UPDLOCK,HOLDLOCK) WHERE ShipmentKey=@key', { key: pInt(key) });
      return canonicalJson(r.recordset?.[0] || null);
    }
    case 'ShipmentDetail': {
      const r = await tQ('SELECT TOP 1 * FROM ShipmentDetail WITH (UPDLOCK,HOLDLOCK) WHERE SdetailKey=@key', { key: pInt(key) });
      return canonicalJson(r.recordset?.[0] || null);
    }
    case 'ShipmentDate': {
      const r = await tQ('SELECT * FROM ShipmentDate WITH (UPDLOCK,HOLDLOCK) WHERE SdetailKey=@key ORDER BY SdateKey', { key: pInt(key) });
      return canonicalJson(r.recordset || [], { isArray: true, omitCols: ['SdateKey'] });
    }
    case 'ShipmentFarm': {
      const r = await tQ('SELECT * FROM ShipmentFarm WITH (UPDLOCK,HOLDLOCK) WHERE SdetailKey=@key', { key: pInt(key) });
      return canonicalJson(r.recordset || [], { isArray: true });
    }
    default:
      throw new Error(`지원하지 않는 복원 원장입니다: ${snapshot.EntityType}`);
  }
}

function conflictLabel(snapshot) {
  return `${snapshot.EntityType} #${snapshot.EntityKey}${snapshot.CustKey ? ` · 업체 ${snapshot.CustKey}` : ''}${snapshot.ProdKey ? ` · 품목 ${snapshot.ProdKey}` : ''}`;
}

async function appendOrderRollbackHistory(tQ, row, beforeQty, afterQty, actor) {
  if (!row?.OrderDetailKey) return;
  await tQ(
    `INSERT INTO OrderHistory
       (OrderDetailKey, ChangeType, ColumName, BeforeValue, AfterValue, Descr, ChangeID, ChangeDtm)
     VALUES (@key,N'수정',N'OutQuantity',@before,@after,N'엑셀 업로드 전체 되돌리기',@actor,GETDATE())`,
    { key: pInt(row.OrderDetailKey), before: pText(beforeQty, 100), after: pText(afterQty, 100), actor: pText(actor, 100) },
  );
}

async function appendShipmentRollbackHistory(tQ, row, beforeQty, afterQty, actor) {
  if (!row?.SdetailKey) return;
  await tQ(
    `INSERT INTO ShipmentHistory
       (SdetailKey, ShipmentDtm, ChangeType, BeforeValue, AfterValue, Descr, ChangeID, ChangeDtm)
     VALUES (@key,@dt,N'수정',@before,@after,N'엑셀 업로드 전체 되돌리기',@actor,GETDATE())`,
    { key: pInt(row.SdetailKey), dt: pDate(row.ShipmentDtm), before: pText(beforeQty, 100), after: pText(afterQty, 100), actor: pText(actor, 100) },
  );
}

async function restoreShipmentDetail(tQ, snapshot, actor) {
  const before = parseJson(snapshot.BeforeJson);
  const after = parseJson(snapshot.AfterJson);
  const key = Number(snapshot.EntityKey);
  if (!before) {
    if (after) await appendShipmentRollbackHistory(tQ, after, after.OutQuantity, 0, actor);
    await tQ('DELETE FROM ShipmentFarm WHERE SdetailKey=@key; DELETE FROM ShipmentDate WHERE SdetailKey=@key; DELETE FROM ShipmentDetail WHERE SdetailKey=@key;', { key: pInt(key) });
    return;
  }
  const params = {
    key: pInt(key), sk: pInt(before.ShipmentKey), ck: pInt(before.CustKey), pk: pInt(before.ProdKey),
    dt: pDate(before.ShipmentDtm), outQty: pFloat(before.OutQuantity), estQty: pFloat(before.EstQuantity),
    box: pFloat(before.BoxQuantity), bunch: pFloat(before.BunchQuantity), steam: pFloat(before.SteamQuantity),
    cost: pFloat(before.Cost), amount: pFloat(before.Amount), vat: pFloat(before.Vat),
    fix: { type: sql.Bit, value: Number(before.isFix || 0) }, descr: pText(before.Descr || '', 4000),
  };
  const exists = await tQ('SELECT COUNT(*) AS Cnt FROM ShipmentDetail WITH (UPDLOCK,HOLDLOCK) WHERE SdetailKey=@key', { key: pInt(key) });
  if (Number(exists.recordset?.[0]?.Cnt || 0) > 0) {
    await tQ(
      `UPDATE ShipmentDetail SET ShipmentKey=@sk,CustKey=@ck,ProdKey=@pk,ShipmentDtm=@dt,
          OutQuantity=@outQty,EstQuantity=@estQty,BoxQuantity=@box,BunchQuantity=@bunch,SteamQuantity=@steam,
          Cost=@cost,Amount=@amount,Vat=@vat,isFix=@fix,Descr=@descr WHERE SdetailKey=@key`, params,
    );
  } else {
    await tQ(
      `INSERT INTO ShipmentDetail
         (SdetailKey,ShipmentKey,CustKey,ProdKey,ShipmentDtm,OutQuantity,EstQuantity,BoxQuantity,BunchQuantity,SteamQuantity,Cost,Amount,Vat,isFix,Descr)
       VALUES (@key,@sk,@ck,@pk,@dt,@outQty,@estQty,@box,@bunch,@steam,@cost,@amount,@vat,@fix,@descr)`, params,
    );
  }
  await appendShipmentRollbackHistory(tQ, before, after?.OutQuantity || 0, before.OutQuantity || 0, actor);
}

async function restoreShipmentDates(tQ, snapshot) {
  const key = Number(snapshot.EntityKey);
  const rows = parseJson(snapshot.BeforeJson, []) || [];
  await tQ('DELETE FROM ShipmentDate WHERE SdetailKey=@key', { key: pInt(key) });
  for (const row of rows) {
    await tQ(
      `INSERT INTO ShipmentDate (SdetailKey,ShipmentDtm,ShipmentQuantity,EstQuantity,Cost,Amount,Vat)
       VALUES (@key,@dt,@qty,@est,@cost,@amount,@vat)`,
      { key: pInt(key), dt: pDate(row.ShipmentDtm), qty: pFloat(row.ShipmentQuantity), est: pFloat(row.EstQuantity), cost: pFloat(row.Cost), amount: pFloat(row.Amount), vat: pFloat(row.Vat) },
    );
  }
}

async function restoreShipmentFarms(tQ, snapshot) {
  const key = Number(snapshot.EntityKey);
  const rows = parseJson(snapshot.BeforeJson, []) || [];
  await tQ('DELETE FROM ShipmentFarm WHERE SdetailKey=@key', { key: pInt(key) });
  for (const row of rows) {
    await tQ(
      'INSERT INTO ShipmentFarm (FarmKey,ShipmentQuantity,SdetailKey) VALUES (@farm,@qty,@key)',
      { farm: pInt(row.FarmKey), qty: pFloat(row.ShipmentQuantity), key: pInt(key) },
    );
  }
}

async function restoreOrderDetail(tQ, snapshot, actor) {
  const before = parseJson(snapshot.BeforeJson);
  const after = parseJson(snapshot.AfterJson);
  const key = Number(snapshot.EntityKey);
  if (!before) {
    if (after) await appendOrderRollbackHistory(tQ, after, after.OutQuantity, 0, actor);
    await tQ(
      `UPDATE OrderDetail SET BoxQuantity=0,BunchQuantity=0,SteamQuantity=0,OutQuantity=0,EstQuantity=0,
          NoneOutQuantity=0,isDeleted=1,LastUpdateID=@actor,LastUpdateDtm=GETDATE() WHERE OrderDetailKey=@key`,
      { key: pInt(key), actor: pText(actor, 100) },
    );
    return;
  }
  await tQ(
    `UPDATE OrderDetail SET BoxQuantity=@box,BunchQuantity=@bunch,SteamQuantity=@steam,OutQuantity=@outQty,
        EstQuantity=@est,NoneOutQuantity=@noneOut,Descr=@descr,isDeleted=@deleted,
        LastUpdateID=@lastId,LastUpdateDtm=@lastDtm WHERE OrderDetailKey=@key`,
    {
      key: pInt(key), box: pFloat(before.BoxQuantity), bunch: pFloat(before.BunchQuantity), steam: pFloat(before.SteamQuantity),
      outQty: pFloat(before.OutQuantity), est: pFloat(before.EstQuantity), noneOut: pFloat(before.NoneOutQuantity),
      descr: pText(before.Descr || '', 4000), deleted: { type: sql.Bit, value: Number(before.isDeleted || 0) },
      lastId: pText(before.LastUpdateID, 100), lastDtm: pDate(before.LastUpdateDtm),
    },
  );
  await appendOrderRollbackHistory(tQ, before, after?.OutQuantity || 0, before.OutQuantity || 0, actor);
}

async function restoreOrderMaster(tQ, snapshot, actor) {
  const before = parseJson(snapshot.BeforeJson);
  const key = Number(snapshot.EntityKey);
  if (!before) {
    const active = await tQ('SELECT COUNT(*) AS Cnt FROM OrderDetail WHERE OrderMasterKey=@key AND ISNULL(isDeleted,0)=0', { key: pInt(key) });
    if (Number(active.recordset?.[0]?.Cnt || 0) > 0) throw new Error(`새 주문 마스터 #${key}에 후속 주문행이 있어 되돌릴 수 없습니다.`);
    await tQ('UPDATE OrderMaster SET isDeleted=1,LastUpdateID=@actor,LastUpdateDtm=GETDATE() WHERE OrderMasterKey=@key', { key: pInt(key), actor: pText(actor, 100) });
    return;
  }
  await tQ(
    `UPDATE OrderMaster SET Manager=@manager,OrderCode=@orderCode,Descr=@descr,isDeleted=@deleted,
        LastUpdateID=@lastId,LastUpdateDtm=@lastDtm WHERE OrderMasterKey=@key`,
    { key: pInt(key), manager: pText(before.Manager, 100), orderCode: pText(before.OrderCode, 100), descr: pText(before.Descr || '', 4000), deleted: { type: sql.Bit, value: Number(before.isDeleted || 0) }, lastId: pText(before.LastUpdateID, 100), lastDtm: pDate(before.LastUpdateDtm) },
  );
}

async function restoreShipmentMaster(tQ, snapshot, actor) {
  const before = parseJson(snapshot.BeforeJson);
  const key = Number(snapshot.EntityKey);
  if (!before) {
    const deps = await tQ(
      `SELECT (SELECT COUNT(*) FROM ShipmentDetail WHERE ShipmentKey=@key) AS DetailCount,
              (SELECT COUNT(*) FROM Estimate WHERE ShipmentKey=@key) AS EstimateCount`,
      { key: pInt(key) },
    );
    const row = deps.recordset?.[0] || {};
    if (Number(row.DetailCount || 0) > 0 || Number(row.EstimateCount || 0) > 0) {
      throw new Error(`새 출고 마스터 #${key}에 후속 상세/견적이 있어 되돌릴 수 없습니다.`);
    }
    await tQ('UPDATE ShipmentMaster SET isDeleted=1 WHERE ShipmentKey=@key', { key: pInt(key) });
    return;
  }
  await tQ(
    'UPDATE ShipmentMaster SET isFix=@fix,isDeleted=@deleted WHERE ShipmentKey=@key',
    { key: pInt(key), fix: { type: sql.Bit, value: Number(before.isFix || 0) }, deleted: { type: sql.Bit, value: Number(before.isDeleted || 0) } },
  );
}

export async function listShipmentImportHistory({ limit = 30 } = {}) {
  await assertShipmentImportSnapshotSchema(query);
  const result = await query(
    `SELECT TOP (@limit) a.AuditKey,a.CreatedDtm,a.CompletedDtm,a.ActorUserId,a.ActorName,a.OrderYear,a.OrderWeek,
            a.ApplyMode,a.AuditStatus,a.AppliedCount,a.OrderCreatedCount,a.OrderUpdatedCount,
            a.ShipmentCreatedCount,a.ShipmentUpdatedCount,a.ShipmentDeletedCount,
            a.RollbackStatus,a.RolledBackDtm,a.RolledBackBy,a.RollbackReason,
            (SELECT COUNT(*) FROM ShipmentImportSnapshot s WHERE s.AuditKey=a.AuditKey) AS SnapshotCount
       FROM ShipmentImportAudit a
      ORDER BY a.AuditKey DESC`,
    { limit: pInt(Math.max(1, Math.min(Number(limit) || 30, 100))) },
  );
  return result.recordset || [];
}

export async function rollbackShipmentImportBatch({ auditKey, actor, reason = '' }) {
  await assertShipmentImportSnapshotSchema(query);
  return withTransaction(async (tQ) => {
    const headerResult = await tQ('SELECT TOP 1 * FROM ShipmentImportAudit WITH (UPDLOCK,HOLDLOCK) WHERE AuditKey=@key', { key: pInt(auditKey) });
    const header = headerResult.recordset?.[0];
    if (!header) throw new Error('해당 업로드 이력을 찾지 못했습니다.');
    if (String(header.RollbackStatus || 'NONE') === 'ROLLED_BACK') return { success: true, alreadyRolledBack: true, auditKey: Number(auditKey) };
    if (!['SUCCESS', 'SUCCESS_WITH_WARNINGS'].includes(String(header.AuditStatus || ''))) throw new Error('완료된 업로드만 전체 되돌리기 할 수 있습니다.');
    if (Number(header.VerificationMismatchCount || 0) > 0) throw new Error('적용 당시 불일치가 남은 업로드는 자동 되돌리기 할 수 없습니다.');

    const snapshotResult = await tQ('SELECT * FROM ShipmentImportSnapshot WITH (UPDLOCK,HOLDLOCK) WHERE AuditKey=@key ORDER BY SnapshotKey', { key: pInt(auditKey) });
    const snapshots = snapshotResult.recordset || [];
    if (!snapshots.length) throw new Error('되돌리기용 전후 상태가 없어 자동 복원할 수 없습니다.');
    for (const snapshot of snapshots) {
      if (!ENTITY_TYPES.has(snapshot.EntityType)) throw new Error(`알 수 없는 복원 원장입니다: ${snapshot.EntityType}`);
    }

    const conflicts = [];
    for (const snapshot of snapshots) {
      const currentJson = await readCurrentEntity(tQ, snapshot);
      if (currentJson !== snapshot.AfterJson) conflicts.push(`${conflictLabel(snapshot)}가 업로드 후 다시 변경되었습니다.`);
    }
    if (conflicts.length) {
      const error = new Error(`업로드 후 다른 수정 ${conflicts.length}건이 있어 전체 되돌리기를 중단했습니다.\n${conflicts.slice(0, 10).join('\n')}`);
      error.code = 'SHIPMENT_IMPORT_ROLLBACK_CONFLICT';
      error.statusCode = 409;
      error.conflicts = conflicts;
      throw error;
    }

    const byType = (type) => snapshots.filter((row) => row.EntityType === type);
    for (const row of byType('ShipmentDetail')) await restoreShipmentDetail(tQ, row, actor);
    for (const row of byType('ShipmentDate')) await restoreShipmentDates(tQ, row);
    for (const row of byType('ShipmentFarm')) await restoreShipmentFarms(tQ, row);
    for (const row of byType('ShipmentMaster')) await restoreShipmentMaster(tQ, row, actor);
    for (const row of byType('OrderDetail')) await restoreOrderDetail(tQ, row, actor);
    for (const row of byType('OrderMaster')) await restoreOrderMaster(tQ, row, actor);

    await tQ(
      `UPDATE ShipmentImportAudit SET AuditStatus=N'ROLLED_BACK',RollbackStatus=N'ROLLED_BACK',
          RolledBackDtm=GETDATE(),RolledBackBy=@actor,RollbackReason=@reason WHERE AuditKey=@key`,
      { key: pInt(auditKey), actor: pText(actor, 100), reason: pText(reason || '사용자 요청', 500) },
    );
    return { success: true, auditKey: Number(auditKey), restoredSnapshotCount: snapshots.length };
  });
}
