import crypto from 'crypto';
import { sql } from './db.js';
import { requireOrderYear } from './orderUtils.js';

// WebErpEditLease is deliberately a sidecar table.  It never replaces the
// ERP's own short SQL row locks; it only prevents two web edit screens from
// starting conflicting work and lets a web save notice a nenova.exe change.
export const EDIT_LEASE_SECONDS = 90;
export const EDIT_HEARTBEAT_SECONDS = 20;
const LEASE_TABLE = 'WebErpEditLease';

function editError(code, message, statusCode = 409, extra = {}) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  Object.assign(error, extra);
  return error;
}

export function normalizeEditScope(input = {}) {
  const orderYear = String(input.orderYear || input.year || '').trim();
  const weekValue = String(input.orderWeek || input.week || '').trim();
  const custKey = Number(input.custKey);
  let detailWeek;
  try {
    // Internal calls may pass the already-normalized parent scope (`33`).
    // Even then, requireOrderYear must validate the explicit four-digit year.
    ({ orderWeek: detailWeek } = requireOrderYear(/^\d{2}$/.test(weekValue) ? `${weekValue}-01` : weekValue, orderYear));
  } catch (cause) {
    throw editError('ERP_EDIT_SCOPE_INVALID', '편집 보호에는 선택 연도와 차수(예: 33-02)가 필요합니다.', 400, { cause });
  }
  if (!Number.isInteger(custKey) || custKey <= 0) {
    throw editError('ERP_EDIT_SCOPE_INVALID', '편집 보호에는 선택 업체가 필요합니다.', 400);
  }
  // Editing an estimate/customer spans every sub-week of its parent week.
  // 32-01 and 32-02 must therefore use one shared lease key: `32`.
  const orderWeek = String(detailWeek).split('-')[0];
  return { orderYear, orderWeek, custKey };
}

export function normalizeEditClient(input = {}) {
  const clientId = String(input.clientId || '').trim();
  const pageCode = String(input.pageCode || '').trim();
  if (!clientId || clientId.length > 128) {
    throw editError('ERP_EDIT_CLIENT_INVALID', '이 브라우저의 작업 식별값이 올바르지 않습니다. 화면을 새로고침한 뒤 다시 시도하세요.', 400);
  }
  if (!pageCode || pageCode.length > 80) {
    throw editError('ERP_EDIT_CLIENT_INVALID', '작업 화면 정보가 올바르지 않습니다.', 400);
  }
  return { clientId, pageCode };
}

