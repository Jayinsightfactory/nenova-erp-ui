// 엑셀 물량표 업로드 — 불변 원장 스냅샷 (전체 롤백용)
//
// ShipmentImportAudit/ShipmentImportAuditRow(감사 요약·수량)와 별도로, 이 모듈은
// 업로드가 실제로 건드린 OrderMaster/OrderDetail/ShipmentMaster/ShipmentDetail/
// ShipmentDate/ShipmentFarm 행의 "적용 전/후 전체 컬럼" JSON을 남긴다.
// 스냅샷 행은 절대 UPDATE/DELETE 하지 않는다(불변) — 롤백은 새 되돌리기 이력을
// 원본 행/ShipmentHistory/OrderHistory에 추가로 남기고, ShipmentImportAudit 헤더에만
// RollbackStatus 마커를 얹는다.
import { sql } from './db.js';

function stableRow(row) {
  if (row == null) return null;
  const out = {};
  for (const k of Object.keys(row).sort()) out[k] = row[k];
  return out;
}

// 배열(ShipmentDate/ShipmentFarm)은 자식 PK가 롤백 시 재발급될 수 있으므로 PK 값 자체는
// 비교 대상에서 제외하고, 내용 컬럼만 정렬 비교한다.
function stableArray(rows, omitCols = []) {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((r) => {
      const c = stableRow(r);
      omitCols.forEach((col) => delete c[col]);
      return c;
    })
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}

export function canonicalJson(value, { isArray = false, omitCols = [] } = {}) {
  if (isArray) {
    const arr = stableArray(value, omitCols);
    if (!arr.length) return null;
    return JSON.stringify(arr);
  }
  if (value == null) return null;
  return JSON.stringify(stableRow(value));
}

export async function assertShipmentImportSnapshotSchema(queryFn) {
  const result = await queryFn(`
    SELECT CASE WHEN OBJECT_ID(N'dbo.ShipmentImportSnapshot', N'U') IS NOT NULL
                      AND COL_LENGTH('dbo.ShipmentImportAudit','RollbackStatus') IS NOT NULL
                      AND COL_LENGTH('dbo.ShipmentImportAudit','RolledBackDtm') IS NOT NULL
                      AND COL_LENGTH('dbo.ShipmentImportAudit','RolledBackBy') IS NOT NULL
                      AND COL_LENGTH('dbo.ShipmentImportAudit','RollbackReason') IS NOT NULL
                THEN 1 ELSE 0 END AS Ready
  `);
  if (Number(result.recordset?.[0]?.Ready || 0) !== 1) {
    const error = new Error('엑셀 업로드 안전 이력 원장이 아직 설치되지 않았습니다. 관리자에게 설치를 요청하세요.');
    error.code = 'SHIPMENT_IMPORT_SNAPSHOT_SCHEMA_REQUIRED';
    error.statusCode = 503;
    throw error;
  }
}

/** 업체+품목 업무키로 6개 원장의 "현재 전체 컬럼" 상태를 읽는다.
 * 기존 apply 쓰기 로직(lib/shipmentImport.js)과 동일한 WHERE 조건을 재사용해
 * 스키마를 추측하지 않고 SELECT * 로 컬럼 목록에 의존하지 않는다.
 * tQ 로 호출되면 같은 트랜잭션 안의 앞선 UPDLOCK/HOLDLOCK 을 그대로 사용한다(추가 락 불필요).
 */
