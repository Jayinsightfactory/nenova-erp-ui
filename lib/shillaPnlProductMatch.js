// Saved Shilla P&L row -> Product matching. This is intentionally scoped to one
// WebRaumPnlItem; it never learns a global name mapping or touches ERP ledgers.
import { sql, withTransaction } from './db.js';
import {
  shillaPnlProductMatchSnapshot,
  sameShillaPnlProductMatchSnapshot,
} from './shillaPnlProductMatchState.js';

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
  return {
    partnerCode: 'shilla',
    orderYear,
    major: positiveInteger(raw.major, '차수'),
    pnlKey: positiveInteger(raw.pnlKey, '결산서'),
    itemKey,
    prodKey,
    expected,
  };
}

export const SHILLA_PNL_PRODUCT_MATCH_SQL = {
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
      return { changed: false, pnlKey: request.pnlKey, itemKey: request.itemKey, prodKey: request.prodKey };
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
    return { changed: true, pnlKey: request.pnlKey, itemKey: request.itemKey, prodKey: request.prodKey };
  });
}
