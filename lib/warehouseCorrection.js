import { createHash } from 'node:crypto';
import { correctionScope, normalizedCorrection, buildCorrectionPlan, correctionDetailFields, correctionError } from './warehouseCorrectionPolicy.js';
import { readInvoiceReceiptEligibility } from './invoiceReceiptEligibility.js';
import { acquireInvoiceReceiptGate, receiptTransactionCheckSql } from './invoiceReceiptNative.js';
import { verifyInvoiceStockReadback } from './invoiceReceiptStockReadback.js';

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const param = (type,value) => ({type,value});
const rows = result => {
  if (!Array.isArray(result?.recordset)) throw correctionError('CORRECTION_READ_FAILED','자료를 완전히 조회하지 못했습니다. 다시 조회하세요.',503);
  return result.recordset;
};
const scopeParams = (types,scope) => ({wk:param(types.Int,scope.warehouseKey), year:param(types.NVarChar,scope.orderYear),week:param(types.NVarChar,scope.orderWeek)});

async function readReceipt(queryFn,types,scope,locked=false) {
  const p=scopeParams(types,scope), hint=locked?'WITH (UPDLOCK,HOLDLOCK)':'';
  const headers=rows(await queryFn(`/* correction:header */ SELECT WarehouseKey,OrderYear,OrderWeek,FarmName,InvoiceNo,OrderNo,
    CONVERT(varchar(10),InputDate,23) InputDate,FileName,GrossWeight,ChargeableWeight,FreightRateUSD,DocFeeUSD,
    isDeleted,LastUpdateID,LastUpdateDtm FROM dbo.WarehouseMaster ${hint}
    WHERE WarehouseKey=@wk AND OrderYear=@year AND OrderWeek=@week`,p));
  if (headers.length!==1 || ![false,0].includes(headers[0].isDeleted)) throw correctionError('CORRECTION_NOT_FOUND','활성 입고 원장을 찾을 수 없습니다.',404);
  const details=rows(await queryFn(`/* correction:details */ SELECT WdetailKey,WarehouseKey,ProdKey,OrderCode,BoxQuantity,BunchQuantity,
    SteamQuantity,OutQuantity,EstQuantity,UPrice,TPrice,SteamOf1Box,SteamOf1Bunch
    FROM dbo.WarehouseDetail ${hint} WHERE WarehouseKey=@wk ORDER BY WdetailKey`,p));
  return {header:headers[0],details};
}

export async function readWarehouseCorrection({queryFn,types,...input}) {
  const scope=correctionScope(input), receipt=await readReceipt(queryFn,types,scope);
  const farms=rows(await queryFn('/* correction:farms */ SELECT FarmKey,FarmName FROM dbo.Farm WHERE isDeleted=0 ORDER BY FarmName'));
  const history=rows(await queryFn(`/* correction:history */ SELECT TOP(20) ActionDtm,Payload FROM dbo.SystemActionLog
    WHERE ActionType=N'WAREHOUSE_CORRECTION' AND Result=N'SUCCESS'
      AND JSON_VALUE(CASE WHEN ISJSON(Payload)=1 THEN Payload ELSE N'{}' END,N'$.warehouseKey')=@key
    ORDER BY LogKey DESC`,{key:param(types.NVarChar,String(scope.warehouseKey))})).map(r=>{
      const value=JSON.parse(r.Payload);return {at:r.ActionDtm,mode:value.mode,reason:value.reason,fileName:value.fileName,result:value.result,changes:value.changes};
    });
  return {...receipt,farms,history};
}