function isMissingLeaseTable(error) {
  return Number(error?.number || error?.originalError?.number || 0) === 208
    || /Invalid object name ['\"]?(?:dbo\.)?WebErpEditLease/i.test(String(error?.message || ''));
}

export function isEditPresenceUnavailable(error) {
  return error?.code === 'ERP_EDIT_PRESENCE_UNAVAILABLE';
}

function tableUnavailable(error) {
  return editError(
    'ERP_EDIT_PRESENCE_UNAVAILABLE',
    '편집 중복 방지 준비가 아직 적용되지 않았습니다. 관리자에게 WebErpEditLease 마이그레이션 적용을 요청하세요.',
    503,
    { cause: error },
  );
}

function leaseParams(scope) {
  return {
    yr: { type: sql.NVarChar, value: scope.orderYear },
    wk: { type: sql.NVarChar, value: scope.orderWeek },
    ck: { type: sql.Int, value: scope.custKey },
  };
}

function snapshotParams(scope) {
  return {
    ...leaseParams(scope),
    wkLike: { type: sql.NVarChar, value: `${scope.orderWeek}-%` },
  };
}

function toLease(row) {
  if (!row) return null;
  return {
    orderYear: String(row.OrderYear || ''),
    orderWeek: String(row.OrderWeek || ''),
    custKey: Number(row.CustKey),
    leaseToken: String(row.LeaseToken || ''),
    ownerUserId: String(row.OwnerUserId || ''),
    ownerName: String(row.OwnerName || ''),
    clientId: String(row.ClientId || ''),
    pageCode: String(row.PageCode || ''),
    acquiredAt: row.AcquiredAt || null,
    heartbeatAt: row.HeartbeatAt || null,
    expiresAt: row.ExpiresAt || null,
    baselineDigest: String(row.BaselineDigest || ''),
    revision: Number(row.Revision || 0),
  };
}

async function selectLease(executor, scope, { lock = false, activeOnly = true } = {}) {
  const lockHint = lock ? ' WITH (UPDLOCK, HOLDLOCK)' : '';
  const activeClause = activeOnly ? ' AND ExpiresAt > SYSUTCDATETIME()' : '';
  try {
    const result = await executor(
      `SELECT OrderYear, OrderWeek, CustKey, LeaseToken, OwnerUserId, OwnerName,
              ClientId, PageCode, AcquiredAt, HeartbeatAt, ExpiresAt, BaselineDigest, Revision
         FROM ${LEASE_TABLE}${lockHint}
        WHERE OrderYear=@yr AND OrderWeek=@wk AND CustKey=@ck${activeClause}`,
      leaseParams(scope),
    );
    return toLease(result.recordset?.[0]);
  } catch (error) {
    if (isMissingLeaseTable(error)) throw tableUnavailable(error);
    throw error;
  }
}

function publicLease(lease, viewer = null) {
  const ownedBySameUser = Boolean(lease && viewer
    && lease.ownerUserId === String(viewer.userId || ''));
  const ownedByMe = Boolean(lease && viewer
    && ownedBySameUser
    && lease.clientId === String(viewer.clientId || ''));
  if (!lease) return {
    active: false, ownedByMe: false, ownedBySameUser: false, ownerName: '', pageCode: '', expiresAt: null,
  };
  return {
    active: true,
    ownedByMe,
    ownedBySameUser,
    ownerName: lease.ownerName,
    pageCode: lease.pageCode,
    expiresAt: lease.expiresAt,
    ...(ownedByMe ? { token: lease.leaseToken, revision: lease.revision } : {}),
  };
}

function canonicalValue(value) {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'number') return Number.isFinite(value) ? Number(value.toFixed(6)) : null;
  return String(value);
}

function canonicalRows(kind, rows = []) {
  return rows.map((row) => ({
    kind,
    ...Object.fromEntries(Object.entries(row).map(([key, value]) => [key, canonicalValue(value)])),
  }));
}

