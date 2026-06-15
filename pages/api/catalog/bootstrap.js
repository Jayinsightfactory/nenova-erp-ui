// GET — 카탈로그 작성용 마스터 + 도착원가
import { query, sql } from '../../../lib/db';
import { withAuth } from '../../../lib/auth';
import {
  getLatestWarehouseWeek,
  getArrivalCostsWithFallback,
} from '../../../lib/catalogArrival';
import { loadArrivalOverrides, overridesToArrivalMap } from '../../../lib/catalogArrivalOverrides';
import { splitCatalogWeekForApi } from '../../../lib/catalogUtils';
import { resolveCatalogArrivalDisplay, catalogSaleUnit } from '../../../lib/catalogUnitMatch';
import { ensureIntegratedCatalogImages, findIntegratedPptx } from '../../../lib/catalogAutoImport';
import { loadMappings } from '../../../lib/parseMappings';
import {
  findMappingKorNameByProdKey,
  resolveCatalogProductNames,
} from '../../../lib/catalogNameResolve';
import { findCatalogMatchByProdKey } from '../../../lib/catalogNameResolve.js';

export default withAuth(async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const {
    orderYear,
    weekStart,
    weekEnd,
    custKey,
    costMode = 'recent',
  } = req.query;

  const mode = costMode === 'selected' ? 'selected' : 'recent';

  try {
    const year = orderYear || String(new Date().getFullYear());
    let parsed = { orderYear: year, weekStart: '', weekEnd: '' };
    let weekParseError = null;

    if (weekStart) {
      try {
        const start = splitCatalogWeekForApi(weekStart, year);
        const end = weekEnd
          ? splitCatalogWeekForApi(weekEnd, start.orderYear)
          : start;
        parsed = {
          orderYear: start.orderYear,
          weekStart: start.weekStart,
          weekEnd: end.weekStart || start.weekStart,
        };
      } catch (e) {
        weekParseError = e.message;
      }
    }

    const latest = await getLatestWarehouseWeek(year);

    const [productsRes, customersRes, flowersRes] = await Promise.all([
      query(
        `SELECT p.ProdKey, p.ProdCode, p.ProdName, p.DisplayName, p.FlowerName, p.CounName,
                p.CountryFlower, p.Cost, p.OutUnit, p.EstUnit, p.Descr,
                c.Sort AS cSort, f.Sort AS fSort, f.OrderNo AS fOrderNo
         FROM Product p
         LEFT JOIN Country c ON p.CounName = c.CounName AND c.isDeleted = 0
         LEFT JOIN Flower f ON p.FlowerName = f.FlowerName AND f.isDeleted = 0
         WHERE p.isDeleted = 0
         ORDER BY ISNULL(c.Sort, 9999), ISNULL(f.Sort, 9999), ISNULL(f.OrderNo, 9999),
                  p.CountryFlower, p.ProdName`,
      ),
      query(
        `SELECT CustKey, CustCode, CustName, CustArea, OrderCode
         FROM Customer WHERE isDeleted=0 ORDER BY CustName`,
      ),
      query(
        `SELECT FlowerKey, FlowerName, Sort FROM Flower WHERE isDeleted=0 ORDER BY Sort`,
      ),
    ]);

    let arrivalMap = {};
    let arrivalError = weekParseError || null;
    let costMeta = {
      mode,
      latestWeek: latest?.weekStart || null,
      latestOrderYear: latest?.orderYear || year,
      anchorWeek: null,
      weeksScanned: 0,
      fromFallback: 0,
    };

    if (mode === 'recent') {
      const anchor = latest?.weekStart;
      costMeta.anchorWeek = anchor;
      if (anchor) {
        try {
          const fb = await getArrivalCostsWithFallback({
            orderYear: latest?.orderYear || year,
            anchorWeek: anchor,
          });
          arrivalMap = fb.map;
          costMeta.weeksScanned = fb.weeksScanned;
          costMeta.fromFallback = fb.fromFallback;
          costMeta.anchorWeek = fb.anchorWeek;
        } catch (e) {
          arrivalError = e.message;
          arrivalMap = {};
        }
      } else {
        arrivalError = '입고 데이터가 있는 최신 차수를 찾을 수 없습니다.';
      }
    } else if (parsed.weekStart && !weekParseError) {
      costMeta.anchorWeek = parsed.weekStart;
      try {
        const fb = await getArrivalCostsWithFallback({
          orderYear: parsed.orderYear,
          anchorWeek: parsed.weekStart,
        });
        arrivalMap = fb.map;
        costMeta.weeksScanned = fb.weeksScanned;
        costMeta.fromFallback = fb.fromFallback;
      } catch (e) {
        arrivalError = e.message;
        arrivalMap = {};
      }
    } else if (mode === 'selected' && !parsed.weekStart) {
      arrivalError = '선택 차수를 지정하세요.';
    }

    const uploadStore = loadArrivalOverrides();
    const uploadMap = overridesToArrivalMap(uploadStore.items);
    let fromUpload = 0;

    let customerCosts = {};
    if (custKey) {
      const ck = parseInt(custKey, 10);
      if (ck > 0) {
        const cpc = await query(
          `SELECT ProdKey, Cost FROM CustomerProdCost WHERE CustKey=@ck`,
          { ck: { type: sql.Int, value: ck } },
        );
        for (const r of cpc.recordset) {
          customerCosts[r.ProdKey] = Number(r.Cost || 0);
        }
      }
    }

    let withArrival = 0;
    const mappings = loadMappings();
    const products = productsRes.recordset.map(p => {
      const calc = arrivalMap[p.ProdKey] || {};
      const uploaded = uploadMap[p.ProdKey];
      const arr = uploaded || calc;
      if (uploaded) fromUpload += 1;
      const resolved = resolveCatalogArrivalDisplay(p, {
        arrivalCost: arr.arrivalCost,
        displayUnit: arr.displayUnit,
        arrivalPerStem: arr.arrivalPerStem,
        arrivalPerBunch: arr.arrivalPerBunch,
      });
      const arrivalCost = Number(resolved.arrivalCost || 0);
      if (arrivalCost > 0) withArrival += 1;
      const mappingKorName = findMappingKorNameByProdKey(p.ProdKey, mappings);
      const catalogMatch = findCatalogMatchByProdKey(p.ProdKey, mappings);
      const names = resolveCatalogProductNames(p, mappingKorName, mappings);
      return {
        ...p,
        arrivalCost,
        arrivalUnit: resolved.arrivalUnit || catalogSaleUnit(p),
        saleUnit: resolved.saleUnit || catalogSaleUnit(p),
        arrivalRawCost: resolved.rawCost || 0,
        arrivalRawUnit: resolved.rawUnit || null,
        arrivalUnitMatch: resolved.matchedBy || null,
        arrivalUnitMismatch: !!resolved.unitMismatch,
        arrivalSource: uploaded ? 'upload' : (arr.source || null),
        arrivalWeek: uploaded ? null : (arr.arrivalWeek || null),
        arrivalIsFallback: uploaded ? false : !!arr.isFallback,
        customerCost: customerCosts[p.ProdKey] ?? null,
        mappingKorName,
        catalogMatchEngName: catalogMatch?.engName || names.engName || null,
        catalogMatchKorName: catalogMatch?.korName || names.korName || null,
        catalogMatchKey: catalogMatch?.key || null,
        suggestedKorName: names.suggestedKor,
        suggestedEngName: names.engName,
        catalogKorName: names.korName,
        catalogEngName: names.engName,
        korNameSource: names.korSource,
      };
    });

    costMeta.fromUpload = fromUpload;
    costMeta.uploadFileName = uploadStore.fileName || null;
    costMeta.uploadUpdatedAt = uploadStore.updatedAt || null;

    let imageAutoImport = { ran: false, integratedOnServer: !!findIntegratedPptx() };
    if (req.query.autoImport !== '0') {
      try {
        imageAutoImport = {
          ...imageAutoImport,
          ...(await ensureIntegratedCatalogImages(
            productsRes.recordset,
            req.user?.userId || req.user?.userName || 'auto',
          )),
        };
      } catch (e) {
        imageAutoImport = { ...imageAutoImport, ran: false, error: e.message };
      }
    }

    return res.status(200).json({
      success: true,
      orderYear: parsed.orderYear || year,
      weekStart: parsed.weekStart || null,
      weekEnd: parsed.weekEnd || null,
      weekInput: weekStart || null,
      costMode: mode,
      costMeta,
      uploadMeta: {
        fileName: uploadStore.fileName,
        updatedAt: uploadStore.updatedAt,
        count: Object.keys(uploadStore.items || {}).length,
        matchedCount: uploadStore.matchedCount || 0,
      },
      arrivalStats: {
        total: products.length,
        withArrival,
        fromFallback: costMeta.fromFallback,
        fromUpload,
        weeksScanned: costMeta.weeksScanned,
        latestWeek: costMeta.latestWeek,
        anchorWeek: costMeta.anchorWeek,
        uploadFileName: uploadStore.fileName || null,
        error: arrivalError,
      },
      products,
      customers: customersRes.recordset,
      flowers: flowersRes.recordset,
      imageAutoImport,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});
