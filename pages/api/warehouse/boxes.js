import { withAuth } from '../../../lib/auth';
import { query, sql } from '../../../lib/db';
import { createBoxSummaryHandler } from '../../../lib/warehouseBoxSummary.js';

export default withAuth(createBoxSummaryHandler({queryFn:query,types:sql}));