// Every expression below uses columns already read by the ERP write APIs or
// documented in DB_STRUCTURE.  Do not add runtime schema checks/DDL to this
// read-only digest path.
export async function readErpEditSnapshot(executor, rawScope, { lock = false } = {}) {
  const scope = normalizeEditScope(rawScope);
  const params = snapshotParams(scope);
  const lockHint = lock ? ' WITH (UPDLOCK, HOLDLOCK)' : '';
  const queries = [
    ['Order', `SELECT om.OrderMasterKey, od.OrderDetailKey, od.ProdKey,
                       ISNULL(od.BoxQuantity,0) AS BoxQuantity, ISNULL(od.BunchQuantity,0) AS BunchQuantity,
                       ISNULL(od.SteamQuantity,0) AS SteamQuantity, ISNULL(od.OutQuantity,0) AS OutQuantity,
                       ISNULL(od.isDeleted,0) AS DetailDeleted, ISNULL(om.isDeleted,0) AS MasterDeleted
                  FROM OrderMaster om${lockHint}
                  LEFT JOIN OrderDetail od${lockHint} ON od.OrderMasterKey=om.OrderMasterKey
                 WHERE om.OrderYear=@yr AND om.OrderWeek LIKE @wkLike AND om.CustKey=@ck`],
    ['Shipment', `SELECT sm.ShipmentKey, sd.SdetailKey, sd.ProdKey, ISNULL(sm.isFix,0) AS MasterFix,
                         ISNULL(sd.isFix,0) AS DetailFix, ISNULL(sm.isDeleted,0) AS MasterDeleted,
                         ISNULL(sd.BoxQuantity,0) AS BoxQuantity, ISNULL(sd.BunchQuantity,0) AS BunchQuantity,
                         ISNULL(sd.SteamQuantity,0) AS SteamQuantity, ISNULL(sd.OutQuantity,0) AS OutQuantity,
                         ISNULL(sd.EstQuantity,0) AS EstQuantity, ISNULL(sd.Cost,0) AS Cost,
                         ISNULL(sd.Amount,0) AS Amount, ISNULL(sd.Vat,0) AS Vat, sd.ShipmentDtm
                    FROM ShipmentMaster sm${lockHint}
                    LEFT JOIN ShipmentDetail sd${lockHint} ON sd.ShipmentKey=sm.ShipmentKey
                   WHERE sm.OrderYear=@yr AND sm.OrderWeek LIKE @wkLike AND sm.CustKey=@ck`],
    ['ShipmentDate', `SELECT sm.ShipmentKey, sd.SdetailKey, sdd.SdateKey, sdd.ShipmentDtm,
                             ISNULL(sdd.ShipmentQuantity,0) AS ShipmentQuantity,
                             ISNULL(sdd.EstQuantity,0) AS EstQuantity, ISNULL(sdd.Cost,0) AS Cost,
                             ISNULL(sdd.Amount,0) AS Amount, ISNULL(sdd.Vat,0) AS Vat,
                             ISNULL(sdd.Descr,N'') AS Descr
                        FROM ShipmentMaster sm${lockHint}
                        JOIN ShipmentDetail sd${lockHint} ON sd.ShipmentKey=sm.ShipmentKey
                        JOIN ShipmentDate sdd${lockHint} ON sdd.SdetailKey=sd.SdetailKey
                       WHERE sm.OrderYear=@yr AND sm.OrderWeek LIKE @wkLike AND sm.CustKey=@ck`],
    ['ShipmentFarm', `SELECT sm.ShipmentKey, sd.SdetailKey, sf.FarmKey,
                             ISNULL(sf.ShipmentQuantity,0) AS ShipmentQuantity
                        FROM ShipmentMaster sm${lockHint}
                        JOIN ShipmentDetail sd${lockHint} ON sd.ShipmentKey=sm.ShipmentKey
                        JOIN ShipmentFarm sf${lockHint} ON sf.SdetailKey=sd.SdetailKey
                       WHERE sm.OrderYear=@yr AND sm.OrderWeek LIKE @wkLike AND sm.CustKey=@ck`],
    ['Estimate', `SELECT sm.ShipmentKey, e.EstimateKey, e.ProdKey, ISNULL(e.EstimateType,N'') AS EstimateType,
                         ISNULL(e.Unit,N'') AS Unit, ISNULL(e.Quantity,0) AS Quantity, ISNULL(e.Cost,0) AS Cost,
                         ISNULL(e.Amount,0) AS Amount, ISNULL(e.Vat,0) AS Vat, ISNULL(e.Descr,N'') AS Descr,
                         e.EstimateDtm
                    FROM ShipmentMaster sm${lockHint}
                    JOIN Estimate e${lockHint} ON e.ShipmentKey=sm.ShipmentKey
                   WHERE sm.OrderYear=@yr AND sm.OrderWeek LIKE @wkLike AND sm.CustKey=@ck`],
  ];
  const rows = [];
  const fixStatusRows = [];
  // A transaction-bound mssql request must not be used concurrently.
  for (const [kind, statement] of queries) {
    const result = await executor(statement, params);
    if (kind === 'Shipment') {
      for (const rawRow of result.recordset || []) {
        const { MasterFix, DetailFix, ...contentRow } = rawRow;
        rows.push(...canonicalRows(kind, [contentRow]));
        if (Number(rawRow.OutQuantity || 0) > 0) {
          fixStatusRows.push(...canonicalRows('ShipmentFix', [{
            ShipmentKey: rawRow.ShipmentKey,
            SdetailKey: rawRow.SdetailKey,
            MasterFix,
            DetailFix,
          }]));
        }
      }
    } else {
      rows.push(...canonicalRows(kind, result.recordset || []));
    }
  }
  rows.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  fixStatusRows.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  const digest = crypto.createHash('sha256').update(JSON.stringify({ scope, rows })).digest('hex');
  const fixStatusDigest = crypto.createHash('sha256').update(JSON.stringify({ scope, rows: fixStatusRows })).digest('hex');
  return { scope, digest, rowCount: rows.length, fixStatusDigest, fixStatusRowCount: fixStatusRows.length };
}

