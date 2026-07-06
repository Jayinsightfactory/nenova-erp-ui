// 출고분배 품목그룹 — nenova.exe / 주문등록(orders/new) 과 동일: CounName + FlowerName
import { sql } from './db.js';

export const PROD_GROUP_SEP = '::';

export function prodGroupKey(country, flower) {
  return `${String(country || '').trim()}${PROD_GROUP_SEP}${String(flower || '').trim()}`;
}

export function prodGroupLabel(country, flower) {
  return `${String(country || '').trim()}${String(flower || '').trim()}`;
}

export function parseProdGroupKey(raw) {
  const text = String(raw || '').trim();
  if (!text) return null;
  if (text.includes(PROD_GROUP_SEP)) {
    const [country, flower] = text.split(PROD_GROUP_SEP);
    if (country && flower) return { country, flower, label: prodGroupLabel(country, flower) };
  }
  return { countryFlower: text, label: text };
}

/** SQL WHERE + params for Product alias `p` */
export function buildProdGroupWhere(prodGroup, alias = 'p') {
  const parsed = parseProdGroupKey(prodGroup);
  if (!parsed) return { clause: '', params: {} };
  if (parsed.country && parsed.flower) {
    return {
      clause: `AND ${alias}.CounName = @pgCountry AND ${alias}.FlowerName = @pgFlower`,
      params: {
        pgCountry: { type: sql.NVarChar, value: parsed.country },
        pgFlower: { type: sql.NVarChar, value: parsed.flower },
      },
    };
  }
  return {
    clause: `AND ${alias}.CountryFlower = @pg`,
    params: { pg: { type: sql.NVarChar, value: parsed.countryFlower } },
  };
}

export function shipDayConfigKey(prodGroupKeyValue, weekSuffix) {
  return `${prodGroupKeyValue}|${weekSuffix}`;
}

export function parseShipDayConfigKey(key) {
  const text = String(key || '');
  const lastPipe = text.lastIndexOf('|');
  if (lastPipe <= 0) return { prodGroup: text, weekSuffix: '-01' };
  return {
    prodGroup: text.slice(0, lastPipe),
    weekSuffix: text.slice(lastPipe + 1) || '-01',
  };
}

/** Product.CounName + FlowerName 목록 (Country/Flower Sort 순) */
export async function loadShipmentProdGroups(q, { week } = {}) {
  const params = {};
  let weekFilter = '';
  if (week) {
    weekFilter = `
      AND EXISTS (
        SELECT 1 FROM OrderDetail od
        JOIN OrderMaster om ON od.OrderMasterKey = om.OrderMasterKey
        WHERE od.ProdKey = p.ProdKey
          AND om.OrderWeek = @week
          AND ISNULL(om.isDeleted, 0) = 0
          AND ISNULL(od.isDeleted, 0) = 0
      )`;
    params.week = { type: sql.NVarChar, value: week };
  }

  const result = await q(
    `SELECT
       p.CounName AS country,
       p.FlowerName AS flower,
       ISNULL(p.CounName, N'') + ISNULL(p.FlowerName, N'') AS label,
       MIN(c.Sort) AS cSort,
       MIN(f.Sort) AS fSort,
       MIN(f.OrderNo) AS fOrderNo,
       COUNT(DISTINCT p.ProdKey) AS prodCount
     FROM Product p
     LEFT JOIN Country c ON p.CounName = c.CounName AND c.isDeleted = 0
     LEFT JOIN Flower f ON p.FlowerName = f.FlowerName AND f.isDeleted = 0
     WHERE p.isDeleted = 0
       AND ISNULL(p.CounName, N'') <> N''
       AND ISNULL(p.FlowerName, N'') <> N''
       ${weekFilter}
     GROUP BY p.CounName, p.FlowerName
     ORDER BY MIN(ISNULL(c.Sort, 9999)), MIN(ISNULL(f.Sort, 9999)), MIN(ISNULL(f.OrderNo, 9999)), label`,
    params,
  );

  return (result.recordset || []).map(row => ({
    key: prodGroupKey(row.country, row.flower),
    label: row.label,
    country: row.country,
    flower: row.flower,
    prodCount: Number(row.prodCount || 0),
  }));
}

/** 출고요일 설정 조회용 — CounName+FlowerName 라벨, 없으면 CountryFlower 폴백 */
export function resolveShipDayGroupKey(product) {
  const country = String(product?.CounName || '').trim();
  const flower = String(product?.FlowerName || '').trim();
  if (country && flower) return prodGroupKey(country, flower);
  const cf = String(product?.CountryFlower || '').trim();
  return cf;
}
