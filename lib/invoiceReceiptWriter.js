import { createHash } from 'node:crypto';
import { getInvoiceDocument } from './invoiceReceiptDocuments.js';
import { readInvoiceReceiptEligibility } from './invoiceReceiptEligibility.js';
import { reconcileInvoiceReceipt } from './invoiceReceiptReconciliation.js';
import { validateInvoiceReceiptLines } from './invoiceReceiptValidation.js';
import { verifyInvoiceStockReadback } from './invoiceReceiptStockReadback.js';
import { acquireInvoiceReceiptGate, nextInvoiceWarehouseKey, calculateInvoiceStock,
  receiptError, receiptTransactionCheckSql } from './invoiceReceiptNative.js';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const countryNames={CN:'중국',NL:'네덜란드',CO:'콜롬비아',EC:'에콰도르',TH:'태국',AU:'호주',US:'미국',VN:'베트남'};
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const param=(type,value)=>({type,value});
const active=x=>[0,false].includes(x);
function assertId(value){if(typeof value!=='string'||!UUID.test(value))throw receiptError('INVALID_ID','문서·작업 식별자를 확인하세요.',400);}
function lastCommitted(document){return (document.operations||[]).filter(o=>o.status==='COMMITTED').sort((a,b)=>b.documentRevision-a.documentRevision)[0]||null;}

