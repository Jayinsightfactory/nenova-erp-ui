import { query, sql, withTransaction } from './db.js';
import {
  buildShillaBulkMatchGroups,
  countShillaBulkUngroupedRows,
  normalizeShillaBulkGetScope,
  normalizeShillaBulkMatchRequest,
  sameShillaBulkExpectedMembers,
} from './shillaPnlBulkMatchState.js';

function error(message, statusCode = 400, code = 'INVALID_REQUEST') {
  const result = new Error(message);
  result.statusCode = statusCode;
  result.code = code;
  return result;
}

export const SHILLA_PNL_BULK_MATCH_SQL = {
  getRows: `SELECT m.PnlKey, m.MajorWeek, i.ItemKey, i.ItemName, i.Unit, i.Qty, i.SalePrice, i.SaleAmount,
                   i.ProdKey, ISNULL(i.IsCustom, 0) AS IsCustom,
                   p.ProdKey AS ActiveProdKey, p.ProdName, p.DisplayName, p.FlowerName, p.CounName, p.OutUnit
              FROM WebRaumPnl AS m
              INNER JOIN WebRaumPnlItem AS i ON i.PnlKey=m.PnlKey
              LEFT JOIN Product AS p ON p.ProdKey=i.ProdKey AND p.isDeleted=0
             WHERE m.OrderYear=@yr AND m.PartnerCode='shilla' AND ISNULL(m.isDeleted, 0)=0
             ORDER BY m.PnlKey, i.ItemKey`,
  yearLock: `DECLARE @result int;
             EXEC @result = sys.sp_getapplock @Resource=@resource, @LockMode='Exclusive', @LockOwner='Transaction', @LockTimeout=10000;
             SELECT @result AS LockResult`,
  masters: `SELECT m.PnlKey, m.MajorWeek
              FROM WebRaumPnl AS m WITH (UPDLOCK, HOLDLOCK)
             WHERE m.OrderYear=@yr AND m.PartnerCode='shilla' AND ISNULL(m.isDeleted, 0)=0
             ORDER BY m.PnlKey`,
  items: `SELECT m.PnlKey, m.MajorWeek, i.ItemKey, i.ItemName, i.Unit, i.Qty, i.SalePrice, i.SaleAmount,
                 i.ProdKey, ISNULL(i.IsCustom, 0) AS IsCustom
            FROM WebRaumPnlItem AS i WITH (UPDLOCK, HOLDLOCK)
            INNER JOIN WebRaumPnl AS m ON m.PnlKey=i.PnlKey
           WHERE m.OrderYear=@yr AND m.PartnerCode='shilla' AND ISNULL(m.isDeleted, 0)=0
           ORDER BY m.PnlKey, i.ItemKey`,
  product: `SELECT p.ProdKey, p.ProdName, p.DisplayName, p.FlowerName, p.CounName, p.OutUnit
              FROM Product AS p WITH (HOLDLOCK)
             WHERE p.ProdKey=@prodKey AND p.isDeleted=0`,
  itemWrite: `UPDATE WebRaumPnlItem
                SET ProdKey=@prodKey
              WHERE PnlKey=@pnlKey AND ItemKey=@itemKey AND ProdKey IS NULL`,
  parentWrite: `UPDATE WebRaumPnl
                  SET UpdatedBy=@actor, UpdatedAt=GETDATE()
                WHERE PnlKey=@pnlKey AND OrderYear=@yr AND MajorWeek=@major
                  AND PartnerCode='shilla' AND ISNULL(isDeleted, 0)=0`,
};

function activeProductsFromRows(rows) {
  return (rows || []).filter(row => row.ActiveProdKey != null).map(row => ({
    prodKey: row.ActiveProdKey, prodName: row.ProdName, displayName: row.DisplayName,
    flowerName: row.FlowerName, counName: row.CounName, outUnit: row.OutUnit,
  }));
}

function affectedOne(result, target) {
  const count = result?.rowsAffected?.[0];
  if (count !== 1) throw error(`${target}의 변경 상태가 달라져 일괄 연결을 취소했습니다.`, 409, 'STALE_WRITE');
}

async function acquireYearLock(tQuery, orderYear) {
  const result = await tQuery(SHILLA_PNL_BULK_MATCH_SQL.yearLock, {
    resource: { type: sql.NVarChar, value: `shilla-pnl-year:${orderYear}` },
  });
  const lockResult = result?.recordset?.[0]?.LockResult;
  if (typeof lockResult !== 'number' || !Number.isInteger(lockResult) || lockResult < 0) {
    throw error('같은 신라호텔 결산 연도가 다른 작업에서 사용 중입니다. 잠시 후 다시 시도하세요.', 409, 'SHILLA_YEAR_LOCK_UNAVAILABLE');
  }
}

