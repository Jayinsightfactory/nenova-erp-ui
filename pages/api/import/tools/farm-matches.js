import { withAuth } from '../../../../lib/auth';
import { query } from '../../../../lib/db';
import { createFarmMatchesHandler } from '../../../../lib/importPackingFarmMatches';

export const config = { api: { bodyParser: { sizeLimit: '64kb' }, responseLimit: '4mb' } };
export default withAuth(createFarmMatchesHandler({ queryFn: query }));