// One shared preflight for preview AND locked write. No optimistic UI-only checks.
export async function prepareWarehouseCorrection({queryFn,types,input,locked=false}) {
  const request=normalizedCorrection(input), receipt=await readReceipt(queryFn,types,request,locked);
  const p=scopeParams(types,request),hint=locked?'WITH (HOLDLOCK)':'';
  p.names=param(types.NVarChar,JSON.stringify((request.items||[]).map(i=>i.prodName)));
  p.oldKeys=param(types.NVarChar,JSON.stringify(receipt.details.map(d=>d.ProdKey)));
  const products=rows(await queryFn(`/* correction:products */ SELECT ProdKey,ProdName,OutUnit,EstUnit,CountryFlower,isDeleted
    FROM dbo.Product ${locked?'WITH (UPDLOCK,HOLDLOCK)':''}
    WHERE ProdKey IN(SELECT TRY_CONVERT(int,value) FROM OPENJSON(@oldKeys))
       OR LOWER(LTRIM(RTRIM(ProdName))) IN(SELECT LOWER(value) FROM OPENJSON(@names)) ORDER BY ProdKey`,p));
  const plan=buildCorrectionPlan(request,receipt.header,receipt.details,products),issues=[];
  const gates=rows(await queryFn(`/* correction:gate-read */ SELECT ProtocolVersion,Mode,LockedAt,Action,OrderYear,OrderWeek,OwnerSessionID,OwnerToken,PendingCalc,CalcProdKey
    FROM dbo.NenovaStockWeekGate ${hint} WHERE GateKey='1'`));
  const capability=rows(await queryFn('/* correction:capability */ EXEC dbo.usp_NenovaStockWeekGateCapability'));
  if(gates.length!==1||gates[0].ProtocolVersion!==2||capability.length!==1||capability[0].ProtocolVersion!==2||![1,true].includes(capability[0].IsReady))
    issues.push({code:'CORRECTION_GATE_UNAVAILABLE',message:'재고 게이트 V2 준비 상태를 확인하지 못했습니다. 저장할 수 없습니다.'});
  else if(!['Mode','LockedAt','Action','OrderYear','OrderWeek','OwnerSessionID','OwnerToken','CalcProdKey'].every(k=>gates[0][k]===null)||![0,false].includes(gates[0].PendingCalc))
    issues.push({code:'CORRECTION_GATE_BUSY',message:'다른 재고 작업이 진행 중이거나 미완료 상태입니다. 완료 후 다시 검토하세요.'});
  if (!plan.changed) issues.push({code:'CORRECTION_UNCHANGED',message:'변경된 농장·품목·수량·금액이 없습니다.'});
  if(plan.farmChanged){
    const farms=rows(await queryFn(`/* correction:farm */ SELECT FarmKey,FarmName FROM dbo.Farm ${hint} WHERE FarmName=@farm AND isDeleted=0`,{farm:param(types.NVarChar,request.farmName)}));
    if(farms.length!==1||farms[0].FarmName!==request.farmName) issues.push({code:'CORRECTION_FARM_INVALID',message:'등록된 농장명 하나를 정확히 선택하세요.'});
  }
  p.keys=param(types.NVarChar,JSON.stringify(plan.keys));p.farm=param(types.NVarChar,receipt.header.FarmName);p.newFarm=param(types.NVarChar,request.farmName);
  p.major=param(types.NVarChar,request.orderWeek.slice(0,2));
  // Existing financial/receipt owners must be resolved in their own workflow; never orphan their keys.
  const connections=rows(await queryFn(`/* correction:connections */
    SELECT N'FREIGHT' Code,COUNT_BIG(*) Count FROM dbo.FreightCost ${hint} WHERE WarehouseKey=@wk
    UNION ALL SELECT N'INVOICE',COUNT_BIG(*) FROM dbo.WebInvoiceOperation ${hint} WHERE WarehouseKey=@wk AND Status=N'COMMITTED'
    UNION ALL SELECT N'INVOICE_COST',COUNT_BIG(*) FROM dbo.WebInvoiceCostRevision ${hint} WHERE WarehouseKey=@wk
    UNION ALL SELECT N'FREIGHT_DETAIL',COUNT_BIG(*) FROM dbo.FreightCostDetail fc ${hint}
      JOIN dbo.WarehouseDetail wd ${hint} ON wd.WdetailKey=fc.WarehouseDetailKey WHERE wd.WarehouseKey=@wk
    UNION ALL SELECT N'STOCK_TYPE',COUNT_BIG(*) FROM dbo.CodeInfo ${hint} WHERE Category=N'StockType' AND Descr=N'입고'
    UNION ALL SELECT N'ARRIVAL',COUNT_BIG(*) FROM dbo.WebArrivalCostLine ${hint}
      WHERE OrderYear=@year AND OrderWeek=@week AND IsCurrent=1 AND ProdKey IN(SELECT TRY_CONVERT(int,value) FROM OPENJSON(@keys))
    UNION ALL SELECT N'WEEK_COST',COUNT_BIG(*) FROM dbo.WeekProdCost ${hint}
      WHERE OrderYear=@year AND OrderWeek=@week AND ProdKey IN(SELECT TRY_CONVERT(int,value) FROM OPENJSON(@keys))
    UNION ALL SELECT N'PROFIT',COUNT_BIG(*) FROM dbo.WebProfitReportConfirm ${hint}
      WHERE IsActive=1 AND (OrderYear>@year OR (OrderYear=@year AND TRY_CONVERT(int,MajorWeek)>=TRY_CONVERT(int,@major)))
    UNION ALL SELECT N'FARM_DISTRIBUTION',COUNT_BIG(*) FROM dbo.ShipmentFarm sf ${hint}
      JOIN dbo.ShipmentDetail sd ${hint} ON sd.SdetailKey=sf.SdetailKey
      JOIN dbo.ShipmentMaster sm ${hint} ON sm.ShipmentKey=sd.ShipmentKey AND sm.isDeleted=0
      JOIN dbo.Farm f ${hint} ON f.FarmKey=sf.FarmKey
      WHERE sm.OrderYear=@year AND sm.OrderWeek=@week AND sd.ProdKey IN(SELECT TRY_CONVERT(int,value) FROM OPENJSON(@keys))
        AND f.FarmName IN(@farm,@newFarm) AND ISNULL(sf.ShipmentQuantity,0)<>0`,p));
  if(connections.length!==9)throw correctionError('CORRECTION_CONNECTION_READ_FAILED','원가·정산 연결을 모두 확인하지 못했습니다.',503);
  const labels={FREIGHT:'운송원가 연결(삭제 이력 포함)',INVOICE:'인보이스 입고·원가 문서 연결',INVOICE_COST:'인보이스 원가 이력',FREIGHT_DETAIL:'입고 상세의 운송원가 이력',STOCK_TYPE:'입고가 재고조정으로 집계되는 코드 설정',ARRIVAL:'해당 품목의 도착원가',WEEK_COST:'해당 품목의 저장 원가',PROFIT:'해당 차수 이후 확정 손익',FARM_DISTRIBUTION:'해당 농장·품목의 출고 농장분배'};
  for(const c of connections) if(Number(c.Count)>0)issues.push({code:`CORRECTION_LINKED_${c.Code}`,message:`${labels[c.Code]} ${c.Count}건이 있습니다. 해당 업무에서 연결 상태를 먼저 확인하세요. 자동 해제하지 않습니다.`});
  const eligibilityQuery=locked?(sql,p)=>queryFn(sql.replaceAll('FROM dbo.StockMaster','FROM dbo.StockMaster WITH (HOLDLOCK)').replaceAll('JOIN dbo.ViewShipment vs','JOIN dbo.ViewShipment vs WITH (HOLDLOCK)'),p):queryFn;
  const eligibility=await readInvoiceReceiptEligibility({queryFn:eligibilityQuery,types,...request,prodKeys:plan.keys});
  if(!eligibility.canProceed) issues.push({code:eligibility.code,message:eligibility.message,blockers:eligibility.blockers});
  const digest=hash({request,receipt,products,connections,eligibility});
  return {request,receipt,plan,issues,canCommit:issues.length===0,baselineDigest:digest,eligibility};
}