export async function loadShillaBulkMatchGroups(rawScope) {
  const scope = normalizeShillaBulkGetScope(rawScope);
  const rows = (await query(SHILLA_PNL_BULK_MATCH_SQL.getRows, {
    yr: { type: sql.NVarChar, value: scope.orderYear },
  })).recordset || [];
  const ungroupedCount = countShillaBulkUngroupedRows(rows);
  return {
    version: 'shilla-bulk-unmatched-v1',
    scope,
    groups: buildShillaBulkMatchGroups(rows, activeProductsFromRows(rows)),
    ungroupedCount,
    notice: ungroupedCount
      ? '품목명 또는 단위가 비어 있는 미연결 행은 안전하게 그룹화할 수 없어 제외했습니다.'
      : null,
  };
}

export async function saveShillaBulkMatch({ actor, ...raw }) {
  const request = normalizeShillaBulkMatchRequest(raw);
  const safeActor = String(actor || 'user').slice(0, 50);
  return withTransaction(async tQuery => {
    await acquireYearLock(tQuery, request.orderYear);
    await tQuery(SHILLA_PNL_BULK_MATCH_SQL.masters, {
      yr: { type: sql.NVarChar, value: request.orderYear },
    });
    const rows = (await tQuery(SHILLA_PNL_BULK_MATCH_SQL.items, {
      yr: { type: sql.NVarChar, value: request.orderYear },
    })).recordset || [];
    const labelsByGroupKey = new Map(buildShillaBulkMatchGroups(rows, []).map(group => [group.groupKey, group]));
    const requestedProductKeys = [...new Set(request.groups.map(group => group.prodKey))].sort((left, right) => left - right);
    const activeProducts = [];
    for (const prodKey of requestedProductKeys) {
      const product = await tQuery(SHILLA_PNL_BULK_MATCH_SQL.product, {
        prodKey: { type: sql.Int, value: prodKey },
      });
      if (!product.recordset?.[0]) {
        const selected = request.groups.find(group => group.prodKey === prodKey);
        const label = labelsByGroupKey.get(selected?.groupKey);
        throw error(label
          ? `${label.label} ${label.unit} 품목 그룹의 선택 전산 품목을 사용할 수 없습니다.`
          : '선택한 품목 그룹의 전산 품목을 사용할 수 없습니다.', 409, 'INVALID_PRODUCT');
      }
      activeProducts.push(product.recordset[0]);
    }

    const liveByKey = new Map(buildShillaBulkMatchGroups(rows, activeProducts).map(group => [group.groupKey, group]));
    const plans = [];
    for (const requested of request.groups) {
      const live = liveByKey.get(requested.groupKey);
      if (!live) throw error('선택한 품목 그룹이 변경되었거나 더 이상 미연결 상태가 아닙니다. 새로고침 후 다시 시도하세요.', 409, 'STALE_GROUP');
      if (!sameShillaBulkExpectedMembers(live.expected.members, requested.expected)) {
        throw error(`${live.label} ${live.unit} 품목 그룹의 행 또는 원본값이 변경되었습니다. 새로고침 후 다시 시도하세요.`, 409, 'STALE_GROUP');
      }
      const mappedKeys = new Set(live.expected.members.filter(member => member.prodKey !== null).map(member => Number(member.prodKey)));
      if ([...mappedKeys].some(prodKey => prodKey !== requested.prodKey)) {
        throw error(`${live.label} ${live.unit} 품목 그룹에는 다른 전산 품목 연결이 있어 일괄 연결할 수 없습니다.`, 409, 'GROUP_MAPPING_CONFLICT');
      }
      const targets = live.expected.members.filter(member => member.prodKey === null);
      if (!targets.length) throw error(`${live.label} ${live.unit} 품목 그룹에 미연결 행이 없습니다.`, 409, 'STALE_GROUP');
      plans.push({ ...requested, live, targets });
    }

    const itemPlans = plans.flatMap(plan => plan.targets.map(member => ({ ...member, prodKey: plan.prodKey, label: plan.live.label, unit: plan.live.unit })))
      .sort((left, right) => left.pnlKey - right.pnlKey || left.itemKey - right.itemKey);
    const parents = new Map();
    for (const item of itemPlans) {
      const written = await tQuery(SHILLA_PNL_BULK_MATCH_SQL.itemWrite, {
        pnlKey: { type: sql.Int, value: item.pnlKey }, itemKey: { type: sql.Int, value: item.itemKey },
        prodKey: { type: sql.Int, value: item.prodKey },
      });
      affectedOne(written, `${item.label} ${item.unit} 품목`);
      parents.set(item.pnlKey, item.major);
    }
    for (const [pnlKey, major] of [...parents.entries()].sort((left, right) => left[0] - right[0])) {
      const written = await tQuery(SHILLA_PNL_BULK_MATCH_SQL.parentWrite, {
        pnlKey: { type: sql.Int, value: pnlKey }, yr: { type: sql.NVarChar, value: request.orderYear },
        major: { type: sql.Int, value: major }, actor: { type: sql.NVarChar, value: safeActor },
      });
      affectedOne(written, '결산서');
    }
    return {
      changedGroupCount: plans.length,
      changedItemCount: itemPlans.length,
      affectedMajors: [...new Set([...parents.values()])].sort((left, right) => left - right),
    };
  });
}