export async function captureImportRowSnapshot(tQ, { custKey, prodKey, week, orderYear }) {
  const ck = { type: sql.Int, value: Number(custKey) };
  const pk = { type: sql.Int, value: Number(prodKey) };
  const wk = { type: sql.NVarChar, value: week };
  const yr = { type: sql.NVarChar, value: String(orderYear) };

  const om = await tQ(
    `SELECT TOP 1 * FROM OrderMaster WITH (UPDLOCK, HOLDLOCK)
      WHERE CustKey=@ck AND OrderWeek=@wk AND ISNULL(isDeleted,0)=0
        AND ISNULL(CAST(OrderYear AS NVARCHAR(4)), @yr) = @yr
      ORDER BY OrderMasterKey ASC`,
    { ck, wk, yr }
  );
  const orderMasterRow = om.recordset[0] || null;

  let orderDetailRow = null;
  if (orderMasterRow) {
    const od = await tQ(
      `SELECT TOP 1 * FROM OrderDetail WITH (UPDLOCK, HOLDLOCK)
        WHERE OrderMasterKey=@mk AND ProdKey=@pk AND ISNULL(isDeleted,0)=0
        ORDER BY OrderDetailKey DESC`,
      { mk: { type: sql.Int, value: orderMasterRow.OrderMasterKey }, pk }
    );
    orderDetailRow = od.recordset[0] || null;
  }

  const sm = await tQ(
    `SELECT TOP 1 * FROM ShipmentMaster WITH (UPDLOCK, HOLDLOCK)
      WHERE CustKey=@ck AND OrderWeek=@wk AND ISNULL(isDeleted,0)=0
        AND ISNULL(CAST(OrderYear AS NVARCHAR(4)), @yr) = @yr
      ORDER BY ISNULL(isFix,0) DESC, ShipmentKey ASC`,
    { ck, wk, yr }
  );
  const shipmentMasterRow = sm.recordset[0] || null;

  let shipmentDetailRow = null;
  let shipmentDateRows = [];
  let shipmentFarmRows = [];
  if (shipmentMasterRow) {
    const sd = await tQ(
      `SELECT TOP 1 * FROM ShipmentDetail WITH (UPDLOCK, HOLDLOCK) WHERE ShipmentKey=@sk AND ProdKey=@pk`,
      { sk: { type: sql.Int, value: shipmentMasterRow.ShipmentKey }, pk }
    );
    shipmentDetailRow = sd.recordset[0] || null;
    if (shipmentDetailRow) {
      const dates = await tQ(
        `SELECT * FROM ShipmentDate WITH (UPDLOCK, HOLDLOCK) WHERE SdetailKey=@dk ORDER BY SdateKey`,
        { dk: { type: sql.Int, value: shipmentDetailRow.SdetailKey } }
      );
      shipmentDateRows = dates.recordset || [];
      const farms = await tQ(
        `SELECT * FROM ShipmentFarm WITH (UPDLOCK, HOLDLOCK) WHERE SdetailKey=@dk`,
        { dk: { type: sql.Int, value: shipmentDetailRow.SdetailKey } }
      );
      shipmentFarmRows = farms.recordset || [];
    }
  }

  return { orderMasterRow, orderDetailRow, shipmentMasterRow, shipmentDetailRow, shipmentDateRows, shipmentFarmRows };
}

function classify(beforeJson, afterJson) {
  if (beforeJson == null && afterJson == null) return null;
  if (beforeJson === afterJson) return null;
  if (beforeJson == null) return 'CREATED';
  if (afterJson == null) return 'DELETED';
  return 'UPDATED';
}

function buildEntry({ auditKey, custKey, prodKey, entityType, entityKey, beforeJson, afterJson }) {
  const kind = classify(beforeJson, afterJson);
  if (!kind || entityKey == null) return null;
  return {
    auditKey,
    custKey: custKey ?? null,
    prodKey: prodKey ?? null,
    entityType,
    entityKey: Number(entityKey),
    createdByBatch: kind === 'CREATED',
    changeKind: kind,
    beforeJson,
    afterJson,
  };
}

