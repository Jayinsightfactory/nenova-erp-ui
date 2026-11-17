import { withAuth } from '../../../lib/auth';
import { withActionLog } from '../../../lib/withActionLog';
import { processWorkbook } from './distribute-import-preview';

export const config = { api: { bodyParser: false } };
export default withAuth(withActionLog((req,res) => processWorkbook(req,res,true), {
  actionType:'SHIPMENT_WRITE', affectedTable:'ShipmentFarm', riskLevel:'HIGH',
}));