export async function previewInvoiceReceipt({queryFn,types,documentId,revision,locked=false}) {
  assertId(documentId);
  const document=await getInvoiceDocument({queryFn,types,documentId});
  if(!document)throw receiptError('DOCUMENT_NOT_FOUND','저장된 인보이스를 찾을 수 없습니다.',404);
  if(document.revision!==revision)throw receiptError('STALE_REVISION','다른 담당자가 수정했습니다. 저장 내역을 다시 불러오세요.');
  const metadata=document.reviewedMetadata||{}, country=countryNames[metadata.country];
  const params={year:param(types.NVarChar,document.orderYear),week:param(types.NVarChar,document.orderWeek),
    country:param(types.NVarChar,country||''),farm:param(types.Int,document.farmKey),
    invoice:param(types.NVarChar,document.invoiceNo),invoiceYear:param(types.NVarChar,document.invoiceYear)};
  const keys=[...new Set(document.lines.map(l=>l.prodKey).filter(Number.isInteger))];
  keys.forEach((key,i)=>params[`p${i}`]=param(types.Int,key));
  const products=(await queryFn(`SELECT ProdKey,ProdName,CountryFlower,CounName,OutUnit,EstUnit,
    SteamOf1Box,SteamOf1Bunch,BunchOf1Box,Stock,isDeleted FROM dbo.Product ${locked?'WITH (UPDLOCK,HOLDLOCK)':''}
    WHERE ProdKey IN (${keys.length?keys.map((_,i)=>`@p${i}`).join(','):'NULL'}) ORDER BY ProdKey`,params)).recordset;
  if(!Array.isArray(products))throw receiptError('PRODUCT_READ_FAILED','품목 조회 결과가 불완전합니다.',503);
  const {lines,issues}=validateInvoiceReceiptLines(document,products);
  if(!country)issues.push({code:'COUNTRY_REQUIRED',message:'인보이스 국가를 선택하세요.'});
  for(const p of products)if(country&&p.CounName?.trim()!==country)issues.push({code:'PRODUCT_COUNTRY_CONFLICT',message:`${p.ProdName}: 선택 국가와 전산 국가가 다릅니다.`});
  const farms=(await queryFn(`SELECT FarmKey,FarmName FROM dbo.Farm ${locked?'WITH (HOLDLOCK)':''} WHERE FarmKey=@farm AND isDeleted=0`,params)).recordset;
  if(farms?.length!==1)issues.push({code:'FARM_REQUIRED',message:'활성 공급 농장을 선택하세요.'});
  const previous=lastCommitted(document);
  const editingWarehouseKey=previous?.warehouseKey??null;
  let savedReceipt=null;
  if(editingWarehouseKey){
    params.wk=param(types.Int,editingWarehouseKey);
    const header=(await queryFn(`SELECT WarehouseKey,OrderYear,OrderWeek,FarmName,InvoiceNo,OrderNo,
      CONVERT(varchar(10),InputDate,23) InputDate,GrossWeight,ChargeableWeight,FreightRateUSD,DocFeeUSD,isDeleted
      FROM dbo.WarehouseMaster ${locked?'WITH (UPDLOCK,HOLDLOCK)':''} WHERE WarehouseKey=@wk`,params)).recordset;
    const details=(await queryFn(`SELECT WdetailKey,ProdKey,BoxQuantity,BunchQuantity,SteamQuantity,OutQuantity,
      EstQuantity,UPrice,TPrice FROM dbo.WarehouseDetail ${locked?'WITH (UPDLOCK,HOLDLOCK)':''} WHERE WarehouseKey=@wk ORDER BY WdetailKey`,params)).recordset;
    savedReceipt={header:header?.[0],details};
    if(header?.length!==1||!active(header[0].isDeleted)||header[0].OrderYear!==document.orderYear||header[0].OrderWeek!==document.orderWeek)
      issues.push({code:'RECEIPT_SCOPE_CHANGED',message:'기존 입고의 연도·차수·삭제 상태가 변경되었습니다.'});
    const priorResult=previous.result;
    if(!priorResult?.receiptDigest||hash(savedReceipt)!==priorResult.receiptDigest)
      issues.push({code:'ERP_RECEIPT_CHANGED',message:'전산에서 입고가 변경되었습니다. 기존 웹 기준과 달라 자동 덮어쓰지 않습니다.'});
    for(const mapped of priorResult?.lineMappings||[]){
      const line=lines.find(l=>l.lineId===mapped.lineId);
      if(!line||line.prodKey!==mapped.prodKey)issues.push({code:'COMMITTED_LINE_IDENTITY_CHANGED',message:'등록된 품목은 삭제·교체하지 말고 명시 수량 0으로 취소하세요.',lineId:mapped.lineId});
    }
    if(previous.documentRevision===revision)issues.push({code:'ALREADY_COMMITTED',message:'이 버전은 이미 입고 등록되었습니다.'});
  }
  if(farms?.length===1){
    params.farmName=param(types.NVarChar,farms[0].FarmName);
    const duplicates=(await queryFn(`SELECT WarehouseKey FROM dbo.WarehouseMaster ${locked?'WITH (UPDLOCK,HOLDLOCK)':''}
      WHERE isDeleted=0 AND FarmName=@farmName AND InvoiceNo=@invoice AND YEAR(InputDate)=TRY_CONVERT(int,@invoiceYear)`,params)).recordset;
    if(!Array.isArray(duplicates))throw receiptError('DUPLICATE_CHECK_FAILED','중복 입고를 확인하지 못했습니다.',503);
    if(duplicates.some(r=>r.WarehouseKey!==editingWarehouseKey))issues.push({code:'DUPLICATE_INVOICE',message:'같은 공급자·인보이스·발행연도의 기존 입고가 있습니다.'});
  }
  let eligibility=null;
  if(keys.length===document.lines.filter(l=>l.prodKey!=null).map(l=>l.prodKey).filter((v,i,a)=>a.indexOf(v)===i).length && keys.length){
    const eligibilityQuery=locked?(q,p)=>queryFn(q.replaceAll('FROM dbo.StockMaster','FROM dbo.StockMaster WITH (HOLDLOCK)').replaceAll('JOIN dbo.ViewShipment vs','JOIN dbo.ViewShipment vs WITH (HOLDLOCK)'),p):queryFn;
    eligibility=await readInvoiceReceiptEligibility({queryFn:eligibilityQuery,types,orderYear:document.orderYear,orderWeek:document.orderWeek,prodKeys:keys});
    if(!eligibility.canProceed)issues.push({code:eligibility.code,message:eligibility.message});
  }
  let reconciliation=null;
  if(country&&lines.length===document.lines.length&&lines.every(l=>Number.isFinite(l.outQuantity))){
    const omitted=(await queryFn(`SELECT od.OrderDetailKey FROM dbo.OrderMaster om
      JOIN dbo.OrderDetail od ON od.OrderMasterKey=om.OrderMasterKey
      JOIN dbo.Product p ON p.ProdKey=od.ProdKey
      WHERE om.OrderYear=@year AND om.OrderWeek=@week AND om.isDeleted=0 AND od.isDeleted=0
      AND p.CounName=@country AND NOT EXISTS
      (SELECT 1 FROM dbo.ViewOrder v WHERE v.OrderDetailKey=od.OrderDetailKey)`,params)).recordset;
    if(!Array.isArray(omitted))throw receiptError('RECONCILIATION_UNAVAILABLE','주문 원본과 전산 조회의 연결을 확인하지 못했습니다.',503);
    if(omitted.length)issues.push({code:'ORDER_VIEW_INCOMPLETE',message:`전산 조회에서 제외된 주문 상세 ${omitted.length}건이 있습니다. 거래처·품목·담당자 연결 확인 후 다시 검증하세요.`});
    const result=await queryFn(`SELECT v.OrderYear,v.OrderWeek,v.ProdKey,p.OutUnit,v.OutQuantity FROM dbo.ViewOrder v
      JOIN dbo.Product p ON p.ProdKey=v.ProdKey WHERE v.OrderYear=@year AND v.OrderWeek=@week AND p.CounName=@country;
      SELECT v.OrderYear,v.OrderWeek,v.WarehouseKey,v.ProdKey,p.OutUnit,v.OutQuantity FROM dbo.ViewWarehouse v
      JOIN dbo.Product p ON p.ProdKey=v.ProdKey WHERE v.OrderYear=@year AND v.OrderWeek=@week AND p.CounName=@country;`,params);
    if(result.recordsets?.length!==2)throw receiptError('RECONCILIATION_UNAVAILABLE','주문·입고 대조 조회를 완료하지 못했습니다.',503);
    const map=r=>({orderYear:r.OrderYear,orderWeek:r.OrderWeek,prodKey:r.ProdKey,unit:r.OutUnit,quantity:r.OutQuantity,warehouseKey:r.WarehouseKey});
    reconciliation=reconcileInvoiceReceipt({orderYear:document.orderYear,orderWeek:document.orderWeek,
      orders:result.recordsets[0].map(map),receipts:result.recordsets[1].map(map),editingWarehouseKey,
      draft:lines.map(l=>({orderYear:document.orderYear,orderWeek:document.orderWeek,prodKey:l.prodKey,unit:l.outUnit,quantity:l.outQuantity}))});
  }
  const baselineDigest=hash({documentId,revision,products,farms,eligibility,reconciliation,savedReceipt});
  return {canCommit:issues.length===0,baselineDigest,eligibility,issues,reconciliation,lines,
    cost:{status:'PENDING',message:'실제량 원가 검토가 필요합니다. 예상 원가를 실제 원가로 대체하지 않습니다.'},
    documentRevision:revision,document,farmName:farms?.[0]?.FarmName,editingWarehouseKey,previous};
}

