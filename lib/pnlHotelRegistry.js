// Web P&L hotel registry.  This module owns no ERP Customer data: it only
// reads/writes dbo.WebPnlHotel after the explicit migration has been applied.
import { createHash } from 'node:crypto';
import { query, sql, withTransaction } from './db.js';
import { PNL_PARTNERS, customPnlHotelDescriptor, resolvePnlPartner } from './raumPnlPartner.js';

const RESERVED_NORMALIZED_NAMES = new Set(['신라', '신라호텔', '라움', '트라움', '초이문']);
const HOTEL_CODE_RE = /^hotel_[0-9a-f]{12}$/;

export class PnlHotelRegistryError extends Error {
  constructor(code, message, statusCode = 400) {
    super(message);
    this.name = 'PnlHotelRegistryError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

export function normalizePnlHotelName(value) {
  const raw = String(value == null ? '' : value);
  if (/[\u0000-\u001f\u007f-\u009f]/.test(raw)) {
    throw new PnlHotelRegistryError('PNL_HOTEL_NAME_INVALID', '호텔 이름에는 제어 문자를 사용할 수 없습니다.');
  }
  const normalized = raw.normalize('NFKC').replace(/[\s\u00a0]+/g, ' ').trim();
  if (!normalized) throw new PnlHotelRegistryError('PNL_HOTEL_NAME_REQUIRED', '호텔 이름을 입력하세요.');
  if (normalized.length > 80) throw new PnlHotelRegistryError('PNL_HOTEL_NAME_TOO_LONG', '호텔 이름은 80자 이하여야 합니다.');
  if (RESERVED_NORMALIZED_NAMES.has(normalized.toLowerCase())) {
    throw new PnlHotelRegistryError('PNL_HOTEL_NAME_RESERVED', '기본 거래처 이름은 호텔로 등록할 수 없습니다.');
  }
  return normalized;
}

export function pnlHotelCodeForName(normalizedName) {
  const name = normalizePnlHotelName(normalizedName);
  return `hotel_${createHash('sha256').update(name, 'utf8').digest('hex').slice(0, 12)}`;
}

function rowDescriptor(row) {
  // dbo.WebPnlHotel stores only registry fields; kind is an in-process
  // descriptor invariant, supplied explicitly at this boundary.
  return customPnlHotelDescriptor({ ...row, kind: 'custom-hotel' });
}

function hotelFromRow(row) {
  const descriptor = rowDescriptor(row);
  if (!descriptor) throw new PnlHotelRegistryError('PNL_HOTEL_ROW_INVALID', '등록 호텔 데이터가 올바르지 않습니다.', 503);
  return {
    code: descriptor.code,
    label: descriptor.label,
    kind: descriptor.kind,
    customHotel: true,
    erpSync: false,
    sheetMode: 'single',
    defaultBranch: descriptor.label,
  };
}

function params(values) {
  return Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { type: sql.NVarChar, value }]));
}

const SCHEMA_PROBE_SQL = `
SELECT CASE WHEN OBJECT_ID(N'dbo.WebPnlHotel', N'U') IS NOT NULL
                  AND COL_LENGTH(N'dbo.WebPnlHotel', N'PartnerCode') IS NOT NULL
                  AND COL_LENGTH(N'dbo.WebPnlHotel', N'Name') IS NOT NULL
                  AND COL_LENGTH(N'dbo.WebPnlHotel', N'NormalizedName') IS NOT NULL
                  AND COL_LENGTH(N'dbo.WebPnlHotel', N'IsActive') IS NOT NULL
                  AND COL_LENGTH(N'dbo.WebPnlHotel', N'CreatedAt') IS NOT NULL
                  AND COL_LENGTH(N'dbo.WebPnlHotel', N'CreatedBy') IS NOT NULL
                  AND EXISTS (
                    SELECT 1 FROM sys.columns AS c
                     WHERE c.object_id=OBJECT_ID(N'dbo.WebPnlHotel', N'U')
                       AND c.name=N'NormalizedName'
                       AND c.collation_name=N'Latin1_General_100_BIN2'
                  )
                  AND EXISTS (
                    SELECT 1 FROM sys.indexes AS i
                    INNER JOIN sys.index_columns AS ic ON ic.object_id=i.object_id AND ic.index_id=i.index_id
                    INNER JOIN sys.columns AS c ON c.object_id=ic.object_id AND c.column_id=ic.column_id
                     WHERE i.object_id=OBJECT_ID(N'dbo.WebPnlHotel', N'U')
                       AND i.name=N'UQ_WebPnlHotel_NormalizedName'
                       AND i.is_unique=1 AND ic.key_ordinal=1 AND c.name=N'NormalizedName'
                       AND NOT EXISTS (
                         SELECT 1 FROM sys.index_columns AS extra
                          WHERE extra.object_id=i.object_id AND extra.index_id=i.index_id AND extra.key_ordinal>1
                       )
                  )
             THEN 1 ELSE 0 END AS Ready`;

