import {withAuth} from '../../../lib/auth';
import core from '../../../lib/shipmentStatement.cjs';
import store from '../../../lib/shipmentStatementStore.cjs';
import workbook from '../../../lib/shipmentStatementWorkbook.cjs';
import {listStatementCustomers,openStatement,saveStatement} from '../../../lib/shipmentStatementService';

export function statementHandler(deps={list:listStatementCustomers,open:openStatement,save:saveStatement,read:store.read,export:workbook.exportWorkbook}){
 return async(req,res)=>{
  res.setHeader('Cache-Control','private, no-store, max-age=0');
  if(!req.user?.userId)return res.status(401).json({success:false,error:'로그인이 필요합니다.'});
  if(!['GET','POST'].includes(req.method)){res.setHeader('Allow','GET, POST');return res.status(405).end();}
  try{
   const input=core.scope(req.query);
   if(req.method==='POST'){
    if(!input.custKey)throw core.fail('업체를 선택하세요.');
    const saved=await deps.save(input,req.body??{},req.user);return res.status(200).json({success:true,saved});
   }
   if(req.query.action==='download'){
    if(!input.custKey)throw core.fail('업체를 선택하세요.');
    const revision=Number(req.query.version);if(!Number.isSafeInteger(revision)||revision<1)throw core.fail('저장 버전을 확인하세요.');
    const record=await deps.read(input,{revision});if(!record)throw core.fail('먼저 작성내용을 저장하세요.',404);
    const bytes=deps.export(record),name=`${input.year}년 ${input.week}차 ${record.source.customer.name.replace(/[\\/:*?"<>|\r\n]/g,'')}.xlsx`;
    res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');res.setHeader('Content-Disposition',`attachment; filename="shipment-statement.xlsx"; filename*=UTF-8''${encodeURIComponent(name)}`);return res.status(200).send(bytes);
   }
   if(!input.custKey)return res.status(200).json({success:true,customers:await deps.list(input)});
   return res.status(200).json({success:true,...await deps.open(input)});
  }catch(e){if(!e.statusCode)console.error('[shipment-statement]',e.code||'FAILED');return res.status(e.statusCode??500).json({success:false,error:e.statusCode?e.message:'출고내역서를 처리하지 못했습니다. 잠시 후 다시 시도하세요.'});}
 };
}
export default withAuth(statementHandler());
export const config={api:{bodyParser:{sizeLimit:'4mb'}}};
