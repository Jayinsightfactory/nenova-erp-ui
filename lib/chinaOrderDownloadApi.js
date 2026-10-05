import {ChinaOrderValidationError,normalizeChinaCenter,buildChinaCycleCatalog,selectChinaCycles,buildChinaOrdersSql,buildChinaHiddenOrdersSql,buildChinaOrderReport} from './chinaOrderDownload.js';

// Dependencies are injected for executable read-only API fixtures (no production DB writes).
export function createChinaOrderDownloadHandler({queryFn,types,now=()=>new Date()}) {
  return async (req,res)=>{
    res.setHeader('Cache-Control','private, no-store');
    if(req.method!=='GET'){res.setHeader('Allow','GET');return res.status(405).json({success:false,error:'조회만 가능한 페이지입니다.'});}
    let center;
    try{center=normalizeChinaCenter(req.query||{});}catch(error){return res.status(400).json({success:false,error:error.message});}
    try{
      const current=now(),today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(current);
      const year=center?.year||Number(today.slice(0,4));
      const calendar=await queryFn(`SELECT OrderYearWeek,WeekDay,CONVERT(nvarchar(10),CONVERT(date,BaseYmd),23) AS BaseYmd
        FROM PeriodDay WHERE WeekDay=5 AND OrderYearWeek BETWEEN @fromKey AND @toKey ORDER BY BaseYmd`,{
        fromKey:{type:types.NVarChar(6),value:`${year-1}01`},toKey:{type:types.NVarChar(6),value:`${year+1}53`}});
      const availableCycles=buildChinaCycleCatalog(calendar.recordset),selection=selectChinaCycles(availableCycles,center,today);
      const params={};selection.cycles.forEach((c,i)=>{params[`year${i}`]={type:types.NVarChar(4),value:String(c.year)};params[`week${i}`]={type:types.NVarChar(5),value:`${c.majorWeek}-%`};});
      const result=await queryFn(buildChinaOrdersSql(selection.cycles),params);
      if(result.recordset.length>100000)return res.status(422).json({success:false,error:'주문 상세가 10만 행을 넘었습니다. 전체 조회를 완료할 수 없어 다운로드를 중단했습니다.'});
      const hidden=await queryFn(buildChinaHiddenOrdersSql(selection.cycles),params);
      const productResult=await queryFn(`SELECT ProdKey,ProdCode,ProdName,FlowerName,CounName,OutUnit FROM Product WHERE isDeleted=0 AND CounName=N'중국' ORDER BY ProdKey`);
      const products=productResult.recordset.map(r=>({prodKey:Number(r.ProdKey),prodCode:r.ProdCode||'',prodName:r.ProdName||'',flower:r.FlowerName||'',country:r.CounName||'',unit:r.OutUnit||''}));
      const count=Number(hidden.recordset[0]?.HiddenCount||0),warnings=count?[`전산 ViewOrder에 연결되지 않은 활성 중국 주문 ${count}행이 있습니다. 해당 수량은 집계에서 제외되므로 관리자 확인이 필요합니다.`]:[];
      const orders=result.recordset.map(r=>({orderYear:Number(r.OrderYear),orderWeek:r.OrderWeek,custKey:Number(r.CustKey),custName:r.CustName||'',custOrderCode:String(r.CustOrderCode??'').trim(),prodKey:Number(r.ProdKey),prodCode:r.ProdCode||'',prodName:r.ProdName||'',flower:r.FlowerName||'',country:r.CounName||'',unit:r.OutUnit||'',quantity:Number(r.OutQuantity)}));
      const missingCodes=new Set(orders.filter(r=>!r.custOrderCode).map(r=>r.custKey));
      if(missingCodes.size)warnings.push(`거래처 정보에 업체 주문코드(CL)가 없는 업체 ${missingCodes.size}곳이 있습니다. 다운로드에 빈값으로 보존하며 내부 업체키로 대신 채우지 않습니다.`);
      const body={success:true,readOnly:true,...selection,availableCycles,products,orders,queriedAt:current.toISOString(),warnings};
      if(buildChinaOrderReport(body).orders.length!==orders.length)throw new ChinaOrderValidationError('조회 차수·국가 범위와 주문 자료가 다릅니다.');
      return res.status(200).json(body);
    }catch(error){
      const diagnostic=error instanceof ChinaOrderValidationError;
      console.error('[china-order-download]',diagnostic?'validation failed':'read failed');
      return res.status(diagnostic?409:500).json({success:false,error:diagnostic?error.message:'중국 발주 조회에 실패했습니다. 잠시 후 다시 조회하세요.'});
    }
  };
}