export async function getErpEditStatus(executor, rawScope, viewer = null) {
  const scope = normalizeEditScope(rawScope);
  const [lease, snapshot] = await Promise.all([
    selectLease(executor, scope),
    readErpEditSnapshot(executor, scope),
  ]);
  return {
    scope,
    lease,
    stale: Boolean(lease?.baselineDigest && lease.baselineDigest !== snapshot.digest),
    snapshot,
  };
}

export async function acquireErpEditLease(tQ, rawScope, user = {}, rawClient = {}) {
  const scope = normalizeEditScope(rawScope);
  const client = normalizeEditClient(rawClient);
  const ownerUserId = String(user.userId || '').trim();
  const ownerName = String(user.userName || ownerUserId).trim();
  const takeover = rawClient.takeover === true;
  if (!ownerUserId) throw editError('ERP_EDIT_OWNER_INVALID', '로그인한 사용자 정보가 없어 편집을 시작할 수 없습니다.', 401);

  const existing = await selectLease(tQ, scope, { lock: true, activeOnly: false });
  const existingActive = existing && new Date(existing.expiresAt).getTime() > Date.now();
  if (existingActive && (existing.ownerUserId !== ownerUserId || (existing.clientId !== client.clientId && !takeover))) {
    throw editError('ERP_EDIT_LOCKED', `${existing.ownerName || existing.ownerUserId}님이 이 업체를 작업 중입니다.`, 409, {
      lease: publicLease(existing, { userId: ownerUserId, clientId: client.clientId }),
    });
  }
  // This is intentionally lock-bound.  A re-acquire never silently changes a
  // baseline: that would hide an intervening nenova.exe edit from the owner.
  const snapshot = await readErpEditSnapshot(tQ, scope, { lock: true });
  const browserDigest = String(rawClient.expectedDigest || '').trim();
  // 붙여넣기 화면처럼 저장 버튼을 누를 때 작업권을 얻는 화면은 마지막 조회
  // 지문을 함께 보낸다. 그 사이 EXE가 저장했다면 최신값을 조용히 새 기준으로
  // 수용하지 말고 사용자가 다시 조회하도록 중단한다.
  if (!existingActive && browserDigest && browserDigest !== snapshot.digest) {
    throw editError('ERP_EDIT_STALE', '조회 뒤 전산 또는 다른 사용자가 값을 변경했습니다. 새로고침 후 변경 내용을 확인하세요.', 409, {
      expectedDigest: browserDigest,
      actualDigest: snapshot.digest,
      rowCount: snapshot.rowCount,
    });
  }
  if (existingActive && existing.ownerUserId === ownerUserId && existing.clientId === client.clientId
    && existing.baselineDigest && existing.baselineDigest !== snapshot.digest) {
    throw editError('ERP_EDIT_STALE', '조회 뒤 전산 또는 다른 사용자가 값을 변경했습니다. 새로고침 후 변경 내용을 확인하세요.', 409, {
      // The lease token is returned only to the exact same logged-in user and
      // browser client.  Without it a reloaded estimate screen can detect the
      // stale lease but can never perform the user's explicit refresh, so it
      // remains blocked until the lease expires (or forever if an old render
      // keeps heartbeating).  Other users/clients still receive no token.
      lease: publicLease(existing, { userId: ownerUserId, clientId: client.clientId }),
      scope,
      expectedDigest: existing.baselineDigest,
      actualDigest: snapshot.digest,
      rowCount: snapshot.rowCount,
      fixStatusDigest: snapshot.fixStatusDigest,
      fixStatusRowCount: snapshot.fixStatusRowCount,
    });
  }

  // Every explicit acquire receives a fresh token.  A late cleanup request
  // from the previous render/tab can then no longer expire the renewed lease.
  const token = crypto.randomUUID();
  // A takeover is an explicit user action from a different browser client.
  // It must establish the new tab's baseline from the lock-bound snapshot;
  // retaining the previous client's baseline would make the new owner
  // immediately stale again after a successful takeover/refresh cycle.
  const baseline = takeover
    ? snapshot.digest
    : existingActive ? existing.baselineDigest || snapshot.digest : snapshot.digest;
  const revision = existingActive ? existing.revision : 0;
  try {
    if (existing) {
      await tQ(
        `UPDATE ${LEASE_TABLE}
            SET LeaseToken=@token, OwnerUserId=@uid, OwnerName=@name, ClientId=@clientId,
                PageCode=@pageCode, HeartbeatAt=SYSUTCDATETIME(),
                ExpiresAt=DATEADD(second, ${EDIT_LEASE_SECONDS}, SYSUTCDATETIME()),
                BaselineDigest=@baseline, Revision=@revision
          WHERE OrderYear=@yr AND OrderWeek=@wk AND CustKey=@ck`,
        {
          ...leaseParams(scope), token: { type: sql.NVarChar, value: token },
          uid: { type: sql.NVarChar, value: ownerUserId }, name: { type: sql.NVarChar, value: ownerName },
          clientId: { type: sql.NVarChar, value: client.clientId }, pageCode: { type: sql.NVarChar, value: client.pageCode },
          baseline: { type: sql.NVarChar, value: baseline }, revision: { type: sql.Int, value: revision },
        },
      );
    } else {
      await tQ(
        `INSERT INTO ${LEASE_TABLE}
           (OrderYear, OrderWeek, CustKey, LeaseToken, OwnerUserId, OwnerName, ClientId, PageCode, BaselineDigest, Revision, AcquiredAt, HeartbeatAt, ExpiresAt)
         VALUES (@yr, @wk, @ck, @token, @uid, @name, @clientId, @pageCode, @baseline, @revision, SYSUTCDATETIME(), SYSUTCDATETIME(), DATEADD(second, ${EDIT_LEASE_SECONDS}, SYSUTCDATETIME()))`,
        {
          ...leaseParams(scope), token: { type: sql.NVarChar, value: token },
          uid: { type: sql.NVarChar, value: ownerUserId }, name: { type: sql.NVarChar, value: ownerName },
          clientId: { type: sql.NVarChar, value: client.clientId }, pageCode: { type: sql.NVarChar, value: client.pageCode },
          baseline: { type: sql.NVarChar, value: baseline }, revision: { type: sql.Int, value: revision },
        },
      );
    }
  } catch (error) {
    if (isMissingLeaseTable(error)) throw tableUnavailable(error);
    throw error;
  }
  const lease = await selectLease(tQ, scope, { lock: true });
  return { scope, lease, snapshot };
}

