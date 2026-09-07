// Saved Shilla P&L row -> Product matching. This is intentionally scoped to one
// WebRaumPnlItem; it never learns a global name mapping or touches ERP ledgers.
import { sql, withTransaction } from './db.js';
import {
  shillaPnlProductMatchSnapshot,
  sameShillaPnlProductMatchSnapshot,
} from './shillaPnlProductMatchState.js';
import { shillaHotelMatchKey } from './shillaPnlHotelMatch.js';

export { shillaPnlProductMatchSnapshot, sameShillaPnlProductMatchSnapshot };

function scopedError(message, statusCode = 400, code = 'INVALID_REQUEST') {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function positiveInteger(value, field) {
  if (!((typeof value === 'number' && Number.isFinite(value)) ||
        (typeof value === 'string' && /^\d+$/.test(value.trim())))) {
    throw scopedError(`${field}은(는) 양의 정수여야 합니다.`);
  }
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    throw scopedError(`${field}은(는) 양의 정수여야 합니다.`);
  }
  return number;
}

/** Validate every client field before opening a transaction; no implicit partner/year defaults. */
export function normalizeShillaPnlProductMatchRequest(raw = {}) {
  if (raw?.partnerCode !== 'shilla') {
    throw scopedError('신라호텔 결산 행만 연결할 수 있습니다.');
  }
  const orderYear = String(raw.orderYear ?? '').trim();
  if (!/^\d{4}$/.test(orderYear)) throw scopedError('결산 연도는 네 자리로 지정해야 합니다.');

  let prodKey = raw.prodKey;
  if (prodKey !== null) prodKey = positiveInteger(prodKey, '전산 품목번호');
  if (!Object.prototype.hasOwnProperty.call(raw, 'prodKey')) {
    throw scopedError('연결할 전산 품목을 지정해야 합니다.');
  }
  if (!raw.expected || typeof raw.expected !== 'object') {
    throw scopedError('품목 연결 기준이 필요합니다.');
  }
  let expected;
  try {
    expected = shillaPnlProductMatchSnapshot(raw.expected);
  } catch (error) {
    throw scopedError(`품목 연결 기준이 올바르지 않습니다: ${error.message}`);
  }
  const itemKey = positiveInteger(raw.itemKey, '결산 품목');
  if (expected.itemKey !== itemKey) throw scopedError('결산 품목과 품목 연결 기준이 일치하지 않습니다.');
  let applySameHotel = false;
  if (Object.prototype.hasOwnProperty.call(raw, 'applySameHotel')) {
    if (raw.applySameHotel !== true && raw.applySameHotel !== false) {
      throw scopedError('같은 호텔 자동 연결 여부는 true 또는 false여야 합니다.');
    }
    applySameHotel = raw.applySameHotel;
  }
  return {
    partnerCode: 'shilla',
    orderYear,
    major: positiveInteger(raw.major, '차수'),
    pnlKey: positiveInteger(raw.pnlKey, '결산서'),
    itemKey,
    prodKey,
    expected,
    applySameHotel,
  };
}

export const SHILLA_PNL_PRODUCT_MATCH_SQL = {
  yearLock: `DECLARE @result int;
             EXEC @result = sys.sp_getapplock @Resource=@resource, @LockMode='Exclusive', @LockOwner='Transaction', @LockTimeout=10000;
             SELECT @result AS LockResult`,
  master: `SELECT m.PnlKey, m.OrderYear, m.MajorWeek, m.PartnerCode
             FROM WebRaumPnl AS m WITH (UPDLOCK, HOLDLOCK)
            WHERE m.PnlKey=@pnlKey
              AND m.OrderYear=@yr
              AND m.MajorWeek=@major
              AND m.PartnerCode='shilla'
              AND ISNULL(m.isDeleted, 0)=0`,
  item: `SELECT i.ItemKey, i.ItemName, i.Unit, i.Qty, i.SalePrice, i.SaleAmount,
                i.ProdKey, ISNULL(i.IsCustom, 0) AS IsCustom
           FROM WebRaumPnlItem AS i WITH (UPDLOCK, HOLDLOCK)
          WHERE i.PnlKey=@pnlKey AND i.ItemKey=@itemKey`,
  groupMasters: `SELECT m.PnlKey, m.OrderYear, m.MajorWeek, m.PartnerCode
                   FROM WebRaumPnl AS m WITH (UPDLOCK, HOLDLOCK)
                  WHERE m.OrderYear=@yr AND m.PartnerCode='shilla' AND ISNULL(m.isDeleted, 0)=0
                  ORDER BY m.PnlKey`,
  groupItems: `SELECT m.PnlKey, m.MajorWeek, i.ItemKey, i.ItemName, i.Unit, i.Qty, i.SalePrice, i.SaleAmount,
                      i.ProdKey, ISNULL(i.IsCustom, 0) AS IsCustom
                 FROM WebRaumPnlItem AS i WITH (UPDLOCK, HOLDLOCK)
                 INNER JOIN WebRaumPnl AS m ON m.PnlKey=i.PnlKey
                WHERE m.OrderYear=@yr AND m.PartnerCode='shilla' AND ISNULL(m.isDeleted, 0)=0
                ORDER BY m.PnlKey, i.ItemKey`,
  product: `SELECT p.ProdKey
              FROM Product AS p WITH (HOLDLOCK)
             WHERE p.ProdKey=@prodKey AND p.isDeleted=0`,
  itemWrite: `UPDATE WebRaumPnlItem
                SET ProdKey=@prodKey
              WHERE PnlKey=@pnlKey AND ItemKey=@itemKey`,
  parentWrite: `UPDATE WebRaumPnl
                  SET UpdatedBy=@actor, UpdatedAt=GETDATE()
                WHERE PnlKey=@pnlKey
                  AND OrderYear=@yr
                  AND MajorWeek=@major
                  AND PartnerCode='shilla'
                  AND ISNULL(isDeleted, 0)=0`,
};

