import { query, sql } from '../../../lib/db';
import { withAuth } from '../../../lib/auth';

const store = require('../../../lib/distributionBaselineStore');
const { DistributionBaselineReconciliationError, reconcileDistributionBaseline } = require('../../../lib/distributionBaselineReconcile');

const WEEK_RE = /^(0[1-9]|[1-4]\d|5[0-3])-(0[1-9]|[1-9]\d)$/;
const BASELINE_ID_RE = /^[0-9a-f]{64}$/;

export const config = { api: { bodyParser: { sizeLimit: '200kb' } } };

function requestOriginIsSame(req) {
  const origin = req.headers?.origin;
  if (!origin) return true;
  const host = req.headers?.['x-forwarded-host'] || req.headers?.host;
  if (!host) return false;
  const forwardedProto = req.headers?.['x-forwarded-proto'];
  const protocol = String(Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto || 'http').split(',')[0].trim();
  try { return new URL(origin).origin === `${protocol}://${host}`; } catch { return false; }
}

function inputError(code, message, statusCode = 400) { return new DistributionBaselineReconciliationError(code, message, statusCode); }
function rows(result) {
  if (Array.isArray(result?.recordset)) return result.recordset;
  if (Array.isArray(result?.rows)) return result.rows;
  throw inputError('CURRENT_QUERY_MALFORMED', '현재 출고 자료 조회 형식을 확인할 수 없습니다.', 503);
}
function responseError(res, error, extras = {}) {
  const status = error?.statusCode || 500;
  const code = error?.code || 'BASELINE_RECONCILIATION_ERROR';
  const message = status >= 500 ? '기준 물량표 대조 자료를 읽지 못했습니다.' : (error?.message || '요청값을 확인해 주세요.');
  return res.status(status).json({ success: false, advisoryOnly: true, ...extras, error: { code, message } });
}

function requestScope(body) {
  const year = String(body?.year || '').trim(), week = String(body?.week || '').trim(), baselineId = String(body?.baselineId || '').trim();
  if (!/^20\d{2}$/.test(year) || !WEEK_RE.test(week)) throw inputError('INVALID_SCOPE', '연도와 세부차수 범위가 올바르지 않습니다.');
  if (!BASELINE_ID_RE.test(baselineId)) throw inputError('INVALID_BASELINE_ID', '기준본 식별자 형식이 올바르지 않습니다.');
  return { year, week, baselineId };
}

function scopeForBaseline(baseline) {
  if (baseline.coverage === 'combined') {
    if (!String(baseline.week).endsWith('-02')) throw inputError('INVALID_BASELINE_COVERAGE', '합산 기준본은 02차여야 합니다.');
    return { year: baseline.year, weeks: [`${baseline.week.slice(0, 2)}-01`, baseline.week], coverage: 'combined' };
  }
  if (baseline.coverage !== 'single') throw inputError('INVALID_BASELINE_COVERAGE', '저장된 기준본 범위를 확인할 수 없습니다.');
  return { year: baseline.year, weeks: [baseline.week], coverage: 'single' };
}

async function loadCurrentCatalog(scope) {
  const params = {
    year: { type: sql.NVarChar, value: scope.year },
    w1: { type: sql.NVarChar, value: scope.weeks[0] },
    w2: { type: sql.NVarChar, value: scope.weeks[1] || scope.weeks[0] },
  };
  const [productResult, customerResult, currentResult] = await Promise.all([
    query(`SELECT ProdKey,ProdName,DisplayName,CounName,FlowerName,OutUnit,BunchOf1Box,SteamOf1Box
      FROM Product WHERE ISNULL(isDeleted,0)=0 ORDER BY ProdName,ProdKey`),
    query(`SELECT CustKey,CustName FROM Customer WHERE ISNULL(isDeleted,0)=0 ORDER BY CustName,CustKey`),
    query(`SELECT TOP 10001 v.OrderYear AS year,v.OrderWeek AS week,v.CustKey AS custKey,v.ProdKey AS prodKey,v.SdetailKey,
      d.SdateKey,CONVERT(varchar(10),d.ShipmentDtm,23) AS shipmentDate,d.ShipmentQuantity AS qty,p.OutUnit AS unit
      FROM ViewShipment v JOIN Product p ON p.ProdKey=v.ProdKey LEFT JOIN ShipmentDate d ON d.SdetailKey=v.SdetailKey
      WHERE v.OrderYear=@year AND v.OrderWeek IN (@w1,@w2)
      ORDER BY v.SdetailKey,d.SdateKey`, params),
  ]);
  return { products: rows(productResult), customers: rows(customerResult), currentRows: rows(currentResult) };
}

export default withAuth(async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  if (!requestOriginIsSame(req)) return responseError(res, inputError('ORIGIN_MISMATCH', 'same-origin 요청만 허용됩니다.', 403));
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return responseError(res, inputError('METHOD_NOT_ALLOWED', 'POST 요청만 허용됩니다.', 405)); }
  let baseline;
  let scope;
  try {
    const requested = requestScope(req.body || {});
    baseline = await store.getBaseline({ year: requested.year, week: requested.week, id: requested.baselineId });
    scope = scopeForBaseline(baseline);
    const catalog = await loadCurrentCatalog(scope);
    if (catalog.currentRows.length > 10000) {
      return responseError(res, inputError('CURRENT_RESULT_LIMIT_EXCEEDED', '현재 출고 자료가 10,000건을 초과해 부분 대조를 만들지 않았습니다.', 422), {
        baseline: { id: baseline.id, year: baseline.year, week: baseline.week, coverage: baseline.coverage },
        scope: { ...scope, currentComplete: false }, observedAt: new Date().toISOString(),
      });
    }
    const projection = reconcileDistributionBaseline({ baseline, bindings: req.body?.bindings, ...catalog, currentComplete: true });
    return res.status(200).json({
      success: true,
      advisoryOnly: true,
      baseline: { id: baseline.id, year: baseline.year, week: baseline.week, coverage: baseline.coverage },
      observedAt: new Date().toISOString(),
      scope: { ...scope, currentComplete: true },
      catalog: { products: catalog.products, customers: catalog.customers },
      ...projection,
    });
  } catch (error) {
    return responseError(res, error, baseline && scope ? { baseline: { id: baseline.id, year: baseline.year, week: baseline.week, coverage: baseline.coverage }, scope: { ...scope, currentComplete: false } } : {});
  }
});
