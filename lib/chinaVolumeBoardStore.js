import { query, withTransaction, sql } from './db.js';
import { assertWebSchemaContract } from './webSchemaContract.js';
import { normalizeChinaText } from './chinaVolumeBoard.js';

export const CHINA_VOLUME_BOARD_SCHEMA = [
  {
    table: 'WebChinaVolumeBoard',
    columns: ['BoardKey', 'OrderYear', 'OrderWeek', 'BoardName', 'PackingRowsJson', 'CellsJson', 'MatchOverridesJson', 'ReviewStateJson', 'isDeleted', 'UpdatedAt'],
  },
  {
    table: 'WebChinaVolumeProductMap',
    columns: ['MapKey', 'NormalizedSourceName', 'SourceItemName', 'ProdKey', 'ProdNameSnapshot', 'isDeleted', 'UpdatedAt'],
  },
];

export function assertChinaVolumeBoardSchema() {
  return assertWebSchemaContract('china-volume-board-v1', CHINA_VOLUME_BOARD_SCHEMA);
}

export function chinaBoardError(code, message, statusCode = 400) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

const text = (value) => String(value ?? '').trim();

export function normalizeChinaBoardYear(value) {
  const year = text(value);
  if (!/^20\d{2}$/.test(year)) throw chinaBoardError('INVALID_ORDER_YEAR', '연도는 2000~2099의 4자리 값이어야 합니다.');
  return year;
}

export function normalizeChinaBoardWeek(value) {
  const matched = text(value).match(/^(\d{1,2})\s*[-.]\s*(\d{1,2})$/);
  if (!matched) throw chinaBoardError('INVALID_ORDER_WEEK', '차수는 35-01 형식이어야 합니다.');
  const major = Number(matched[1]);
  const detail = Number(matched[2]);
  if (!Number.isInteger(major) || major < 1 || major > 53 || !Number.isInteger(detail) || detail < 1 || detail > 99) {
    throw chinaBoardError('INVALID_ORDER_WEEK', '차수 범위가 올바르지 않습니다.');
  }
  return `${String(major).padStart(2, '0')}-${String(detail).padStart(2, '0')}`;
}

function jsonShape(value, kind, fieldName) {
  if (kind === 'array' && !Array.isArray(value)) throw chinaBoardError('INVALID_BOARD_PAYLOAD', `${fieldName}은 배열이어야 합니다.`);
  if (kind === 'object' && (value === null || Array.isArray(value) || typeof value !== 'object')) {
    throw chinaBoardError('INVALID_BOARD_PAYLOAD', `${fieldName}은 객체여야 합니다.`);
  }
  const serialized = JSON.stringify(value);
  if (serialized.length > 16 * 1024 * 1024) throw chinaBoardError('BOARD_PAYLOAD_TOO_LARGE', `${fieldName} 저장 크기가 16MB를 초과합니다.`, 413);
  return serialized;
}

export function normalizeChinaVolumeBoardSave(input = {}) {
  const orderYear = normalizeChinaBoardYear(input.orderYear);
  const orderWeek = normalizeChinaBoardWeek(input.orderWeek);
  const boardKey = input.boardKey === undefined || input.boardKey === null || text(input.boardKey) === '' ? null : Number(input.boardKey);
  if (boardKey !== null && (!Number.isSafeInteger(boardKey) || boardKey <= 0)) throw chinaBoardError('INVALID_BOARD_KEY', '작업본 키가 올바르지 않습니다.');
  const expectedRowVersion = text(input.expectedRowVersion).toUpperCase();
  if (boardKey !== null && !/^[0-9A-F]{16}$/.test(expectedRowVersion)) {
    throw chinaBoardError('BOARD_VERSION_REQUIRED', '작업본이 변경되었는지 확인할 버전값이 필요합니다. 다시 조회하세요.', 409);
  }
  const packingRows = input.packingRows === undefined ? [] : input.packingRows;
  const cells = input.cells === undefined ? {} : input.cells;
  const matchOverrides = input.matchOverrides === undefined ? {} : input.matchOverrides;
  const reviewState = input.reviewState === undefined ? {} : input.reviewState;
  if (Array.isArray(packingRows) && packingRows.length > 50000) throw chinaBoardError('TOO_MANY_PACKING_ROWS', '패킹 원장 행은 작업본당 50,000건까지 저장할 수 있습니다.', 413);
  if (cells && typeof cells === 'object' && !Array.isArray(cells) && Object.keys(cells).length > 100000) throw chinaBoardError('TOO_MANY_BOARD_CELLS', '물량표 셀은 작업본당 100,000개까지 저장할 수 있습니다.', 413);
  return {
    boardKey,
    expectedRowVersion: boardKey === null ? null : expectedRowVersion,
    orderYear,
    orderWeek,
    name: text(input.name).slice(0, 120) || `${orderWeek} 중국물량표`,
    sourceFileName: text(input.sourceFileName).slice(0, 260) || null,
    sourceSheetName: text(input.sourceSheetName).slice(0, 200) || null,
    packingRowsJson: jsonShape(packingRows, 'array', 'packingRows'),
    cellsJson: jsonShape(cells, 'object', 'cells'),
    matchOverridesJson: jsonShape(matchOverrides, 'object', 'matchOverrides'),
    reviewStateJson: jsonShape(reviewState, 'object', 'reviewState'),
  };
}