async function acquireShillaYearLock(tQuery, orderYear) {
  const result = await tQuery(SHILLA_PNL_PRODUCT_MATCH_SQL.yearLock, {
    resource: { type: sql.NVarChar, value: `shilla-pnl-year:${orderYear}` },
  });
  if (Number(result.recordset?.[0]?.LockResult) < 0) {
    throw scopedError('같은 신라호텔 결산 연도가 다른 작업에서 사용 중입니다. 잠시 후 다시 시도하세요.', 409, 'SHILLA_YEAR_LOCK_UNAVAILABLE');
  }
}

function resultForSingleRow(changed, request) {
  return {
    changed,
    pnlKey: request.pnlKey,
    itemKey: request.itemKey,
    prodKey: request.prodKey,
    changedItemCount: changed ? 1 : 0,
    affectedMajors: changed ? [request.major] : [],
    autoMatchedCount: 0,
  };
}

function itemProdKey(item) {
  return item?.ProdKey == null ? null : Number(item.ProdKey);
}

async function saveSameHotelShillaPnlProductMatch(tQuery, request, scope, safeActor) {
  // Keep the group path's ordering identical to import: year lock -> masters ->
  // all candidate rows -> requested active Product -> writes.
  const masters = (await tQuery(SHILLA_PNL_PRODUCT_MATCH_SQL.groupMasters, scope)).recordset || [];
  const sourceMaster = masters.find(master => Number(master.PnlKey) === request.pnlKey && Number(master.MajorWeek) === request.major);
  if (!sourceMaster) throw scopedError('결산 차수나 거래처 범위가 변경되었습니다. 새로고침 후 다시 시도하세요.', 409, 'STALE_SCOPE');
  const items = (await tQuery(SHILLA_PNL_PRODUCT_MATCH_SQL.groupItems, scope)).recordset || [];
  const source = items.find(item => Number(item.PnlKey) === request.pnlKey && Number(item.ItemKey) === request.itemKey);
  if (!source) throw scopedError('결산 품목이 변경되었습니다. 새로고침 후 다시 시도하세요.', 409, 'STALE_ITEM');
  if (!sameShillaPnlProductMatchSnapshot(source, request.expected)) {
    throw scopedError('결산 품목의 원본 값 또는 연결 상태가 변경되었습니다. 새로고침 후 다시 시도하세요.', 409, 'STALE_ITEM');
  }
  if (shillaPnlProductMatchSnapshot(source).isCustom) {
    throw scopedError('수기 품목은 전산 품목 연결 대상이 아닙니다.', 400, 'CUSTOM_ITEM_NOT_MATCHABLE');
  }
  const groupKey = shillaHotelMatchKey(source);
  if (!groupKey) throw scopedError('품목명과 단위가 있는 일반 품목만 같은 호텔 자동 연결할 수 있습니다.', 400, 'GROUP_NOT_MATCHABLE');
  const group = items.filter(item => shillaHotelMatchKey(item) === groupKey);

  if (request.prodKey !== null) {
    const product = await tQuery(SHILLA_PNL_PRODUCT_MATCH_SQL.product, {
      prodKey: { type: sql.Int, value: request.prodKey },
    });
    if (!product.recordset?.[0]) throw scopedError('사용 가능한 전산 품목을 선택하세요.', 400, 'INVALID_PRODUCT');
  }

  const existingKeys = new Set(group.map(itemProdKey).filter(key => key !== null));
  let targets;
  if (request.prodKey === null) {
    if (existingKeys.size > 1) {
      throw scopedError('같은 호텔 품목 그룹에 서로 다른 전산 품목 연결이 있어 전체 연결 해제를 중단했습니다.', 409, 'GROUP_MAPPING_CONFLICT');
    }
    targets = group.filter(item => itemProdKey(item) !== null);
  } else {
    if ([...existingKeys].some(key => key !== request.prodKey)) {
      throw scopedError('같은 호텔 품목 그룹에 다른 전산 품목 연결이 있어 자동 연결을 중단했습니다.', 409, 'GROUP_MAPPING_CONFLICT');
    }
    targets = group.filter(item => itemProdKey(item) === null);
  }

  const parents = new Map();
  for (const item of targets) {
    await tQuery(SHILLA_PNL_PRODUCT_MATCH_SQL.itemWrite, {
      pnlKey: { type: sql.Int, value: Number(item.PnlKey) },
      itemKey: { type: sql.Int, value: Number(item.ItemKey) },
      prodKey: { type: sql.Int, value: request.prodKey },
    });
    parents.set(Number(item.PnlKey), Number(item.MajorWeek));
  }
  for (const [pnlKey, major] of parents) {
    await tQuery(SHILLA_PNL_PRODUCT_MATCH_SQL.parentWrite, {
      pnlKey: { type: sql.Int, value: pnlKey },
      yr: scope.yr,
      major: { type: sql.Int, value: major },
      actor: { type: sql.NVarChar, value: safeActor },
    });
  }
  const affectedMajors = [...new Set([...parents.values()])].sort((left, right) => left - right);
  return {
    changed: targets.length > 0,
    pnlKey: request.pnlKey,
    itemKey: request.itemKey,
    prodKey: request.prodKey,
    changedItemCount: targets.length,
    affectedMajors,
    autoMatchedCount: request.prodKey === null
      ? 0
      : targets.filter(item => Number(item.PnlKey) !== request.pnlKey || Number(item.ItemKey) !== request.itemKey).length,
  };
}

