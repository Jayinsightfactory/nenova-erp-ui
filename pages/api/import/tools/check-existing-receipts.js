import { withAuth } from '../../../../lib/auth';
import { query, sql } from '../../../../lib/db';
import { createExistingReceiptsCheckHandler } from '../../../../lib/packingExistingReceiptsApi';

export const config = { api: { bodyParser: { sizeLimit: '128kb' } } };
export default withAuth(createExistingReceiptsCheckHandler({ queryFn: query, types: sql }));
