const quantityFields={'박스':'boxQuantity','단':'bunchQuantity','송이':'stemQuantity'};
export function validateInvoiceReceiptLines(document, products) {
  const issues=[], lines=[];
  const issue=(code,message,lineId=null)=>issues.push({code,message,lineId});
  const finite=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<1e10;
  for(const line of document.lines||[]) {
    const p=products.find(p=>p.ProdKey===line.prodKey);
    if(!p || ![0,false].includes(p.isDeleted)) { issue('PRODUCT_REQUIRED','활성 전산 품목을 선택하세요.',line.lineId); continue; }
    const outUnit=String(p.OutUnit||'').trim(),estUnit=String(p.EstUnit||'').trim();
    if(!quantityFields[outUnit]||!quantityFields[estUnit]) {issue('UNIT_CONVERSION_REQUIRED','전산 출고·견적 단위를 확인하세요.',line.lineId);continue;}
    const values={...line};
    const factors={boxQuantity:Number(p.SteamOf1Box),bunchQuantity:Number(p.SteamOf1Bunch),stemQuantity:1};
    // Explicit invoice quantities take precedence. Only missing values may use positive DB ratios.
    const source=Object.keys(factors).find(k=>finite(values[k])&&values[k]>0&&factors[k]>0)
      ||Object.keys(factors).find(k=>finite(values[k])&&factors[k]>0);
    if(source) for(const k of Object.keys(factors)) if(values[k]==null&&factors[k]>0)
      values[k]=Math.round(values[source]*factors[source]/factors[k]*1e6)/1e6;
    const bunchesPerBox=Number(p.BunchOf1Box);
    if(bunchesPerBox>0&&Number.isFinite(bunchesPerBox)){
      if(values.boxQuantity==null&&finite(values.bunchQuantity))values.boxQuantity=Math.round(values.bunchQuantity/bunchesPerBox*1e6)/1e6;
      if(values.bunchQuantity==null&&finite(values.boxQuantity))values.bunchQuantity=Math.round(values.boxQuantity*bunchesPerBox*1e6)/1e6;
    }
    for(const k of Object.keys(factors)) if(values[k]!=null&&!finite(values[k])) issue('QUANTITY_INVALID','수량 범위를 확인하세요.',line.lineId);
    const outQuantity=values[quantityFields[outUnit]],estQuantity=values[quantityFields[estUnit]];
    if(!finite(outQuantity)||!finite(estQuantity)) issue('UNIT_CONVERSION_REQUIRED','출고·견적 단위 수량을 직접 입력하거나 품목 환산값을 확인하세요.',line.lineId);
    if(!quantityFields[line.priceUnit]||!finite(values[quantityFields[line.priceUnit]])) issue('PRICE_UNIT_REQUIRED','단가 기준 단위와 해당 수량을 확인하세요.',line.lineId);
    if(!finite(line.unitPrice)||!finite(line.lineAmount)) issue('PRICE_REQUIRED','단가와 금액을 확인하세요. 미인식 값을 0으로 저장하지 않습니다.',line.lineId);
    if(!/^[A-Z]{3}$/.test(line.currency||'')) issue('CURRENCY_REQUIRED','원본 인보이스 통화를 입력하세요.',line.lineId);
    const pricedQty=values[quantityFields[line.priceUnit]];
    if(finite(pricedQty)&&finite(line.unitPrice)&&finite(line.lineAmount)
      &&Math.abs(pricedQty*line.unitPrice-line.lineAmount)>0.02)
      issue('INVOICE_AMOUNT_MISMATCH','수량×단가와 금액이 다릅니다. 원본을 확인하세요.',line.lineId);
    lines.push({...values,prodName:p.ProdName,outUnit,estUnit,outQuantity,estQuantity,
      steamOf1Box:values.boxQuantity>0&&values.stemQuantity!=null?values.stemQuantity/values.boxQuantity:(factors.boxQuantity>0?factors.boxQuantity:null),
      steamOf1Bunch:values.bunchQuantity>0&&values.stemQuantity!=null?values.stemQuantity/values.bunchQuantity:(factors.bunchQuantity>0?factors.bunchQuantity:null)});
  }
  if(!document.lines?.length)issue('RECEIPT_LINES_REQUIRED','입고 품목이 없습니다.');
  const meta=document.reviewedMetadata||{};
  const date=String(meta.inputDate||'');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))
    ||new Date(date).toISOString().slice(0,10)!==date)issue('INPUT_DATE_REQUIRED','실제 입고일을 입력하세요.');
  else if(date.slice(0,4)!==String(document.orderYear))issue('SOURCE_YEAR_CONFLICT','입고일과 선택 연도가 다릅니다. 연도를 확인하세요.');
  if(!Number.isInteger(document.farmKey)||document.farmKey<=0)issue('FARM_REQUIRED','등록된 공급 농장을 선택하세요.');
  if(!String(document.invoiceNo||'').trim()||document.invoiceNo.length>50)issue('INVOICE_NO_REQUIRED','인보이스 번호는 1~50자로 입력하세요.');
  if(!/^\d{4}$/.test(document.invoiceYear||''))issue('INVOICE_YEAR_REQUIRED','인보이스 발행 연도를 확인하세요.');
  if(String(meta.awb||'').length>50)issue('AWB_INVALID','AWB는 50자 이내로 입력하세요.');
  for(const k of ['gw','cw','freightRate','docFee'])if(meta[k]!=null&&meta[k]!==''&&!finite(meta[k]))issue('METADATA_NUMBER_INVALID',`${k} 숫자를 확인하세요.`);
  for(const k of ['gw','cw','freightRate','docFee'])if(meta[k]!=null&&meta[k]!==''){
    const scale=k==='freightRate'?4:2, factor=10**scale, value=meta[k];
    if(finite(value)&&(value>=10**(10-scale)||Math.abs(value*factor-Math.round(value*factor))>0.000001))
      issue('METADATA_PRECISION_INVALID',`${k} 값은 운영 원장 기준 소수 ${scale}자리와 정수 ${10-scale}자리 이내로 입력하세요.`);
  }
  if((meta.freightRate!=null||meta.docFee!=null)&&meta.freightCurrency!=='USD')
    issue('FREIGHT_CURRENCY_REQUIRED','ERP 운송료 헤더는 USD입니다. 원문 통화가 다른 비용은 원가 검토에서 별도로 기록하세요.');
  return {issues,lines};
}