function parseStoredJson(value, fallback, fieldName) {
  if (value === null || value === undefined || value === '') return fallback;
  try { return JSON.parse(value); }
  catch { throw chinaBoardError('CORRUPT_BOARD_JSON', `저장된 ${fieldName} JSON을 읽을 수 없습니다.`, 500); }
}

export function chinaVolumeBoardFromRow(row) {
  return {
    boardKey: Number(row.BoardKey ?? row.boardKey),
    name: row.BoardName ?? row.name ?? '',
    orderYear: String(row.OrderYear ?? row.orderYear ?? ''),
    orderWeek: String(row.OrderWeek ?? row.orderWeek ?? ''),
    sourceFileName: row.SourceFileName ?? row.sourceFileName ?? '',
    sourceSheetName: row.SourceSheetName ?? row.sourceSheetName ?? '',
    packingRows: parseStoredJson(row.PackingRowsJson ?? row.packingRowsJson, [], 'packingRows'),
    cells: parseStoredJson(row.CellsJson ?? row.cellsJson, {}, 'cells'),
    matchOverrides: parseStoredJson(row.MatchOverridesJson ?? row.matchOverridesJson, {}, 'matchOverrides'),
    reviewState: parseStoredJson(row.ReviewStateJson ?? row.reviewStateJson, {}, 'reviewState'),
    createdBy: row.CreatedBy ?? row.createdBy ?? '',
    createdAt: row.CreatedAt ?? row.createdAt ?? null,
    updatedBy: row.UpdatedBy ?? row.updatedBy ?? '',
    updatedAt: row.UpdatedAt ?? row.updatedAt ?? null,
    rowVersion: row.RowVersionHex ?? row.rowVersion ?? '',
  };
}

const BOARD_SELECT = `SELECT BoardKey,BoardName,OrderYear,OrderWeek,SourceFileName,SourceSheetName,
 PackingRowsJson,CellsJson,MatchOverridesJson,ReviewStateJson,CreatedBy,CreatedAt,UpdatedBy,UpdatedAt,
 CONVERT(VARCHAR(32),RowVersion,2) RowVersionHex
 FROM dbo.WebChinaVolumeBoard`;

export async function loadChinaVolumeBoards(scope = {}, queryFn = query) {
  const hasYear = scope.orderYear !== undefined && text(scope.orderYear) !== '';
  const hasWeek = scope.orderWeek !== undefined && text(scope.orderWeek) !== '';
  if (hasYear !== hasWeek) throw chinaBoardError('INCOMPLETE_BOARD_SCOPE', '연도와 차수를 함께 입력하세요.');
  const boardKey = scope.boardKey === undefined || text(scope.boardKey) === '' ? null : Number(scope.boardKey);
  if (boardKey !== null && (!Number.isSafeInteger(boardKey) || boardKey <= 0)) throw chinaBoardError('INVALID_BOARD_KEY', '작업본 키가 올바르지 않습니다.');
  const params = {};
  let where = 'WHERE ISNULL(isDeleted,0)=0';
  if (boardKey !== null) {
    where += ' AND BoardKey=@boardKey';
    params.boardKey = { type: sql.BigInt, value: boardKey };
  } else if (hasYear) {
    const orderYear = normalizeChinaBoardYear(scope.orderYear);
    const orderWeek = normalizeChinaBoardWeek(scope.orderWeek);
    where += ' AND OrderYear=@orderYear AND OrderWeek=@orderWeek';
    params.orderYear = { type: sql.Char(4), value: orderYear };
    params.orderWeek = { type: sql.NVarChar(10), value: orderWeek };
  }
  const result = await queryFn(`${BOARD_SELECT} ${where} ORDER BY UpdatedAt DESC,BoardKey DESC OFFSET 0 ROWS FETCH NEXT 100 ROWS ONLY`, params);
  return (result.recordset || []).map(chinaVolumeBoardFromRow);
}