/** before/after 캡처 결과를 비교해 실제로 바뀐 항목만 스냅샷 행 배열로 만든다. */
export function buildRowSnapshotEntries({ auditKey, custKey, prodKey, before, after }) {
  const entries = [];
  entries.push(buildEntry({
    auditKey, custKey, prodKey, entityType: 'OrderMaster',
    entityKey: after.orderMasterRow?.OrderMasterKey ?? before.orderMasterRow?.OrderMasterKey ?? null,
    beforeJson: canonicalJson(before.orderMasterRow),
    afterJson: canonicalJson(after.orderMasterRow),
  }));
  entries.push(buildEntry({
    auditKey, custKey, prodKey, entityType: 'OrderDetail',
    entityKey: after.orderDetailRow?.OrderDetailKey ?? before.orderDetailRow?.OrderDetailKey ?? null,
    beforeJson: canonicalJson(before.orderDetailRow),
    afterJson: canonicalJson(after.orderDetailRow),
  }));
  entries.push(buildEntry({
    auditKey, custKey, prodKey, entityType: 'ShipmentMaster',
    entityKey: after.shipmentMasterRow?.ShipmentKey ?? before.shipmentMasterRow?.ShipmentKey ?? null,
    beforeJson: canonicalJson(before.shipmentMasterRow),
    afterJson: canonicalJson(after.shipmentMasterRow),
  }));
  entries.push(buildEntry({
    auditKey, custKey, prodKey, entityType: 'ShipmentDetail',
    entityKey: after.shipmentDetailRow?.SdetailKey ?? before.shipmentDetailRow?.SdetailKey ?? null,
    beforeJson: canonicalJson(before.shipmentDetailRow),
    afterJson: canonicalJson(after.shipmentDetailRow),
  }));
  // ShipmentDate/ShipmentFarm 은 SdetailKey 로 통째 재생성되므로 자식 행 PK가 아니라
  // 부모 SdetailKey 를 EntityKey 로 사용한다(자식 PK는 롤백 시 새로 발급돼도 무방).
  const dateEntityKey = after.shipmentDetailRow?.SdetailKey ?? before.shipmentDetailRow?.SdetailKey ?? null;
  entries.push(buildEntry({
    auditKey, custKey, prodKey, entityType: 'ShipmentDate',
    entityKey: dateEntityKey,
    beforeJson: canonicalJson(before.shipmentDateRows, { isArray: true, omitCols: ['SdateKey'] }),
    afterJson: canonicalJson(after.shipmentDateRows, { isArray: true, omitCols: ['SdateKey'] }),
  }));
  entries.push(buildEntry({
    auditKey, custKey, prodKey, entityType: 'ShipmentFarm',
    entityKey: dateEntityKey,
    beforeJson: canonicalJson(before.shipmentFarmRows, { isArray: true }),
    afterJson: canonicalJson(after.shipmentFarmRows, { isArray: true }),
  }));
  return entries.filter(Boolean);
}

/** 같은 Master가 여러 품목 처리 중 반복 캡처돼도 최초 before와 최종 after만 남긴다. */
export function mergeSnapshotEntries(entries = []) {
  const merged = new Map();
  for (const entry of entries || []) {
    if (!entry) continue;
    const key = `${entry.entityType}|${Number(entry.entityKey)}`;
    const current = merged.get(key);
    if (!current) {
      merged.set(key, { ...entry });
      continue;
    }
    current.afterJson = entry.afterJson;
    current.changeKind = classify(current.beforeJson, current.afterJson);
    current.createdByBatch = current.beforeJson == null && current.afterJson != null;
    if (current.custKey == null) current.custKey = entry.custKey;
    if (current.prodKey == null) current.prodKey = entry.prodKey;
  }
  return [...merged.values()].filter((entry) => entry.changeKind);
}

export async function insertSnapshotRows(tQ, entries) {
  const list = (entries || []).filter(Boolean);
  if (!list.length) return;
  for (let start = 0; start < list.length; start += 40) {
    const chunk = list.slice(start, start + 40);
    const params = {};
    const values = [];
    chunk.forEach((e, i) => {
      const P = (name, type, value) => {
        params[`r${i}_${name}`] = { type, value };
        return `@r${i}_${name}`;
      };
      values.push(`(${P('audit', sql.Int, e.auditKey)},${P('cust', sql.Int, e.custKey)},${P('prod', sql.Int, e.prodKey)},` +
        `${P('etype', sql.NVarChar(30), e.entityType)},${P('ekey', sql.Int, e.entityKey)},` +
        `${P('created', sql.Bit, e.createdByBatch ? 1 : 0)},${P('kind', sql.NVarChar(20), e.changeKind)},` +
        `${P('before', sql.NVarChar(sql.MAX), e.beforeJson)},${P('after', sql.NVarChar(sql.MAX), e.afterJson)})`);
    });
    await tQ(
      `INSERT INTO dbo.ShipmentImportSnapshot
         (AuditKey,CustKey,ProdKey,EntityType,EntityKey,CreatedByBatch,ChangeKind,BeforeJson,AfterJson)
       VALUES ${values.join(',')}`,
      params
    );
  }
}