export async function assertPnlHotelReadSchema(tQuery = query) {
  const result = await tQuery(SCHEMA_PROBE_SQL, {});
  if (Number(result?.recordset?.[0]?.Ready) !== 1) {
    throw new PnlHotelRegistryError('PNL_HOTEL_SCHEMA_MISSING', '호텔 추가 기능의 설치가 아직 끝나지 않았습니다. 업데이트 후 다시 확인하세요.', 503);
  }
}

const ACTIVE_BY_CODE_SQL = `
SELECT PartnerCode, [Name], NormalizedName, IsActive, CreatedAt, CreatedBy
  FROM dbo.WebPnlHotel
 WHERE PartnerCode=@code AND IsActive=1`;

const ACTIVE_LIST_SQL = `
SELECT PartnerCode, [Name], NormalizedName, IsActive, CreatedAt, CreatedBy
  FROM dbo.WebPnlHotel
 WHERE IsActive=1
 ORDER BY NormalizedName ASC, PartnerCode ASC`;

function builtinHotels() {
  return Object.values(PNL_PARTNERS).map(partner => ({
    code: partner.code,
    label: partner.label,
    kind: 'builtin',
    customHotel: false,
    erpSync: partner.erpSync,
    sheetMode: partner.sheetMode,
    defaultBranch: partner.defaultBranch,
  }));
}

/** Loads one active custom descriptor; built-in codes never touch the database. */
export async function requirePnlPartner(code, tQuery = query) {
  const key = String(code == null || code === '' ? 'raum' : code).trim().toLowerCase();
  if (Object.prototype.hasOwnProperty.call(PNL_PARTNERS, key)) return resolvePnlPartner(key);
  if (!HOTEL_CODE_RE.test(key)) {
    throw new PnlHotelRegistryError('PNL_PARTNER_UNKNOWN', '등록된 호텔을 찾을 수 없습니다.');
  }
  await assertPnlHotelReadSchema(tQuery);
  const result = await tQuery(ACTIVE_BY_CODE_SQL, params({ code: key }));
  const row = result?.recordset?.[0];
  if (!row) throw new PnlHotelRegistryError('PNL_HOTEL_INACTIVE_OR_UNKNOWN', '등록되지 않았거나 비활성인 호텔입니다.');
  const descriptor = rowDescriptor(row);
  if (!descriptor || descriptor.code !== key) {
    throw new PnlHotelRegistryError('PNL_HOTEL_ROW_INVALID', '등록 호텔 데이터가 올바르지 않습니다.', 503);
  }
  return resolvePnlPartner(key, descriptor);
}

/** Returns fresh values: callers cannot mutate the built-in registry. */
export async function listPnlHotels(tQuery = query) {
  await assertPnlHotelReadSchema(tQuery);
  const result = await tQuery(ACTIVE_LIST_SQL, {});
  const custom = (result?.recordset || []).map(hotelFromRow);
  return [...builtinHotels(), ...custom];
}

const FIND_BY_NAME_SQL = `
SELECT PartnerCode, [Name], NormalizedName, IsActive, CreatedAt, CreatedBy
  FROM dbo.WebPnlHotel WITH (UPDLOCK, HOLDLOCK)
 WHERE NormalizedName=@normalizedName`;