async function recalculateChangedProducts(q,types,tx,scope,keys,actor){
  for(const key of keys){
    const p={...tx,...scopeParams(types,scope),pk:param(types.Int,key),uid:param(types.NVarChar,actor)};
    const result=await q(`/* correction:calculate */ ${receiptTransactionCheckSql}
      DECLARE @r int=NULL,@rc int=NULL,@msg nvarchar(max)=NULL;
      EXEC @rc=dbo.usp_StockCalculation @OrderYear=@year,@OrderWeek=@week,@ProdKey=@pk,
        @iUserID=@uid,@oResult=@r OUTPUT,@oMessage=@msg OUTPUT;
      ${receiptTransactionCheckSql}
      IF @r IS NULL OR @rc IS NULL OR @r<>0 OR @rc<>0 THROW 51064,'CORRECTION_STOCK_CALC_FAILED',1;
      IF NOT EXISTS(SELECT 1 FROM dbo.NenovaStockWeekGate WHERE GateKey='1' AND ProtocolVersion=2
        AND Mode IS NULL AND PendingCalc=0 AND OwnerToken IS NULL AND OwnerSessionID IS NULL
        AND LockedAt IS NULL AND Action IS NULL AND OrderYear IS NULL AND OrderWeek IS NULL AND CalcProdKey IS NULL)
        THROW 51063,'CORRECTION_GATE_NOT_IDLE',1;
      SELECT @r result,@rc returnCode`,p);
    const r=(result.recordsets?.at(-1)||result.recordset)?.[0];
    if(r?.result!==0||r?.returnCode!==0)throw correctionError('CORRECTION_STOCK_FAILED','재고 재계산에 실패하여 전체 저장을 취소했습니다.');
  }
}

