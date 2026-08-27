import { withAuth } from '../../../lib/auth.js';
import { createChinaVolumeBoardHandler } from '../../../lib/chinaVolumeBoardApi.js';

export const config = { api: { bodyParser: { sizeLimit: '40mb' } } };

export default withAuth(createChinaVolumeBoardHandler());
