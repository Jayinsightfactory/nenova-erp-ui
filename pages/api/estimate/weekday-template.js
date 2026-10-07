import { withAuth } from '../../../lib/auth.js';
import { serveWeekdaySavedTemplate } from '../../../lib/weekdaySavedTemplate.js';

export default withAuth(serveWeekdaySavedTemplate);