const FIND_BY_CODE_SQL = `
SELECT PartnerCode, [Name], NormalizedName, IsActive, CreatedAt, CreatedBy
  FROM dbo.WebPnlHotel WITH (UPDLOCK, HOLDLOCK)
 WHERE PartnerCode=@code`;
const INSERT_HOTEL_SQL = `
INSERT INTO dbo.WebPnlHotel (PartnerCode, [Name], NormalizedName, IsActive, CreatedBy)
VALUES (@code, @name, @normalizedName, 1, @actor)`;

function duplicateKeyError(error) {
  return [2601, 2627].includes(Number(error?.number ?? error?.originalError?.number)) || /duplicate key|unique constraint/i.test(String(error?.message || ''));
}

function existingHotelResult(row, expectedCode, expectedNormalizedName) {
  if (row?.IsActive === false || Number(row?.IsActive) === 0) {
    throw new PnlHotelRegistryError('PNL_HOTEL_NAME_INACTIVE', '같은 이름의 비활성 호텔이 있습니다. 관리자에게 확인하세요.', 409);
  }
  if (String(row?.NormalizedName ?? '') !== expectedNormalizedName) {
    throw new PnlHotelRegistryError('PNL_HOTEL_NAME_IDENTITY_CONFLICT', '호텔 이름 식별값이 일치하지 않습니다. 관리자에게 확인하세요.', 409);
  }
  const hotel = hotelFromRow(row);
  if (hotel.code !== expectedCode) {
    throw new PnlHotelRegistryError('PNL_HOTEL_HASH_COLLISION', '호텔 식별키 충돌이 발생했습니다. 이름을 바꾸어 다시 시도하세요.', 409);
  }
  return { hotel, created: false };
}

async function findByName(normalizedName, tQuery) {
  const result = await tQuery(FIND_BY_NAME_SQL, params({ normalizedName }));
  return result?.recordset?.[0] || null;
}

async function createPnlHotelInTransaction({ name, normalizedName, code, actor }, tQuery) {
  await assertPnlHotelReadSchema(tQuery);
  const sameName = await findByName(normalizedName, tQuery);
  if (sameName) return existingHotelResult(sameName, code, normalizedName);
  const sameCodeResult = await tQuery(FIND_BY_CODE_SQL, params({ code }));
  const sameCode = sameCodeResult?.recordset?.[0];
  if (sameCode) {
    throw new PnlHotelRegistryError('PNL_HOTEL_HASH_COLLISION', '호텔 식별키 충돌이 발생했습니다. 이름을 바꾸어 다시 시도하세요.', 409);
  }
  await tQuery(INSERT_HOTEL_SQL, params({ code, name, normalizedName, actor }));
  return {
    hotel: {
      code, label: name, kind: 'custom-hotel', customHotel: true,
      erpSync: false, sheetMode: 'single', defaultBranch: name,
    },
    created: true,
  };
}

/**
 * Create an active registry entry exactly once.  The normal path uses the DB
 * transaction wrapper; tQuery/runTransaction are injectable for isolated DB
 * mock tests and are never used by request code.
 */
export async function createPnlHotel(name, actor, { tQuery = null, runTransaction = withTransaction } = {}) {
  const normalizedName = normalizePnlHotelName(name);
  const code = pnlHotelCodeForName(normalizedName);
  const input = { name: normalizedName, normalizedName, code, actor: String(actor || 'user').slice(0, 100) };
  const run = tQuery
    ? (fn) => fn(tQuery)
    : (fn) => runTransaction((transactionQuery) => fn(transactionQuery));
  try {
    return await run((transactionQuery) => createPnlHotelInTransaction(input, transactionQuery));
  } catch (error) {
    if (!duplicateKeyError(error)) throw error;
    // A concurrent transaction may have committed our exact normalized name.
    // Re-read by the unique name; a different code is never silently reused.
    const lookup = tQuery || query;
    await assertPnlHotelReadSchema(lookup);
    const row = await findByName(normalizedName, lookup);
    if (row) return existingHotelResult(row, code, normalizedName);
    throw new PnlHotelRegistryError('PNL_HOTEL_CREATE_CONFLICT', '호텔 등록이 동시에 변경되었습니다. 다시 시도하세요.', 409);
  }
}