export async function commitWarehouseCorrection({withTransactionFn,types,input,actor,
  gateFn=acquireInvoiceReceiptGate,verifyStockFn=verifyInvoiceStockReadback}) {
  const request=normalizedCorrection(input);
  if(!uuid.test(input.operationId||'') || !/^[a-f0-9]{64}$/.test(input.baselineDigest||'') || input.confirmed!==true)
    throw correctionError('CORRECTION_CONFIRM_REQUIRED','변경 내역을 검토하고 교체 저장을 확인하세요.',400);
  const reason=String(input.reason??'').trim();
  if(!reason || reason.length>500)throw correctionError('CORRECTION_REASON_REQUIRED','수정 사유를 1~500자로 입력하세요.',400);
  if(typeof actor!=='string'||!actor.trim()||actor.length>20)throw correctionError('CORRECTION_ACTOR_INVALID','로그인 계정을 확인하세요.',403);
  const operationId=input.operationId.toLowerCase(), requestHash=hash({request,reason,actor,baselineDigest:input.baselineDigest});
  return withTransactionFn(async q=>{
    const op=param(types.NVarChar,`warehouse-correction:${operationId}`);
    await q(`/* correction:operation-lock */ DECLARE @r int;
      EXEC @r=sys.sp_getapplock @Resource=@op,@LockMode=N'Exclusive',@LockOwner=N'Transaction',@LockTimeout=10000;
      IF @r IS NULL OR @r<0 THROW 51062,'CORRECTION_OPERATION_BUSY',1;`,{op});
    const prior=rows(await q(`/* correction:replay */ SELECT Payload FROM dbo.SystemActionLog
      WHERE ActionType=N'WAREHOUSE_CORRECTION' AND SessionId=@op AND Result=N'SUCCESS'`,{op}));
    if(prior.length){
      const audit=JSON.parse(prior[0].Payload);
      if(prior.length!==1||audit.requestHash!==requestHash)throw correctionError('CORRECTION_OPERATION_CONFLICT','같은 작업번호로 다른 내용을 저장할 수 없습니다.');
      return {...audit.result,replayed:true};
    }
    const tx=await gateFn(q,types);
    const prepared=await prepareWarehouseCorrection({queryFn:q,types,input:request,locked:true});
    if(!prepared.canCommit)throw correctionError(prepared.issues[0].code,prepared.issues[0].message);
    if(prepared.baselineDigest!==input.baselineDigest)throw correctionError('CORRECTION_STALE','다른 작업으로 입고 또는 검증 조건이 변경되었습니다. 미리보기를 다시 실행하세요.');
    const {plan,receipt}=prepared,p={...scopeParams(types,request),...tx,actor:param(types.NVarChar,actor),farm:param(types.NVarChar,request.farmName)};
    await q(`/* correction:update-header */ ${receiptTransactionCheckSql}
      UPDATE dbo.WarehouseMaster SET FarmName=@farm,LastUpdateID=@actor,LastUpdateDtm=GETDATE()
      WHERE WarehouseKey=@wk AND OrderYear=@year AND OrderWeek=@week AND isDeleted=0;
      IF @@ROWCOUNT<>1 THROW 51066,'CORRECTION_HEADER_CHANGED',1;`,p);
    if(plan.detailsChanged){
      await q(`/* correction:replace-details */ DELETE FROM dbo.WarehouseDetail WHERE WarehouseKey=@wk`,p);
      for(const d of plan.after){
        const dp={...p};for(const k of correctionDetailFields)dp[k]=param(k==='ProdKey'?types.Int:k==='OrderCode'?types.NVarChar:types.Float,d[k]);
        await q(`/* correction:insert-detail */ INSERT dbo.WarehouseDetail
          (WarehouseKey,ProdKey,OrderCode,BoxQuantity,BunchQuantity,SteamQuantity,SteamOf1Box,SteamOf1Bunch,OutQuantity,EstQuantity,UPrice,TPrice)
          VALUES(@wk,@ProdKey,@OrderCode,@BoxQuantity,@BunchQuantity,@SteamQuantity,@SteamOf1Box,@SteamOf1Bunch,@OutQuantity,@EstQuantity,@UPrice,@TPrice)`,dp);
      }
    }
    const changed=plan.changes.filter(c=>Math.abs(c.delta)>1e-7);
    for(const c of changed){
      const result=await q(`/* correction:stock-delta */ DECLARE @before float;
        SELECT @before=ISNULL(Stock,0) FROM dbo.Product WITH (UPDLOCK,HOLDLOCK) WHERE ProdKey=@pk AND isDeleted=0;
        IF @before IS NULL THROW 51066,'CORRECTION_PRODUCT_MISSING',1;
        IF ROUND(@before+@delta,3)<0 THROW 51066,'CORRECTION_PRODUCT_NEGATIVE',1;
        INSERT dbo.StockHistory(ChangeDtm,OrderYear,OrderWeek,ChangeID,ChangeType,ColumName,BeforeValue,AfterValue,Descr,ProdKey)
          VALUES(GETDATE(),@year,@week,@actor,N'입고',N'수량',@before,@before+@delta,@reason,@pk);
        UPDATE dbo.Product SET Stock=@before+@delta WHERE ProdKey=@pk AND isDeleted=0;
        IF @@ROWCOUNT<>1 THROW 51066,'CORRECTION_PRODUCT_CHANGED',1;
        SELECT Stock ActualStock,@before+@delta ExpectedStock FROM dbo.Product WHERE ProdKey=@pk`,
        {...p,pk:param(types.Int,c.prodKey),delta:param(types.Float,c.delta),reason:param(types.NVarChar,`입고 수정 #${request.warehouseKey}: ${reason}`.slice(0,500))});
      const r=rows(result)[0];
      if(!r||!Number.isFinite(r.ActualStock)||!Number.isFinite(r.ExpectedStock)||Math.abs(r.ActualStock-r.ExpectedStock)>1e-6)
        throw correctionError('CORRECTION_STOCK_READBACK','품목 재고 검증이 실패하여 저장을 취소했습니다.');
    }
    let stockReadback=null;
    if(changed.length){
      const keys=changed.map(c=>c.prodKey);
      await recalculateChangedProducts(q,types,tx,request,keys,actor);
      stockReadback=await verifyStockFn(q,types,request,keys);
      const negatives=rows(await q(`/* correction:negative */ SELECT TOP(10) ps.ProdKey,sm.OrderYear,sm.OrderWeek,ps.Stock
        FROM dbo.ProductStock ps WITH (HOLDLOCK) JOIN dbo.StockMaster sm WITH (HOLDLOCK) ON sm.StockKey=ps.StockKey
        WHERE sm.OrderYearWeek>=@year+REPLACE(@week,N'-',N'')
          AND ps.ProdKey IN(SELECT TRY_CONVERT(int,value) FROM OPENJSON(@keys)) AND ROUND(ps.Stock,3)<0`,{...p,keys:param(types.NVarChar,JSON.stringify(keys))}));
      if(negatives.length)throw correctionError('CORRECTION_NEGATIVE_STOCK',`현재·후속 차수에 음수재고가 발생하여 저장하지 않았습니다: ${negatives.map(n=>`${n.OrderYear}/${n.OrderWeek} 품목${n.ProdKey} 부족${-n.Stock}`).join(', ')}`);
    }
    const after=await readReceipt(q,types,request,true);
    const canonical=items=>items.map(d=>correctionDetailFields.map(k=>d[k]??null)).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
    const unchangedHeader=['WarehouseKey','OrderYear','OrderWeek','InvoiceNo','OrderNo','InputDate','FileName','GrossWeight','ChargeableWeight','FreightRateUSD','DocFeeUSD','isDeleted'];
    if(after.header.FarmName!==request.farmName||unchangedHeader.some(k=>after.header[k]!==receipt.header[k])
      ||hash(canonical(after.details))!==hash(canonical(plan.after))
      ||!plan.detailsChanged&&hash(after.details)!==hash(receipt.details))
      throw correctionError('CORRECTION_READBACK_FAILED','저장된 입고가 검토한 내용과 달라 전체 취소했습니다.');
    const result={warehouseKey:request.warehouseKey,operationId,mode:request.mode,changes:plan.changes,stockReadback,erpWritePerformed:true};
    const audit={warehouseKey:request.warehouseKey,operationId,requestHash,mode:request.mode,reason,fileName:request.fileName??null,changes:plan.changes,before:receipt,after,result};
    await q(`/* correction:audit */ ${receiptTransactionCheckSql}
      INSERT dbo.SystemActionLog(Actor,SessionId,ActionType,Method,Endpoint,AffectedTable,AffectedCount,Payload,Result,ResultDesc,RiskLevel)
      VALUES(@actor,@op,N'WAREHOUSE_CORRECTION',N'POST',N'/api/warehouse/correction',N'WarehouseMaster/WarehouseDetail',@count,@payload,N'SUCCESS',N'입고 수정 전후 기록',N'HIGH')`,
      {...p,op,count:param(types.Int,after.details.length),payload:param(types.NVarChar,JSON.stringify(audit))});
    return result;
  },{retries:0});
}
