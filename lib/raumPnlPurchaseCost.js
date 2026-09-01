// 라움·초이문 차수별 매입단가 관리.
// WebRaumPnlItem의 선택 차수 CostPrice만 수정하며 ERP/학습 원장은 보존한다.
import { query, sql, withTransaction } from './db.js';
import {
  raumPnlCostIdentity,
  raumPnlCostSnapshot,
  sameRaumPnlCostSnapshot,
} from './raumPnlCostComparison.js';

const MAX_UPDATES = 500;

function scopedError(message, statusCode = 400, code = 'INVALID_REQUEST') {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

export function parseRaumPurchaseCost(value) {
  if (value == null || String(value).trim() === '') return null;
  const number = Number(String(value).replace(/,/g, ''));
  if (!Number.isFinite(number) || number < 0) {
    throw scopedError('매입단가는 0 이상의 숫자만 입력할 수 있습니다.');
  }
  return number;
}

export function normalizeRaumPurchaseCostUpdates(updates) {
  if (!Array.isArray(updates) || updates.length === 0) throw scopedError('저장할 단가 변경이 없습니다.');
  if (updates.length > MAX_UPDATES) throw scopedError(`한 번에 최대 ${MAX_UPDATES}개 단가만 저장할 수 있습니다.`);
  const seen = new Set();
  return updates.map((raw, index) => {
    const pnlKey = Number(raw?.pnlKey);
    const major = Number(raw?.major);
    const identity = String(raw?.identity || '').trim();
    if (!Number.isInteger(pnlKey) || pnlKey <= 0 || !Number.isInteger(major) || major <= 0 || !identity) {
      throw scopedError(`${index + 1}번째 변경의 차수·품목 정보가 올바르지 않습니다.`);
    }
    const unique = `${pnlKey}|${identity}`;
    if (seen.has(unique)) throw scopedError(`${major}차의 같은 품목이 중복 요청되었습니다.`);
    seen.add(unique);
    const expected = raumPnlCostSnapshot(raw?.expected || []);
    if (!expected.length) throw scopedError(`${major}차 품목의 화면 기준값이 없어 저장할 수 없습니다.`);
    return { pnlKey, major, identity, expected, costPrice: parseRaumPurchaseCost(raw?.costPrice) };
  });
}
export async function loadRaumPnlPurchaseCostYears(partnerCode) {
  const result = await query(
    `SELECT DISTINCT m.OrderYear
       FROM WebRaumPnl AS m
      WHERE ISNULL(m.isDeleted, 0)=0 AND m.PartnerCode=@pc
      ORDER BY m.OrderYear DESC`,
    { pc: { type: sql.NVarChar, value: partnerCode } },
  );
  return (result.recordset || []).map(row => String(row.OrderYear || '')).filter(year => /^\d{4}$/.test(year));
}

const LOCKED_MASTER_SQL = `
  SELECT m.PnlKey, m.OrderYear, m.MajorWeek, m.PartnerCode
    FROM WebRaumPnl AS m WITH (UPDLOCK, HOLDLOCK)
   WHERE m.PnlKey=@pnlKey
     AND m.OrderYear=@yr
     AND m.MajorWeek=@major
     AND m.PartnerCode=@pc
     AND ISNULL(m.isDeleted, 0)=0`;

const LOCKED_ITEMS_SQL = `
  SELECT i.ItemKey, i.ItemName AS Name, i.ProdKey, i.Unit, i.CostPrice,
         ISNULL(i.IsCustom, 0) AS IsCustom
    FROM WebRaumPnlItem AS i WITH (UPDLOCK, HOLDLOCK)
   WHERE i.PnlKey=@pnlKey
   ORDER BY i.ItemKey`;

export const RAUM_PNL_PURCHASE_COST_WRITE_SQL = {
  master: LOCKED_MASTER_SQL,
  items: LOCKED_ITEMS_SQL,
  item: `UPDATE WebRaumPnlItem
            SET CostPrice=@cost, CostSource=CASE WHEN @cost IS NULL THEN NULL ELSE N'manual' END
          WHERE PnlKey=@pnlKey AND ItemKey=@itemKey`,
  parent: `UPDATE WebRaumPnl
             SET UpdatedBy=@actor, UpdatedAt=GETDATE()
           WHERE PnlKey=@pnlKey AND OrderYear=@yr AND MajorWeek=@major
             AND PartnerCode=@pc AND ISNULL(isDeleted, 0)=0`,
};

/**
 * 미리보기 snapshot과 잠근 현재행이 같을 때만 선택 차수의 매입단가를 일괄 저장한다.
 * 목록 표시와 저장 재검증은 raumPnlCostIdentity/raumPnlCostSnapshot을 공유한다.
 */
export async function saveRaumPnlPurchaseCosts({ orderYear, partnerCode, updates, actor }) {
  const year = String(orderYear || '').trim();
  if (!/^\d{4}$/.test(year)) throw scopedError('유효한 연도를 선택해 주세요.');
  const normalized = normalizeRaumPurchaseCostUpdates(updates);
  const safeActor = String(actor || 'user').slice(0, 100);

  return withTransaction(async tQuery => {
    const touchedMasters = new Map();
    let changedRows = 0;
    for (const update of normalized) {
      const scopeParams = {
        pnlKey: { type: sql.Int, value: update.pnlKey },
        yr: { type: sql.NVarChar, value: year },
        major: { type: sql.Int, value: update.major },
        pc: { type: sql.NVarChar, value: partnerCode },
      };
      const master = await tQuery(LOCKED_MASTER_SQL, scopeParams);
      if (!master.recordset?.[0]) {
        throw scopedError(`${update.major}차 손익계산서가 바뀌었거나 다른 연도·거래처 자료입니다. 새로고침 후 다시 확인해 주세요.`, 409, 'STALE_SCOPE');
      }
      const locked = await tQuery(LOCKED_ITEMS_SQL, { pnlKey: scopeParams.pnlKey });
      const matching = (locked.recordset || []).filter(row => raumPnlCostIdentity(row) === update.identity);
      if (!matching.length || !sameRaumPnlCostSnapshot(matching, update.expected)) {
        throw scopedError(`${update.major}차 품목 단가가 다른 화면에서 변경되었습니다. 입력값을 보존한 뒤 새로고침해 다시 확인해 주세요.`, 409, 'STALE_COST');
      }
      for (const row of matching) {
        await tQuery(RAUM_PNL_PURCHASE_COST_WRITE_SQL.item, {
          cost: { type: sql.Float, value: update.costPrice },
          pnlKey: scopeParams.pnlKey,
          itemKey: { type: sql.Int, value: Number(row.ItemKey) },
        });
        changedRows += 1;
      }
      touchedMasters.set(update.pnlKey, { ...scopeParams, majorNumber: update.major });
    }
    for (const [pnlKey, scope] of touchedMasters) {
      await tQuery(RAUM_PNL_PURCHASE_COST_WRITE_SQL.parent, {
        pnlKey: { type: sql.Int, value: pnlKey },
        yr: scope.yr,
        major: scope.major,
        pc: scope.pc,
        actor: { type: sql.NVarChar, value: safeActor },
      });
    }
    return { changedCells: normalized.length, changedRows, touchedPnlKeys: [...touchedMasters.keys()] };
  });
}
