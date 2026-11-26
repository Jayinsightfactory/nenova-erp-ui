// Read-only WarehouseMaster duplicate lookup for /import/tools packing upload.
// Never mutates ERP tables; strictly scoped to a single OrderYear to prevent cross-year collisions.
import { PACKING_COUNTRIES } from './importPackingErpMatches.js';
import { PACKING_FARM_MATCH_KEY } from './importPackingFarmMatches.js';
import { readImportTeamRecord } from './importTeamStore.js';
import { matchExistingWarehouseReceipts } from './packingDuplicateCheck.js';

const text = value => String(value ?? '').normalize('NFKC').trim();

export function createExistingReceiptsCheckHandler({ queryFn, types, root } = {}) {
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    if (req.user?.accountActive === false) {
      return res.status(403).json({ success: false, error: '비활성 계정입니다.' });
    }
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ success: false, error: '지원하지 않는 요청입니다.' });
    }
    const body = req.body || {};
    const country = text(body.country).toUpperCase();
    if (country && !Object.hasOwn(PACKING_COUNTRIES, country)) {
      return res.status(400).json({ success: false, error: '지원하지 않는 국가 코드입니다.' });
    }
    const rawYear = text(body.orderYear);
    const orderYear = /^20\d{2}$/.test(rawYear)
      ? rawYear
      : new Intl.DateTimeFormat('en', { timeZone: 'Asia/Seoul', year: 'numeric' }).format(new Date());
    const rawWeek = text(body.orderWeek);
    const weekMatch = /^(\d{1,2})-(\d{1,2})$/.exec(rawWeek);
    const orderWeek = weekMatch ? `${weekMatch[1].padStart(2, '0')}-${weekMatch[2].padStart(2, '0')}` : '';

    const rawInvoices = Array.isArray(body.invoices) ? body.invoices : [];
    if (!rawInvoices.length) {
      return res.status(200).json({ success: true, orderYear, orderWeek, matches: [] });
    }
    if (rawInvoices.length > 200) {
      return res.status(400).json({ success: false, error: '한 번에 확인할 수 있는 송장 수(200건)를 초과했습니다.' });
    }
    const invoices = rawInvoices.map((item, idx) => ({
      index: Number.isInteger(item?.index) ? item.index : idx,
      invoice: text(item?.invoice ?? item?.invoiceNo).slice(0, 120),
      supplier: text(item?.supplier ?? item?.farmName).slice(0, 300),
      awb: text(item?.awb).slice(0, 64),
      date: text(item?.date).slice(0, 32),
    }));

    try {
      const storeOpts = root ? { root } : undefined;
      const [wmResult, farmRecord] = await Promise.all([
        queryFn(
          `/* packing-tools:existing-receipts */
           SELECT WarehouseKey, OrderYear, OrderWeek, FarmName, InvoiceNo, OrderNo,
                  CONVERT(varchar(10), InputDate, 23) AS InputDate, FileName, isDeleted
             FROM dbo.WarehouseMaster
            WHERE ISNULL(isDeleted, 0) = 0
              AND NULLIF(LTRIM(RTRIM(InvoiceNo)), '') IS NOT NULL
              AND (OrderYear = @orderYear OR YEAR(InputDate) = TRY_CONVERT(int, @orderYear))`,
          {
            orderYear: { type: types.NVarChar(4), value: orderYear },
          },
        ),
        readImportTeamRecord(PACKING_FARM_MATCH_KEY, storeOpts).catch(() => ({ value: null })),
      ]);

      const { matches } = matchExistingWarehouseReceipts(invoices, wmResult?.recordset || [], {
        country,
        orderYear,
        orderWeek,
        farmMatches: farmRecord?.value || null,
      });

      return res.status(200).json({
        success: true,
        orderYear,
        orderWeek,
        matches,
      });
    } catch {
      return res.status(503).json({
        success: false,
        error: '기존 입고 내역 대조 조회에 실패했습니다. 잠시 후 다시 시도하세요.',
      });
    }
  };
}