function boardParams(input, actor) {
  return {
    boardKey: { type: sql.BigInt, value: input.boardKey },
    expectedRowVersion: { type: sql.VarChar(16), value: input.expectedRowVersion },
    orderYear: { type: sql.Char(4), value: input.orderYear },
    orderWeek: { type: sql.NVarChar(10), value: input.orderWeek },
    name: { type: sql.NVarChar(120), value: input.name },
    sourceFileName: { type: sql.NVarChar(260), value: input.sourceFileName },
    sourceSheetName: { type: sql.NVarChar(200), value: input.sourceSheetName },
    packingRowsJson: { type: sql.NVarChar(sql.MAX), value: input.packingRowsJson },
    cellsJson: { type: sql.NVarChar(sql.MAX), value: input.cellsJson },
    matchOverridesJson: { type: sql.NVarChar(sql.MAX), value: input.matchOverridesJson },
    reviewStateJson: { type: sql.NVarChar(sql.MAX), value: input.reviewStateJson },
    actor: { type: sql.NVarChar(100), value: text(actor).slice(0, 100) || 'user' },
  };
}

export async function saveChinaVolumeBoard(payload, actor, transactionFn = withTransaction) {
  const input = normalizeChinaVolumeBoardSave(payload);
  return transactionFn(async tQuery => {
    const params = boardParams(input, actor);
    let boardKey = input.boardKey;
    if (boardKey !== null) {
      const locked = await tQuery(`SELECT BoardKey,OrderYear,OrderWeek,CONVERT(VARCHAR(16),RowVersion,2) RowVersionHex FROM dbo.WebChinaVolumeBoard WITH(UPDLOCK,HOLDLOCK) WHERE BoardKey=@boardKey AND ISNULL(isDeleted,0)=0`, params);
      const current = locked.recordset?.[0];
      if (!current) throw chinaBoardError('BOARD_NOT_FOUND', '저장할 작업본을 찾을 수 없습니다.', 404);
      if (String(current.OrderYear) !== input.orderYear || String(current.OrderWeek) !== input.orderWeek) {
        throw chinaBoardError('BOARD_SCOPE_CONFLICT', '저장된 작업본의 연도·차수와 요청 범위가 다릅니다. 다시 조회하세요.', 409);
      }
      if (text(current.RowVersionHex).toUpperCase() !== input.expectedRowVersion) {
        throw chinaBoardError('STALE_BOARD_VERSION', '다른 사용자가 이 작업본을 먼저 수정했습니다. 최신 작업본을 다시 불러오세요.', 409);
      }
      const updated = await tQuery(`UPDATE dbo.WebChinaVolumeBoard SET BoardName=@name,SourceFileName=@sourceFileName,SourceSheetName=@sourceSheetName,
 PackingRowsJson=@packingRowsJson,CellsJson=@cellsJson,MatchOverridesJson=@matchOverridesJson,ReviewStateJson=@reviewStateJson,
 UpdatedBy=@actor,UpdatedAt=SYSDATETIME() WHERE BoardKey=@boardKey AND OrderYear=@orderYear AND OrderWeek=@orderWeek
 AND RowVersion=CONVERT(VARBINARY(8),@expectedRowVersion,2) AND ISNULL(isDeleted,0)=0`, params);
      if (Number(updated.rowsAffected?.[0] || 0) !== 1) {
        throw chinaBoardError('STALE_BOARD_VERSION', '다른 사용자가 이 작업본을 먼저 수정했습니다. 최신 작업본을 다시 불러오세요.', 409);
      }
    } else {
      const inserted = await tQuery(`INSERT dbo.WebChinaVolumeBoard(OrderYear,OrderWeek,BoardName,SourceFileName,SourceSheetName,PackingRowsJson,CellsJson,MatchOverridesJson,ReviewStateJson,CreatedBy,UpdatedBy)
 VALUES(@orderYear,@orderWeek,@name,@sourceFileName,@sourceSheetName,@packingRowsJson,@cellsJson,@matchOverridesJson,@reviewStateJson,@actor,@actor);
 SELECT CAST(SCOPE_IDENTITY() AS BIGINT) BoardKey;`, params);
      boardKey = Number(inserted.recordset?.[0]?.BoardKey);
      if (!Number.isSafeInteger(boardKey) || boardKey <= 0) throw chinaBoardError('BOARD_SAVE_FAILED', '작업본 저장 키를 확인할 수 없습니다.', 500);
      params.boardKey.value = boardKey;
    }
    const saved = await tQuery(`${BOARD_SELECT} WHERE BoardKey=@boardKey AND ISNULL(isDeleted,0)=0`, params);
    return chinaVolumeBoardFromRow(saved.recordset?.[0] || { ...input, BoardKey: boardKey });
  });
}

