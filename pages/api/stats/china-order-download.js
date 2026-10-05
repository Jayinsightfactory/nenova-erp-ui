import {withAuth} from '../../../lib/auth';
import {query,sql} from '../../../lib/db';
import {createChinaOrderDownloadHandler} from '../../../lib/chinaOrderDownloadApi';
export default withAuth(createChinaOrderDownloadHandler({queryFn:query,types:sql}));
