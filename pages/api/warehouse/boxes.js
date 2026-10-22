import { withAuth } from '../../../lib/auth';
import { query, sql } from '../../../lib/db';
import { boxSummaryYear, WAREHOUSE_BOX_SQL } from '../../../lib/warehouseBoxSummary.js';

export default withAuth(async function handler(req,res) {
  if(req.method!=='GET') return res.status(405).end();
  let year;
  try { year=boxSummaryYear(req.query.year); }
  catch(error) { return res.status(400).json({success:false,error:error.message}); }
  try {
    const result=await query(WAREHOUSE_BOX_SQL,{year:{type:sql.NVarChar,value:year}});
    res.setHeader('Cache-Control','no-store');
    return res.status(200).json({success:true,year,rows:result.recordset,source:'WarehouseDetail.BoxQuantity'});
  } catch(error) { return res.status(500).json({success:false,error:error.message}); }
});
