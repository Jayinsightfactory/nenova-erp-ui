import {withAuth} from '../../../lib/auth';
import {query,sql,withTransaction} from '../../../lib/db';
import {saveProductColor} from '../../../lib/productColor';

export default withAuth(async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(!['GET','POST'].includes(req.method)){res.setHeader('Allow','GET, POST');return res.status(405).end();}
  const key=Number(req.method==='GET'?req.query.prodKey:req.body?.prodKey);
  if(!Number.isSafeInteger(key)||key<=0)return res.status(400).json({success:false,error:'품목을 먼저 매칭하세요.'});
  try{
    if(req.method==='GET'){
      const row=(await query('SELECT ProdKey,ProdName,Descr FROM Product WHERE ProdKey=@pk AND isDeleted=0',{pk:{type:sql.Int,value:key}})).recordset[0];
      return res.status(row?200:404).json({success:!!row,data:row});
    }
    const data=await withTransaction(q=>saveProductColor(q,sql,req.body,req.user.userId));
    if(global._prodCache)global._prodCache.data=null;
    return res.status(200).json({success:true,data});
  }catch(e){return res.status(e.status||400).json({success:false,error:e.status===409?e.message:'저장하지 못했습니다. 비고 길이와 입력값을 확인하고 재조회하세요.'});}
});
