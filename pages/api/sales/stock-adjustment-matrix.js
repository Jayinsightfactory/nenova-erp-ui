import { withAuth } from '../../../lib/auth';
import { query, sql } from '../../../lib/db';
import { loadStockAdjustmentMatrix } from '../../../lib/stockAdjustmentMatrixSql.js';
import { buildStockAdjustmentMatrixWorkbook } from '../../../lib/stockAdjustmentMatrixWorkbook.js';
import { createStockAdjustmentMatrixHandler } from '../../../lib/stockAdjustmentMatrixApi.js';

export default withAuth(createStockAdjustmentMatrixHandler({
  loadMatrix: scope => loadStockAdjustmentMatrix({query,sql},scope),
  buildWorkbook: buildStockAdjustmentMatrixWorkbook,
}));
