import { query, sql } from '../../../lib/db';
import { withAuth } from '../../../lib/auth';
import { normalizeOrderUnit, requireOrderYear } from '../../../lib/orderUtils';
import { convertQtyToOutUnit } from '../../../lib/orderImportCompareLogic';
import {
  saveOrderImportSnapshot,
  listOrderImportSnapshots,
} from '../../../lib/orderImportSnapshotStore';

async function handler(req, res) {
  if (req.method === 'POST') {
    const {
      orderYear,
      orderWeek,
      custKey,
      custName,
      fileName,
      sheetName,
      sourceType,
      sheetPreview,
      items,
    } = req.body || {};

    let scope;
    try {
      scope = requireOrderYear(orderWeek, orderYear);
    } catch (err) {
      return res.status(err.statusCode || 400).json({ success: false, error: err.message });
    }

    const ck = parseInt(custKey, 10);
    if (!Number.isInteger(ck) || ck <= 0) {
      return res.status(400).json({ success: false, error: '유효한 custKey가 필요합니다.' });
    }
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, error: '저장할 items 배열이 필요합니다.' });
    }

    const prodKeys = [
      ...new Set(
        items
          .map((it) => Number(it?.prodKey))
          .filter((pk) => Number.isInteger(pk) && pk > 0),
      ),
    ];

    const productMap = new Map();
    if (prodKeys.length > 0) {
      const pkParams = {};
      const placeholders = prodKeys.map((pk, idx) => {
        const key = `pk${idx}`;
        pkParams[key] = { type: sql.Int, value: pk };
        return `@${key}`;
      });
      const prodRes = await query(
        `SELECT ProdKey, ProdName, ISNULL(DisplayName, ProdName) AS DisplayName,
                FlowerName, CounName, OutUnit,
                ISNULL(BunchOf1Box, 0) AS BunchOf1Box,
                ISNULL(SteamOf1Box, 0) AS SteamOf1Box
           FROM Product
          WHERE ISNULL(isDeleted, 0) = 0
            AND ProdKey IN (${placeholders.join(',')})`,
        pkParams,
      );
      for (const row of prodRes.recordset || []) {
        productMap.set(Number(row.ProdKey), row);
      }
    }

    const enrichedItems = items.map((it) => {
      const pk = Number(it?.prodKey);
      const prod = Number.isInteger(pk) && pk > 0 ? productMap.get(pk) : null;
      const outUnit = normalizeOrderUnit(
        it?.outUnit || prod?.OutUnit || it?.unit || '박스',
        '박스',
      );
      const unit = normalizeOrderUnit(it?.unit || outUnit, outUnit);
      const bunchOf1Box = Number(it?.bunchOf1Box ?? prod?.BunchOf1Box ?? 0) || 0;
      const steamOf1Box = Number(it?.steamOf1Box ?? prod?.SteamOf1Box ?? 0) || 0;
      const outQty = convertQtyToOutUnit({
        qty: it?.qty,
        unit,
        outUnit,
        bunchOf1Box,
        steamOf1Box,
      });

      return {
        ...it,
        prodName: it?.prodName || prod?.ProdName || '',
        displayName: it?.displayName || prod?.DisplayName || it?.prodName || prod?.ProdName || '',
        flowerName: it?.flowerName || prod?.FlowerName || '',
        counName: it?.counName || prod?.CounName || '',
        unit,
        outUnit,
        bunchOf1Box,
        steamOf1Box,
        outQty,
      };
    });

    const createdBy = req.user?.userId || req.user?.username || req.user?.userName || 'web';
    const saved = await saveOrderImportSnapshot(null, {
      orderYear: Number(scope.orderYear),
      orderWeek: scope.orderWeek,
      custKey: ck,
      custName: custName || '',
      fileName: fileName || '',
      sheetName: sheetName || '',
      sourceType: sourceType || '',
      sheetPreview: sheetPreview || null,
      items: enrichedItems,
      createdBy,
    });

    return res.status(200).json({
      success: true,
      snapshotId: saved.snapshotId,
      createdAt: saved.createdAt,
    });
  }

  if (req.method === 'GET') {
    const { orderYear, orderWeek, custKey } = req.query;
    let scope;
    try {
      scope = requireOrderYear(orderWeek, orderYear);
    } catch (err) {
      return res.status(err.statusCode || 400).json({ success: false, error: err.message });
    }
    const ck = parseInt(custKey, 10);
    if (!Number.isInteger(ck) || ck <= 0) {
      return res.status(400).json({ success: false, error: '유효한 custKey가 필요합니다.' });
    }

    const snapshots = await listOrderImportSnapshots(null, {
      orderYear: Number(scope.orderYear),
      orderWeek: scope.orderWeek,
      custKey: ck,
    });
    return res.status(200).json({ success: true, snapshots });
  }

  return res.status(405).json({ success: false, error: 'Method not allowed' });
}

export default withAuth(handler);