export async function deleteChinaVolumeBoard(target, actor, transactionFn = withTransaction) {
  const boardKey = Number(target?.boardKey);
  if (!Number.isSafeInteger(boardKey) || boardKey <= 0) throw chinaBoardError('INVALID_BOARD_KEY', '삭제할 작업본 키가 올바르지 않습니다.');
  const expectedRowVersion = text(target?.expectedRowVersion).toUpperCase();
  if (!/^[0-9A-F]{16}$/.test(expectedRowVersion)) {
    throw chinaBoardError('BOARD_VERSION_REQUIRED', '작업본이 변경되었는지 확인할 버전값이 필요합니다. 다시 조회하세요.', 409);
  }
  return transactionFn(async tQuery => {
    const result = await tQuery(`UPDATE dbo.WebChinaVolumeBoard SET isDeleted=1,UpdatedBy=@actor,UpdatedAt=SYSDATETIME()
 WHERE BoardKey=@boardKey AND RowVersion=CONVERT(VARBINARY(8),@expectedRowVersion,2) AND ISNULL(isDeleted,0)=0`, {
      boardKey: { type: sql.BigInt, value: boardKey },
      expectedRowVersion: { type: sql.VarChar(16), value: expectedRowVersion },
      actor: { type: sql.NVarChar(100), value: text(actor).slice(0, 100) || 'user' },
    });
    if (Number(result.rowsAffected?.[0] || 0) !== 1) throw chinaBoardError('STALE_BOARD_VERSION', '작업본이 이미 변경되었거나 삭제되었습니다. 최신 목록을 다시 불러오세요.', 409);
    return { boardKey, deleted: true };
  });
}

export function productMappingFromRow(row) {
  return {
    mapKey: Number(row.MapKey ?? row.mapKey),
    normalizedSourceName: row.NormalizedSourceName ?? row.normalizedSourceName ?? '',
    sourceItemName: row.SourceItemName ?? row.sourceItemName ?? '',
    prodKey: Number(row.ProdKey ?? row.prodKey),
    prodName: row.ProdNameSnapshot ?? row.prodName ?? '',
    updatedBy: row.UpdatedBy ?? row.updatedBy ?? '',
    updatedAt: row.UpdatedAt ?? row.updatedAt ?? null,
  };
}

export async function loadChinaVolumeProductMappings(queryFn = query) {
  const result = await queryFn(`SELECT MapKey,NormalizedSourceName,SourceItemName,ProdKey,ProdNameSnapshot,UpdatedBy,UpdatedAt
 FROM dbo.WebChinaVolumeProductMap WHERE ISNULL(isDeleted,0)=0 ORDER BY SourceItemName,MapKey`, {});
  return (result.recordset || []).map(productMappingFromRow);
}

