import { INCOMING_APPROVAL_KIND } from './incomingApprovalPolicy.js';

const columns = { invoiceNo: 'InvoiceNo', awb: 'OrderNo' };
const failure = (code, message, status = 409) => Object.assign(new Error(message), { code, status });
const string = value => typeof value === 'string' ? value : '';
const normInvoice = value => string(value).normalize('NFKC').trim().toLowerCase();
const normAwb = value => normInvoice(value).replace(/[\s\p{Dash_Punctuation}]+/gu, '');
const parameter = (type, value) => ({ type, value });

export function warehouseIdentityScope(input) {
  const warehouseKey = Number(input.warehouseKey);
  const orderYear = string(input.orderYear);
  const orderWeek = string(input.orderWeek);
  const field = string(input.field);
  if (!Number.isInteger(warehouseKey) || warehouseKey <= 0 || warehouseKey > 2147483647 ||
      !/^20\d{2}$/.test(orderYear) || !/^(?:0[1-9]|[1-4]\d|5[0-3])-(?:0[1-9]|[1-9]\d)$/.test(orderWeek) ||
      !Object.hasOwn(columns,field)) throw failure('WAREHOUSE_IDENTITY_SCOPE','입고 연도·차수와 수정할 번호를 확인하세요.',400);
  return { warehouseKey, orderYear, orderWeek, field };
}

function requestedNumber(field,value) {
  const next=string(value).trim();
  if (!next || next.length > 50 || /\p{Cc}/u.test(next) || field==='awb' && !/^[\p{L}\p{N}][\p{L}\p{N}\s\p{Dash_Punctuation}/.]*$/u.test(next)) {
    throw failure('WAREHOUSE_IDENTITY_VALUE','번호를 1~50자로 입력하세요. AWB에는 운송장 번호를 입력하세요.',400);
  }
  return next;
}

const reasons = {
  DOCUMENT:'이 입고에는 웹 인보이스 문서가 연결되어 있습니다.',
  COST:'이 입고에는 저장된 운임 또는 도착원가 기록이 있습니다.',
  DECLARATION:'이 차수에는 저장된 통관·포워딩 작업이 있습니다.',
  PROFIT:'이 차수 이후에 연결될 수 있는 확정 손익이 있습니다.',
  CORRECTION:'이 입고는 정정 요청을 처리 중입니다.',
};

const headerSelect = hint => `SELECT WarehouseKey,OrderYear,OrderWeek,FarmName,InvoiceNo,OrderNo
  FROM dbo.WarehouseMaster ${hint}
  WHERE WarehouseKey=@warehouseKey AND OrderYear=@year AND OrderWeek=@week AND isDeleted=0`;