export async function heartbeatErpEditLease(tQ, rawScope, user = {}, rawGuard = {}) {
  const scope = normalizeEditScope(rawScope);
  const guard = normalizeEditGuard(rawGuard);
  const lease = await selectLease(tQ, scope, { lock: true });
  assertLeaseOwnership(lease, user, guard);
  await tQ(
    `UPDATE ${LEASE_TABLE}
        SET HeartbeatAt=SYSUTCDATETIME(), ExpiresAt=DATEADD(second, ${EDIT_LEASE_SECONDS}, SYSUTCDATETIME())
      WHERE OrderYear=@yr AND OrderWeek=@wk AND CustKey=@ck AND LeaseToken=@token`,
    { ...leaseParams(scope), token: { type: sql.NVarChar, value: guard.leaseToken } },
  );
  const renewedLease = await selectLease(tQ, scope);
  const snapshot = await readErpEditSnapshot(tQ, scope);
  return {
    scope,
    lease: renewedLease,
    snapshot,
    stale: Boolean(renewedLease?.baselineDigest && renewedLease.baselineDigest !== snapshot.digest),
  };
}

// Refresh is explicit user intent.  Unlike heartbeat it accepts the newest
// authoritative snapshot as the next save baseline after the user has read it.
export async function refreshErpEditLease(tQ, rawScope, user = {}, rawGuard = {}) {
  const scope = normalizeEditScope(rawScope);
  const guard = normalizeEditGuard(rawGuard);
  const lease = await selectLease(tQ, scope, { lock: true });
  assertLeaseOwnership(lease, user, guard);
  const snapshot = await readErpEditSnapshot(tQ, scope, { lock: true });
  await tQ(
    `UPDATE ${LEASE_TABLE}
        SET BaselineDigest=@baseline, Revision=ISNULL(Revision,0)+1,
            HeartbeatAt=SYSUTCDATETIME(), ExpiresAt=DATEADD(second, ${EDIT_LEASE_SECONDS}, SYSUTCDATETIME())
      WHERE OrderYear=@yr AND OrderWeek=@wk AND CustKey=@ck AND LeaseToken=@token`,
    {
      ...leaseParams(scope),
      token: { type: sql.NVarChar, value: guard.leaseToken },
      baseline: { type: sql.NVarChar, value: snapshot.digest },
    },
  );
  return { scope, lease: await selectLease(tQ, scope), snapshot };
}