export async function saveChinaVolumeProductMapping(payload = {}, actor, queryFn = query, transactionFn = withTransaction) {
  const sourceItemName = text(payload.sourceItemName).slice(0, 300);
  const normalizedSourceName = normalizeChinaText(sourceItemName).slice(0, 220);
  const prodKey = Number(payload.prodKey);
  if (!sourceItemName || !normalizedSourceName) throw chinaBoardError('INVALID_SOURCE_ITEM', '매칭할 패킹리스트 품목명이 필요합니다.');
  if (!Number.isSafeInteger(prodKey) || prodKey <= 0) throw chinaBoardError('INVALID_PRODUCT_KEY', '매칭할 전산 품목 키가 올바르지 않습니다.');
  const productResult = await queryFn(`SELECT TOP 1 ProdKey,COALESCE(NULLIF(LTRIM(RTRIM(DisplayName)),N''),NULLIF(LTRIM(RTRIM(ProdName)),N'')) ProdName
 FROM Product WHERE ProdKey=@prodKey AND ISNULL(isDeleted,0)=0`, { prodKey: { type: sql.Int, value: prodKey } });
  const product = productResult.recordset?.[0];
  if (!product?.ProdKey || !text(product.ProdName)) throw chinaBoardError('PRODUCT_NOT_FOUND', '활성 전산 품목을 찾을 수 없습니다.', 404);
  const params = {
    normalized: { type: sql.NVarChar(220), value: normalizedSourceName },
    source: { type: sql.NVarChar(300), value: sourceItemName },
    prodKey: { type: sql.Int, value: prodKey },
    prodName: { type: sql.NVarChar(300), value: text(product.ProdName).slice(0, 300) },
    actor: { type: sql.NVarChar(100), value: text(actor).slice(0, 100) || 'user' },
  };
  return transactionFn(async tQuery => {
    const existing = await tQuery(`SELECT TOP 1 MapKey FROM dbo.WebChinaVolumeProductMap WITH(UPDLOCK,HOLDLOCK)
 WHERE NormalizedSourceName=@normalized AND ISNULL(isDeleted,0)=0`, params);
    let mapKey = Number(existing.recordset?.[0]?.MapKey || 0);
    if (mapKey) {
      params.mapKey = { type: sql.BigInt, value: mapKey };
      await tQuery(`UPDATE dbo.WebChinaVolumeProductMap SET SourceItemName=@source,ProdKey=@prodKey,ProdNameSnapshot=@prodName,
 UpdatedBy=@actor,UpdatedAt=SYSDATETIME() WHERE MapKey=@mapKey AND ISNULL(isDeleted,0)=0`, params);
    } else {
      const inserted = await tQuery(`INSERT dbo.WebChinaVolumeProductMap(NormalizedSourceName,SourceItemName,ProdKey,ProdNameSnapshot,CreatedBy,UpdatedBy)
 VALUES(@normalized,@source,@prodKey,@prodName,@actor,@actor); SELECT CAST(SCOPE_IDENTITY() AS BIGINT) MapKey;`, params);
      mapKey = Number(inserted.recordset?.[0]?.MapKey || 0);
    }
    const saved = await tQuery(`SELECT MapKey,NormalizedSourceName,SourceItemName,ProdKey,ProdNameSnapshot,UpdatedBy,UpdatedAt
 FROM dbo.WebChinaVolumeProductMap WHERE MapKey=@mapKey AND ISNULL(isDeleted,0)=0`, {
      ...params, mapKey: { type: sql.BigInt, value: mapKey },
    });
    return productMappingFromRow(saved.recordset?.[0] || { MapKey: mapKey, NormalizedSourceName: normalizedSourceName, SourceItemName: sourceItemName, ProdKey: prodKey, ProdNameSnapshot: product.ProdName });
  });
}

export async function deleteChinaVolumeProductMapping(mapKeyValue, actor, transactionFn = withTransaction) {
  const mapKey = Number(mapKeyValue);
  if (!Number.isSafeInteger(mapKey) || mapKey <= 0) throw chinaBoardError('INVALID_MAPPING_KEY', '삭제할 품목 매핑 키가 올바르지 않습니다.');
  return transactionFn(async tQuery => {
    const result = await tQuery(`UPDATE dbo.WebChinaVolumeProductMap SET isDeleted=1,UpdatedBy=@actor,UpdatedAt=SYSDATETIME()
 WHERE MapKey=@mapKey AND ISNULL(isDeleted,0)=0`, {
      mapKey: { type: sql.BigInt, value: mapKey },
      actor: { type: sql.NVarChar(100), value: text(actor).slice(0, 100) || 'user' },
    });
    if (Number(result.rowsAffected?.[0] || 0) !== 1) throw chinaBoardError('MAPPING_NOT_FOUND', '삭제할 품목 매핑을 찾을 수 없습니다.', 404);
    return { mapKey, deleted: true };
  });
}
