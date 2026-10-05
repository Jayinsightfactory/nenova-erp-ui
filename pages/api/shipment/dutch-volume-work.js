import { withAuth } from '../../../lib/auth';
import { createDutchVolumeWorkHandler } from '../../../lib/dutchVolumeWorkApi.js';

export const config = { api: { bodyParser: { sizeLimit: '900kb' } } };
// The immutable owner-scoped snapshot is the work log. Do not log its raw body to ERP.
export default withAuth(createDutchVolumeWorkHandler());