export async function releaseErpEditLease(tQ, rawScope, user = {}, rawGuard = {}) {
  const scope = normalizeEditScope(rawScope);
  const guard = normalizeEditGuard(rawGuard);
  const lease = await selectLease(tQ, scope, { lock: true });
  assertLeaseOwnership(lease, user, guard);
  await tQ(
    `UPDATE ${LEASE_TABLE}
        SET ExpiresAt=DATEADD(second, -1, SYSUTCDATETIME()), HeartbeatAt=SYSUTCDATETIME()
      WHERE OrderYear=@yr AND OrderWeek=@wk AND CustKey=@ck AND LeaseToken=@token`,
    { ...leaseParams(scope), token: { type: sql.NVarChar, value: guard.leaseToken } },
  );
  return { scope, released: true };
}

export function normalizeEditGuard(input = {}) {
  const source = input?.editGuard || input || {};
  const leaseToken = String(source.leaseToken || source.token || '').trim();
  const clientId = String(source.clientId || '').trim();
  const expectedDigest = String(source.expectedDigest || '').trim();
  if (!leaseToken || !clientId) {
    throw editError('ERP_EDIT_GUARD_INVALID', '편집 보호 정보가 없습니다. 화면을 다시 조회한 뒤 저장하세요.', 409);
  }
  return { leaseToken, clientId, expectedDigest };
}

function assertLeaseOwnership(lease, user = {}, guard = {}) {
  if (!lease) throw editError('ERP_EDIT_LOCKED', '편집 권한이 만료되었거나 다른 작업에서 해제되었습니다. 다시 조회하세요.', 409);
  if (lease.leaseToken !== guard.leaseToken || lease.clientId !== guard.clientId || lease.ownerUserId !== String(user.userId || '')) {
    throw editError('ERP_EDIT_LOCKED', `${lease.ownerName || lease.ownerUserId}님의 편집 보호와 일치하지 않습니다.`, 409, { lease: publicLease(lease) });
  }
}