/** Lock, revalidate and update the one saved source row. A no-op does not write. */
export async function saveShillaPnlProductMatch({ actor, ...raw }) {
  const request = normalizeShillaPnlProductMatchRequest(raw);
  const safeActor = String(actor || 'user').slice(0, 50);
  const scope = {
    pnlKey: { type: sql.Int, value: request.pnlKey },
    yr: { type: sql.NVarChar, value: request.orderYear },
    major: { type: sql.Int, value: request.major },
  };

  return withTransaction(async tQuery => {
    await acquireShillaYearLock(tQuery, request.orderYear);
    if (request.applySameHotel) {
      return saveSameHotelShillaPnlProductMatch(tQuery, request, scope, safeActor);
    }
    const master = await tQuery(SHILLA_PNL_PRODUCT_MATCH_SQL.master, scope);
    if (!master.recordset?.[0]) {
      throw scopedError('결산 차수나 거래처 범위가 변경되었습니다. 새로고침 후 다시 시도하세요.', 409, 'STALE_SCOPE');
    }
    const itemResult = await tQuery(SHILLA_PNL_PRODUCT_MATCH_SQL.item, {
      ...scope,
      itemKey: { type: sql.Int, value: request.itemKey },
    });
    const item = itemResult.recordset?.[0];
    if (!item) {
      throw scopedError('결산 품목이 변경되었습니다. 새로고침 후 다시 시도하세요.', 409, 'STALE_ITEM');
    }
    if (!sameShillaPnlProductMatchSnapshot(item, request.expected)) {
      throw scopedError('결산 품목의 원본 값 또는 연결 상태가 변경되었습니다. 새로고침 후 다시 시도하세요.', 409, 'STALE_ITEM');
    }
    if (shillaPnlProductMatchSnapshot(item).isCustom) {
      throw scopedError('수기 품목은 전산 품목 연결 대상이 아닙니다.', 400, 'CUSTOM_ITEM_NOT_MATCHABLE');
    }
    if (request.prodKey !== null) {
      const product = await tQuery(SHILLA_PNL_PRODUCT_MATCH_SQL.product, {
        prodKey: { type: sql.Int, value: request.prodKey },
      });
      if (!product.recordset?.[0]) throw scopedError('사용 가능한 전산 품목을 선택하세요.', 400, 'INVALID_PRODUCT');
    }
    if (request.expected.prodKey === request.prodKey) {
      return resultForSingleRow(false, request);
    }
    const itemParams = {
      pnlKey: scope.pnlKey,
      itemKey: { type: sql.Int, value: request.itemKey },
      prodKey: { type: sql.Int, value: request.prodKey },
    };
    await tQuery(SHILLA_PNL_PRODUCT_MATCH_SQL.itemWrite, itemParams);
    await tQuery(SHILLA_PNL_PRODUCT_MATCH_SQL.parentWrite, {
      ...scope,
      actor: { type: sql.NVarChar, value: safeActor },
    });
    return resultForSingleRow(true, request);
  });
}
