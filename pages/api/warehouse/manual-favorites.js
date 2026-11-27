import { withAuth } from '../../../lib/auth';
import { createManualFavoritesHandler } from '../../../lib/manualWarehouseFavoritesStore.js';

export const config = { api: { bodyParser: { sizeLimit: '128kb' } } };

export default withAuth(createManualFavoritesHandler());