// Call this *inside* a write transaction after the authoritative scope is
// known from ERP rows.  Legacy callers with no active lease remain supported.
export async function assertErpEditGuard(tQ, rawScope, user = {}, rawInput = {}) {
  const scope = normalizeEditScope(rawScope);
  const supplied = rawInput?.editGuard;
  let guard = null;
  if (supplied) guard = normalizeEditGuard(supplied);

  let active;
  try {
    active = await selectLease(tQ, scope, { lock: true });
  } catch (error) {
    if (isEditPresenceUnavailable(error) && !guard) return { scope, snapshot: null, legacy: true };
    throw error;
  }
  if (active) {
    if (!guard) {
      throw editError('ERP_EDIT_LOCKED', `${active.ownerName || active.ownerUserId}님이 이 업체를 작업 중입니다. 저장하지 않았습니다.`, 409, { lease: publicLease(active) });
    }
    assertLeaseOwnership(active, user, guard);
  } else if (guard) {
    throw editError('ERP_EDIT_LOCKED', '편집 보호가 만료되었습니다. 다시 조회한 뒤 저장하세요.', 409);
  } else {
    return { scope, snapshot: null, legacy: true };
  }

  // The lease baseline, not a browser-cached expectedDigest, is authoritative.
  // A save cycle can make several valid writes before the UI refreshes.
  const snapshot = await readErpEditSnapshot(tQ, scope, { lock: true });
  if (active.baselineDigest && active.baselineDigest !== snapshot.digest) {
    throw editError('ERP_EDIT_STALE', '조회 뒤 전산 또는 다른 사용자가 값을 변경했습니다. 다시 조회한 뒤 변경 내용을 확인하세요.', 409, {
      expectedDigest: active.baselineDigest,
      actualDigest: snapshot.digest,
      rowCount: snapshot.rowCount,
    });
  }
  return { scope, snapshot, lease: publicLease(active, { userId: user.userId, clientId: guard.clientId }) };
}

// Call only after the ERP write has succeeded, inside that same transaction.
// It moves the server authority baseline forward so the next write of one
// unfix -> save -> refix sequence remains valid without weakening EXE checks.
export async function advanceErpEditGuard(tQ, rawScope, user = {}, rawInput = {}) {
  const scope = normalizeEditScope(rawScope);
  const supplied = rawInput?.editGuard;
  if (!supplied) return { scope, snapshot: null, legacy: true };
  const guard = normalizeEditGuard(supplied);
  const lease = await selectLease(tQ, scope, { lock: true });
  assertLeaseOwnership(lease, user, guard);
  const snapshot = await readErpEditSnapshot(tQ, scope, { lock: true });
  await tQ(
    `UPDATE ${LEASE_TABLE}
        SET BaselineDigest=@baseline, Revision=ISNULL(Revision,0)+1,
            HeartbeatAt=SYSUTCDATETIME(), ExpiresAt=DATEADD(second, ${EDIT_LEASE_SECONDS}, SYSUTCDATETIME())
      WHERE OrderYear=@yr AND OrderWeek=@wk AND CustKey=@ck AND LeaseToken=@token`,
    {
      ...leaseParams(scope),
      token: { type: sql.NVarChar, value: guard.leaseToken },
      baseline: { type: sql.NVarChar, value: snapshot.digest },
    },
  );
  const advanced = await selectLease(tQ, scope, { lock: true });
  return {
    scope,
    snapshot,
    lease: publicLease(advanced, { userId: user.userId, clientId: guard.clientId }),
    editDigestAfter: snapshot.digest,
    revision: advanced?.revision || 0,
  };
}

export function editErrorResponse(error) {
  return {
    statusCode: Number(error?.statusCode || (['ERP_EDIT_LOCKED', 'ERP_EDIT_STALE', 'ERP_EDIT_GUARD_INVALID'].includes(error?.code) ? 409 : 500)),
    body: {
      success: false,
      code: error?.code,
      error: error?.message || '편집 보호 처리 중 오류가 발생했습니다.',
      lease: error?.lease || null,
      scope: error?.scope || null,
      expectedDigest: error?.expectedDigest,
      actualDigest: error?.actualDigest,
      rowCount: error?.rowCount,
      fixStatusDigest: error?.fixStatusDigest,
      fixStatusRowCount: error?.fixStatusRowCount,
    },
  };
}

export function editPresencePayload(result = {}, viewer = null) {
  const snapshot = result.snapshot || {};
  const lease = publicLease(result.lease || null, viewer);
  return {
    digest: snapshot.digest || '',
    rowCount: Number(snapshot.rowCount || 0),
    fixStatusDigest: snapshot.fixStatusDigest || '',
    fixStatusRowCount: Number(snapshot.fixStatusRowCount || 0),
    stale: Boolean(result.stale),
    scope: result.scope || null,
    lease,
    ...(result.released ? { released: true } : {}),
  };
}