export async function inspectWarehouseIdentity(query, types, input, {locked = false, next = null} = {}) {
  const scope = warehouseIdentityScope(input);
  const hint = locked ? 'WITH (UPDLOCK,HOLDLOCK)' : '';
  const params = {
    warehouseKey:parameter(types.Int,scope.warehouseKey),year:parameter(types.NVarChar,scope.orderYear),
    week:parameter(types.NVarChar,scope.orderWeek),major:parameter(types.NVarChar,scope.orderWeek.slice(0,2)),
    target:parameter(types.NVarChar,`receipt:${scope.warehouseKey}`),kind:parameter(types.NVarChar,INCOMING_APPROVAL_KIND),
  };
  const headers=(await query(`/* warehouse-identity:header */ ${headerSelect(hint)}`,params)).recordset;
  if (headers.length!==1) throw failure('WAREHOUSE_IDENTITY_NOT_FOUND','선택한 입고가 변경되었거나 삭제되었습니다.',404);
  const header=headers[0];
  const value=header[columns[scope.field]];
  const invoiceNo=normInvoice(scope.field==='invoiceNo'&&next!==null?next:header.InvoiceNo);
  const awbKeys=new Set([
    normAwb(header.OrderNo),
    normAwb(scope.field==='awb'?next:header.OrderNo),
    ...[header.InvoiceNo,scope.field==='invoiceNo'?next:null].map(normAwb).filter(key=>/^\d{11}$/.test(key)),
  ].filter(Boolean));
  const checkAwb=scope.field==='awb'||[header.InvoiceNo,next].some(key=>/^\d{11}$/.test(normAwb(key)));
  params.farm=parameter(types.NVarChar,header.FarmName);
  params.checkAwb=parameter(types.Bit,checkAwb?1:0);
  const linked=await query(`/* warehouse-identity:links */
    SELECT 'DOCUMENT' Code WHERE EXISTS(SELECT 1 FROM dbo.WebInvoiceOperation ${hint} WHERE WarehouseKey=@warehouseKey)
    UNION ALL SELECT 'COST' WHERE EXISTS(SELECT 1 FROM dbo.WebInvoiceCostRevision ${hint} WHERE WarehouseKey=@warehouseKey)
      OR EXISTS(SELECT 1 FROM dbo.FreightCost ${hint} WHERE WarehouseKey=@warehouseKey)
      OR EXISTS(SELECT 1 FROM dbo.FreightCostDetail fd ${hint}
        JOIN dbo.WarehouseDetail wd ${hint} ON wd.WdetailKey=fd.WarehouseDetailKey WHERE wd.WarehouseKey=@warehouseKey)
      OR EXISTS(SELECT 1 FROM dbo.WebArrivalCostLine c ${hint} WHERE c.OrderYear=@year AND c.OrderWeek=@week AND c.IsCurrent=1
        AND (c.FarmNameRaw=@farm OR EXISTS(SELECT 1 FROM dbo.WarehouseDetail wd ${hint} WHERE wd.WarehouseKey=@warehouseKey AND wd.ProdKey=c.ProdKey)))
    UNION ALL SELECT 'DECLARATION' WHERE @checkAwb=1 AND (
      EXISTS(SELECT 1 FROM dbo.WebCustomsWeekly ${hint} WHERE OrderYear=@year AND TRY_CONVERT(int,MajorWeek)=TRY_CONVERT(int,@major))
      OR EXISTS(SELECT 1 FROM dbo.WebForwardingWeekly ${hint} WHERE OrderYear=@year AND TRY_CONVERT(int,MajorWeek)=TRY_CONVERT(int,@major))
      OR EXISTS(SELECT 1 FROM dbo.WebColombiaWeekly ${hint} WHERE OrderYear=@year AND OrderWeek=@week))
    UNION ALL SELECT 'PROFIT' WHERE EXISTS(SELECT 1 FROM dbo.WebProfitReportConfirm ${hint} WHERE IsActive=1 AND
      (OrderYear>@year OR (OrderYear=@year AND TRY_CONVERT(int,MajorWeek)>=TRY_CONVERT(int,@major))))
    UNION ALL SELECT 'CORRECTION' WHERE EXISTS(SELECT 1 FROM web_mgmt.ApprovalRequest ${hint}
      WHERE TargetKind=@kind AND TargetRef=@target AND Status IN(N'draft',N'requested',N'reviewing'));
    SELECT InvoiceNo,OrderNo,FarmName,OrderWeek FROM dbo.WarehouseMaster ${hint}
      WHERE OrderYear=@year AND WarehouseKey<>@warehouseKey AND isDeleted=0
        AND (FarmName=@farm OR (@checkAwb=1 AND LEFT(OrderWeek,2)=@major));
    SELECT d.InvoiceNo,f.FarmName,d.OrderWeek,
      JSON_VALUE(CASE WHEN ISJSON(d.ReviewedMetadataJson)=1 THEN d.ReviewedMetadataJson ELSE N'{}' END,N'$.awb') Awb
      FROM dbo.WebInvoiceDocument d ${hint}
      LEFT JOIN dbo.Farm f ${hint} ON f.FarmKey=d.FarmKey
      WHERE d.OrderYear=@year AND (f.FarmName=@farm OR (d.FarmKey IS NULL AND d.OrderWeek=@week)
        OR (@checkAwb=1 AND LEFT(d.OrderWeek,2)=@major));
    SELECT Awb,InvoiceNo,@farm FarmName FROM dbo.WebForwarderInvoice ${hint}
      WHERE OrderYear=@year AND LEFT(OrderWeek,2)=@major AND isDeleted=0
    UNION ALL SELECT Awb,InvoiceNo,FarmName FROM dbo.WebImportPivotAdj ${hint}
      WHERE OrderYear=@year AND LEFT(OrderWeek,2)=@major AND isDeleted=0;
  `,params);
  if (linked.recordsets?.length!==4) throw failure('WAREHOUSE_IDENTITY_LINK_READ','입고 번호 연결을 확인하지 못했습니다.',503);
  const [links,receipts,documents,records]=linked.recordsets;
  const issues=links.map(({Code})=>({code:Code,message:reasons[Code]}));
  if ([normInvoice(header.InvoiceNo),invoiceNo].some(number=>number&&documents.some(doc=>normInvoice(doc.InvoiceNo)===number&&
      (normInvoice(doc.FarmName)===normInvoice(header.FarmName)||(doc.FarmName==null&&doc.OrderWeek===scope.orderWeek))))) {
    issues.push({code:'DOCUMENT',message:reasons.DOCUMENT});
  }
  if (scope.field==='invoiceNo'&&next!==null&&receipts.some(row=>normInvoice(row.FarmName)===normInvoice(header.FarmName)&&normInvoice(row.InvoiceNo)===invoiceNo)) {
    issues.push({code:'DUPLICATE_INVOICE',message:'같은 연도·농장에 같은 인보이스 번호가 있습니다.'});
  }
  const sameMajor=row=>string(row.OrderWeek).startsWith(scope.orderWeek.slice(0,2));
  if (checkAwb&&(receipts.some(row=>sameMajor(row)&&
      [row.OrderNo,...(/^\d{11}$/.test(normAwb(row.InvoiceNo))?[row.InvoiceNo]:[])].some(key=>awbKeys.has(normAwb(key))))||
      documents.some(doc=>sameMajor(doc)&&awbKeys.has(normAwb(doc.Awb))))) {
    issues.push({code:'SHARED_AWB',message:'같은 대차수에 연결된 공동 AWB가 있습니다. 도착원가 작업에서 검토하세요.'});
  }
  if (records.some(row=>(normInvoice(row.FarmName)===normInvoice(header.FarmName)&&
       [normInvoice(header.InvoiceNo),invoiceNo].includes(normInvoice(row.InvoiceNo))&&normInvoice(row.InvoiceNo))||
      (checkAwb&&awbKeys.has(normAwb(row.Awb))))) {
    issues.push({code:'FORWARDER',message:'인보이스 또는 AWB에 포워딩·조정 기록이 있습니다.'});
  }
  return { scope, header, value, params, issues:[...new Map(issues.map(issue=>[issue.code,issue])).values()] };
}