export async function getInvoiceReceiptOperation({queryFn,types,operationId}){
  assertId(operationId);
  const result=await queryFn(`SELECT OperationId,DocumentId,DocumentRevision,Status,WarehouseKey,ResultJson,ErrorCode,Actor,CreatedAt,CompletedAt
    FROM dbo.WebInvoiceOperation WHERE OperationId=@id`,{id:param(types.UniqueIdentifier,operationId)});
  const row=result.recordset?.[0];
  return row?{operationId:row.OperationId,documentId:row.DocumentId,revision:row.DocumentRevision,status:row.Status,
    warehouseKey:row.WarehouseKey,result:row.ResultJson?JSON.parse(row.ResultJson):null,errorCode:row.ErrorCode}:null;
}

export async function createInvoiceReceipt({withTransactionFn,queryFn,types,documentId,revision,operationId,receiptPartId,baselineDigest,reason,allowPendingCost,actor}) {
  [documentId,operationId,receiptPartId].forEach(assertId);
  if(!Number.isInteger(revision)||revision<1||!/^([0-9a-f]{64})$/i.test(baselineDigest||''))throw receiptError('PREVIEW_REQUIRED','저장된 문서의 검증 결과가 필요합니다.',400);
  if(typeof actor!=='string'||!actor.trim()||actor.length>20)throw receiptError('ACTOR_INVALID','전산에 기록할 로그인 계정을 확인하세요.',403);
  if(typeof reason!=='string'||!reason.trim()||reason.length>1000)throw receiptError('REASON_REQUIRED','변경 사유를 1~1,000자로 입력하세요.',400);
  if(allowPendingCost!==true)throw receiptError('COST_REVIEW_REQUIRED','원가 검토 대기 상태의 입고 등록을 명시 확인하세요.',400);
  const requestHash=Buffer.from(hash({documentId,revision,operationId,receiptPartId,baselineDigest,reason,allowPendingCost,actor}),'hex');
  return withTransactionFn(async tQuery=>{
    const p={id:param(types.UniqueIdentifier,documentId),op:param(types.UniqueIdentifier,operationId),
      part:param(types.UniqueIdentifier,receiptPartId),revision:param(types.Int,revision),
      hash:param(types.Binary(32),requestHash),actor:param(types.NVarChar,actor),reason:param(types.NVarChar,reason.trim())};
    // Retry serialization precedes gate checks, so a duplicate request returns its committed result.
    const operation=await tQuery(`SELECT RequestHash,Status,ResultJson FROM dbo.WebInvoiceOperation WITH (UPDLOCK,HOLDLOCK) WHERE OperationId=@op`,p);
    if(operation.recordset?.length){
      const old=operation.recordset[0];
      if(!Buffer.from(old.RequestHash).equals(requestHash))throw receiptError('OPERATION_REQUEST_CONFLICT','같은 작업 번호로 다른 내용을 저장할 수 없습니다.');
      if(old.Status==='COMMITTED')return JSON.parse(old.ResultJson);
      throw receiptError('COMMIT_RESULT_UNKNOWN','이 작업의 완료 상태를 먼저 확인하세요.');
    }
    await tQuery('SELECT DocumentId FROM dbo.WebInvoiceDocument WITH (UPDLOCK,HOLDLOCK) WHERE DocumentId=@id',p);
    const transactionParams=await acquireInvoiceReceiptGate(tQuery,types);
    const preview=await previewInvoiceReceipt({queryFn:tQuery,types,documentId,revision,locked:true});
    if(!preview.canCommit)throw receiptError(preview.issues[0].code,preview.issues[0].message);
    if(preview.baselineDigest!==baselineDigest)throw receiptError('STALE_BASELINE','전산 값이 변경되었습니다. 검증을 다시 실행하세요.');
    if(preview.previous && preview.previous.receiptPartId.toLowerCase()!==receiptPartId.toLowerCase())
      throw receiptError('SPLIT_RECEIPT_NOT_SUPPORTED','기존 입고 수정은 같은 입고 식별자로 진행해야 합니다. 별도 분할 입고는 지원하지 않습니다.');
    const doc=preview.document,meta=doc.reviewedMetadata||{};
    const wk=preview.editingWarehouseKey||await nextInvoiceWarehouseKey(tQuery,types,transactionParams);
    p.wk=param(types.Int,wk);p.year=param(types.NVarChar,doc.orderYear);p.week=param(types.NVarChar,doc.orderWeek);
    p.action=param(types.NVarChar,preview.editingWarehouseKey?'UPDATE_RECEIPT':'CREATE_RECEIPT');
    await tQuery(`INSERT dbo.WebInvoiceOperation (OperationId,DocumentId,DocumentRevision,ReceiptPartId,RequestHash,Action,Status,Actor,CreatedAt)
      VALUES(@op,@id,@revision,@part,@hash,@action,N'PENDING',@actor,SYSUTCDATETIME());`,p);
    const header={...p,fn:param(types.NVarChar,doc.originalFileName.slice(0,500)),farm:param(types.NVarChar,preview.farmName),
      inv:param(types.NVarChar,doc.invoiceNo),awb:param(types.NVarChar,meta.awb||''),date:param(types.NVarChar,meta.inputDate),
      gw:param(types.Decimal(10,2),meta.gw??null),cw:param(types.Decimal(10,2),meta.cw??null),
      rate:param(types.Decimal(10,4),meta.freightRate??null),fee:param(types.Decimal(10,2),meta.docFee??null)};
    if(!preview.editingWarehouseKey)await tQuery(`INSERT dbo.WarehouseMaster
      (WarehouseKey,UploadDtm,FileName,OrderYear,OrderWeek,FarmName,InvoiceNo,OrderNo,InputDate,GrossWeight,ChargeableWeight,FreightRateUSD,DocFeeUSD,isDeleted,CreateID,CreateDtm)
      VALUES(@wk,GETDATE(),@fn,@year,@week,@farm,@inv,@awb,CONVERT(datetime,REPLACE(@date,N'-',N''),112),@gw,@cw,@rate,@fee,0,@actor,GETDATE());`,header);
    else await tQuery(`UPDATE dbo.WarehouseMaster SET FarmName=@farm,InvoiceNo=@inv,OrderNo=@awb,InputDate=CONVERT(datetime,REPLACE(@date,N'-',N''),112),
      GrossWeight=@gw,ChargeableWeight=@cw,FreightRateUSD=@rate,DocFeeUSD=@fee,LastUpdateID=@actor,LastUpdateDtm=GETDATE()
      WHERE WarehouseKey=@wk AND OrderYear=@year AND OrderWeek=@week AND isDeleted=0;
      IF @@ROWCOUNT<>1 THROW 51066,'INVOICE_RECEIPT_SCOPE_CHANGED',1;`,header);
    const delta=new Map(),lineMappings=[];
    const previousMappings=preview.previous?.result?.lineMappings||[];
    for(const line of preview.lines){
      const mapped=previousMappings.find(x=>x.lineId===line.lineId);
      const lp={...p,pk:param(types.Int,line.prodKey),box:param(types.Float,line.boxQuantity??null),bunch:param(types.Float,line.bunchQuantity??null),
        steam:param(types.Float,line.stemQuantity??null),sbox:param(types.Float,line.steamOf1Box),sbunch:param(types.Float,line.steamOf1Bunch),
        oq:param(types.Float,line.outQuantity),eq:param(types.Float,line.estQuantity),up:param(types.Float,line.unitPrice),tp:param(types.Float,line.lineAmount)};
      let detailKey;
      if(mapped){
        lp.dk=param(types.Int,mapped.wdetailKey);
        const old=(await tQuery('SELECT OutQuantity FROM dbo.WarehouseDetail WITH (UPDLOCK,HOLDLOCK) WHERE WdetailKey=@dk AND WarehouseKey=@wk AND ProdKey=@pk',lp)).recordset;
        if(old?.length!==1)throw receiptError('ERP_RECEIPT_CHANGED','수정 대상 입고 상세가 변경되었습니다.');
        delta.set(line.prodKey,(delta.get(line.prodKey)||0)+line.outQuantity-old[0].OutQuantity);
        await tQuery(`UPDATE dbo.WarehouseDetail SET BoxQuantity=@box,BunchQuantity=@bunch,SteamQuantity=@steam,SteamOf1Box=@sbox,
          SteamOf1Bunch=@sbunch,OutQuantity=@oq,EstQuantity=@eq,UPrice=@up,TPrice=@tp WHERE WdetailKey=@dk AND WarehouseKey=@wk AND ProdKey=@pk;
          IF @@ROWCOUNT<>1 THROW 51066,'INVOICE_DETAIL_SCOPE_CHANGED',1;`,lp);
        detailKey=mapped.wdetailKey;
      }else{
        const inserted=await tQuery(`INSERT dbo.WarehouseDetail (WarehouseKey,ProdKey,OrderCode,BoxQuantity,BunchQuantity,SteamQuantity,SteamOf1Box,SteamOf1Bunch,OutQuantity,EstQuantity,UPrice,TPrice)
          OUTPUT INSERTED.WdetailKey VALUES(@wk,@pk,N'',@box,@bunch,@steam,@sbox,@sbunch,@oq,@eq,@up,@tp)`,lp);
        detailKey=inserted.recordset?.[0]?.WdetailKey;
        if(!Number.isInteger(detailKey)||detailKey<=0)throw receiptError('DETAIL_READBACK_FAILED','상세 입고키를 확인하지 못했습니다.');
        delta.set(line.prodKey,(delta.get(line.prodKey)||0)+line.outQuantity);
      }
      lineMappings.push({lineId:line.lineId,wdetailKey:detailKey,prodKey:line.prodKey,outQuantity:line.outQuantity,unit:line.outUnit,
        boxQuantity:line.boxQuantity??null,bunchQuantity:line.bunchQuantity??null,stemQuantity:line.stemQuantity??null,
        unitPrice:line.unitPrice,lineAmount:line.lineAmount});
    }
    for(const [pk,quantity] of [...delta].sort((a,b)=>a[0]-b[0])){
      if(Math.abs(quantity)<0.0000001)continue;
      const stockReadback=await tQuery(`DECLARE @before float;
        SELECT @before=ISNULL(Stock,0) FROM dbo.Product WITH (UPDLOCK,HOLDLOCK) WHERE ProdKey=@pk AND isDeleted=0;
        INSERT dbo.StockHistory (ChangeDtm,OrderYear,OrderWeek,ChangeID,ChangeType,ColumName,BeforeValue,AfterValue,Descr,ProdKey)
        SELECT GETDATE(),@year,@week,@actor,N'입고',N'수량',ISNULL(Stock,0),ISNULL(Stock,0)+@delta,LEFT(N'웹 인보이스 입고 · '+@reason,500),ProdKey
        FROM dbo.Product WITH (UPDLOCK,HOLDLOCK) WHERE ProdKey=@pk AND isDeleted=0;
        IF @@ROWCOUNT<>1 THROW 51066,'INVOICE_PRODUCT_CHANGED',1;
        UPDATE dbo.Product SET Stock=ISNULL(Stock,0)+@delta WHERE ProdKey=@pk AND isDeleted=0;
        IF @@ROWCOUNT<>1 THROW 51066,'INVOICE_PRODUCT_CHANGED',1;
        SELECT Stock ActualStock,@before+@delta ExpectedStock FROM dbo.Product WHERE ProdKey=@pk;`,
        {...p,pk:param(types.Int,pk),delta:param(types.Float,quantity)});
      const stockRow=stockReadback.recordset?.[0];
      if(!stockRow||!Number.isFinite(stockRow.ActualStock)||!Number.isFinite(stockRow.ExpectedStock)||Math.abs(stockRow.ActualStock-stockRow.ExpectedStock)>0.000001)
        throw receiptError('STOCK_READBACK_FAILED','입고 반영 후 품목 재고가 예상 차액과 다릅니다.');
    }
    const changedProdKeys=[...delta].filter(([,quantity])=>Math.abs(quantity)>=0.0000001).map(([key])=>key);
    let stockReadback=null;
    if(changedProdKeys.length){
      await calculateInvoiceStock(tQuery,types,transactionParams,doc,actor);
      stockReadback=await verifyInvoiceStockReadback(tQuery,types,doc,changedProdKeys);
    }
    const headerRows=(await tQuery(`SELECT WarehouseKey,OrderYear,OrderWeek,FarmName,InvoiceNo,OrderNo,
      CONVERT(varchar(10),InputDate,23) InputDate,GrossWeight,ChargeableWeight,FreightRateUSD,DocFeeUSD,isDeleted
      FROM dbo.WarehouseMaster WHERE WarehouseKey=@wk`,p)).recordset;
    const details=(await tQuery(`SELECT WdetailKey,ProdKey,BoxQuantity,BunchQuantity,SteamQuantity,OutQuantity,EstQuantity,UPrice,TPrice
      FROM dbo.WarehouseDetail WHERE WarehouseKey=@wk ORDER BY WdetailKey`,p)).recordset;
    if(headerRows?.length!==1||details?.length!==lineMappings.length)throw receiptError('RECEIPT_READBACK_FAILED','저장 후 원장 행 수가 일치하지 않습니다.');
    const savedHeader=headerRows[0];
    if(savedHeader.OrderYear!==doc.orderYear||savedHeader.OrderWeek!==doc.orderWeek||savedHeader.FarmName!==preview.farmName
      ||savedHeader.InvoiceNo!==doc.invoiceNo||savedHeader.OrderNo!==(meta.awb||'')||savedHeader.InputDate!==meta.inputDate
      ||!active(savedHeader.isDeleted)||[['GrossWeight','gw'],['ChargeableWeight','cw'],['FreightRateUSD','freightRate'],['DocFeeUSD','docFee']]
        .some(([field,input])=>meta[input]==null?savedHeader[field]!=null:!Number.isFinite(savedHeader[field])||Math.abs(savedHeader[field]-meta[input])>0.000001))
      throw receiptError('RECEIPT_READBACK_FAILED','저장한 차수·인보이스·중량·운송비가 입고 원장과 다릅니다. 숫자 자릿수를 확인하세요.');
    for(const [index,mapping] of lineMappings.entries()){
      const actual=details.find(d=>d.WdetailKey===mapping.wdetailKey),expected=preview.lines[index];
      if(!actual||actual.ProdKey!==mapping.prodKey||[['BoxQuantity','boxQuantity'],['BunchQuantity','bunchQuantity'],['SteamQuantity','stemQuantity'],['OutQuantity','outQuantity'],['EstQuantity','estQuantity'],['UPrice','unitPrice'],['TPrice','lineAmount']].some(([a,b])=>expected[b]==null?actual[a]!=null:!Number.isFinite(actual[a])||Math.abs(actual[a]-expected[b])>0.000001))
        throw receiptError('RECEIPT_READBACK_FAILED','저장한 수량·가격이 원장과 다릅니다.');
    }
    const costStatus=preview.editingWarehouseKey?'STALE':'PENDING';
    p.costStatus=param(types.NVarChar,costStatus);
    const result={operationId,documentId,revision,warehouseKey:wk,lineMappings,costStatus,
      receiptDigest:hash({header:headerRows[0],details}),receiptSnapshot:{header:headerRows[0],details},
      reconciliation:preview.reconciliation,stockReadback,erpWritePerformed:true};
    p.result=param(types.NVarChar,JSON.stringify(result));
    await tQuery(`${receiptTransactionCheckSql}
      UPDATE dbo.WebInvoiceOperation SET Status=N'COMMITTED',WarehouseKey=@wk,ResultJson=@result,CompletedAt=SYSUTCDATETIME() WHERE OperationId=@op AND Status=N'PENDING';
      IF @@ROWCOUNT<>1 THROW 51066,'INVOICE_OPERATION_CHANGED',1;
      UPDATE dbo.WebInvoiceDocument SET ReceiptStatus=N'COMMITTED',CostStatus=@costStatus,UpdatedBy=@actor,UpdatedAt=SYSUTCDATETIME() WHERE DocumentId=@id AND Revision=@revision;
      IF @@ROWCOUNT<>1 THROW 51066,'INVOICE_DOCUMENT_CHANGED',1;
      UPDATE dbo.WebInvoiceCostRevision SET Status=N'STALE' WHERE DocumentId=@id AND Status<>N'STALE';
      INSERT dbo.WebInvoiceHistory(DocumentId,Revision,OperationId,Action,AfterJson,Reason,Actor,CreatedAt)
        VALUES(@id,@revision,@op,@action,@result,@reason,@actor,SYSUTCDATETIME());`,{...p,...transactionParams});
    return result;
  },{retries:0});
}
