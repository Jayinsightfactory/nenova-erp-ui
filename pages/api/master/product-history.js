import {withAuth} from '../../../lib/auth';
import {query,sql} from '../../../lib/db';
import {productHistoryChanges} from '../../../lib/productInputHistory';

export default withAuth(async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='GET'){res.setHeader('Allow','GET');return res.status(405).json({success:false});}
  const cursor=req.query.before==null?2147483647:Number(req.query.before);
  const prodKey=req.query.prodKey==null?null:Number(req.query.prodKey);
  if(!Number.isSafeInteger(cursor)||cursor<1||prodKey!==null&&(!Number.isSafeInteger(prodKey)||prodKey<1))return res.status(400).json({success:false,error:'조회 조건을 확인하세요.'});
  const result=await query(`SELECT TOP (31) LogKey,ActionDtm,Actor,ActionType,Payload FROM SystemActionLog WHERE ActionType IN ('PRODUCT_BULK_EDIT','PRODUCT_INPUT_EDIT') AND Result='SUCCESS' AND LogKey<@cursor AND (@pk IS NULL OR EXISTS (SELECT 1 FROM OPENJSON(CASE WHEN ISJSON(Payload)=1 THEN Payload ELSE '{}' END,'$.changes') WITH (prodKey int '$.prodKey') c WHERE c.prodKey=@pk)) ORDER BY LogKey DESC`,{cursor:{type:sql.Int,value:cursor},pk:{type:sql.Int,value:prodKey}});
  const rows=result.recordset.slice(0,30).map(row=>{
    let data;try{data=JSON.parse(row.Payload);}catch{data={};}
    return {id:row.LogKey,at:row.ActionDtm,actor:row.Actor,kind:data.created?'신규 입력':row.ActionType==='PRODUCT_BULK_EDIT'?'일괄 수정':'개별 수정',changes:(data.changes||[]).filter(c=>!prodKey||c.prodKey===prodKey).map(c=>({prodKey:c.prodKey,prodName:c.prodName,fields:productHistoryChanges(c.before,c.after)}))};
  });
  return res.json({success:true,rows,nextCursor:result.recordset.length>30?rows.at(-1).id:null});
});