export async function updateWarehouseIdentity(query,types,input,actor) {
  const {field}=warehouseIdentityScope(input);
  const value=requestedNumber(field,input.value);
  const result=await inspectWarehouseIdentity(query,types,input,{locked:true,next:value});
  if (result.header.InvoiceNo!==input.expectedInvoiceNo||result.header.OrderNo!==input.expectedAwb) {
    throw failure('WAREHOUSE_IDENTITY_STALE','다른 작업에서 번호가 변경되었습니다. 다시 조회하세요.');
  }
  if(result.issues.length) return {issues:result.issues};
  if(result.value===value) return {header:result.header,unchanged:true};
  const updated=await query(`/* warehouse-identity:update */ UPDATE dbo.WarehouseMaster SET
    ${columns[field]}=@value,LastUpdateID=@actor,LastUpdateDtm=GETDATE()
    OUTPUT INSERTED.WarehouseKey,INSERTED.OrderYear,INSERTED.OrderWeek,INSERTED.InvoiceNo,INSERTED.OrderNo
    WHERE WarehouseKey=@warehouseKey AND OrderYear=@year AND OrderWeek=@week AND isDeleted=0`,{
    ...result.params,value:parameter(types.NVarChar,value),actor:parameter(types.NVarChar,actor),
  });
  const header=updated.recordset?.[0];
  const other=columns[field==='invoiceNo'?'awb':'invoiceNo'];
  if(updated.recordset?.length!==1||header.WarehouseKey!==result.scope.warehouseKey||
      header.OrderYear!==result.scope.orderYear||header.OrderWeek!==result.scope.orderWeek||
      header[columns[field]]!==value||header[other]!==result.header[other]) {
    throw failure('WAREHOUSE_IDENTITY_READBACK','저장된 입고 번호를 확인하지 못했습니다.',503);
  }
  return {header};
}
