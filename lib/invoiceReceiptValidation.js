import { allocationIssues } from './invoiceProductAllocation.js';
import { resolveReceiptBunch } from './receiptBunchQuantity.js';
import { hasReceiptFarmSource } from './invoiceFarmSource.js';
import { nzConfirmedBunchQuantity } from './nzReceiptUnits.js';
const quantityFields={'박스':'boxQuantity','단':'bunchQuantity','송이':'stemQuantity'};
export function validateInvoiceReceiptLines(document, products, {requireNzSourceEvidence=false} = {}) {
  const issues=allocationIssues(document,products), lines=[];
  const issue=(code,message,lineId=null)=>issues.push({code,message,lineId});
  const finite=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<1e10;
  // Historical cost previews work from saved ERP quantities, not a new PDF.
  // The receipt writer opts in for every NZ receipt preflight and transaction.
  const nz = requireNzSourceEvidence && document.reviewedMetadata?.country==='NZ';
  for(const line of document.lines||[]) {
    const p=products.find(p=>p.ProdKey===line.prodKey);
    if(!p || ![0,false].includes(p.isDeleted)) { issue('PRODUCT_REQUIRED','활성 전산 품목을 선택하세요.',line.lineId); continue; }
    const outUnit=String(p.OutUnit||'').trim(),estUnit=String(p.EstUnit||'').trim();
    if(!quantityFields[outUnit]||!quantityFields[estUnit]) {issue('UNIT_CONVERSION_REQUIRED','전산 출고·견적 단위를 확인하세요.',line.lineId);continue;}
    const values={...line};
    if (nz) {
      const conversion=nzConfirmedBunchQuantity(line);
      if(conversion.provided){
        if(conversion.quantity==null||line.bunchQuantity!=null&&line.bunchQuantity!==conversion.quantity)
          issue('NZ_BUNCH_RATIO_CONFLICT','송이/단 근거와 총 단 수량을 확인하세요. 정수 단수로 나누어지고 기존 총 단과 일치해야 합니다.',line.lineId);
        else values.bunchQuantity=conversion.quantity;
      }
      const reason=line.reviewed?.nzUnitReason;
      const expected=line.sourceEvidence?.nzPrintedUnits;
      const allowedUnit=['단','송이'].includes(line.priceUnit);
      if (!finite(expected)||expected<=0||!allowedUnit||line[quantityFields[line.priceUnit]]!==expected
        ||typeof reason!=='string'||!reason.trim()||reason.length>250)
        issue('NZ_UNITS_EVIDENCE_REQUIRED','원문 Units에 해당하는 단 또는 송이 수량·단가 기준과 근거를 직접 확인하세요.',line.lineId);
      const hasExactPrintedValue=field=>{
        const value=line.sourceEvidence?.sourceFieldStates?.[field]?.rawValue;
        return value!=null&&String(value).trim()!==''&&Number(String(value).replaceAll(',',''))===line[field];
      };
      if (document.rawMetadata?.currency!=='NZD'||line.currency!=='NZD'
        || !['boxQuantity','unitPrice','lineAmount'].every(hasExactPrintedValue))
        issue('NZ_SOURCE_VALUES_CHANGED','NZD·박스·단가·금액은 인보이스 원문과 같아야 합니다.',line.lineId);
    }
    const sourceScoped = ['EC', 'US'].includes(document.reviewedMetadata?.country);
    if (sourceScoped) {
      const resolution = resolveReceiptBunch(p, {
        ...values, stemsPerBunch:line.sourceEvidence?.packing?.stemsPerBunch,
        stemsPerBox:line.sourceEvidence?.packing?.stemsPerBox,
        bunchesPerBox:line.sourceEvidence?.packing?.bunchesPerBox,
        confirmation:line.reviewed?.bunchConfirmation,
        scopeKey:[document.documentId, document.sourceHash, document.orderYear, document.orderWeek,
          document.reviewedMetadata?.country, document.reviewedMetadata?.inputDate, line.lineId],
      });
      if (resolution.status === 'review') issues.push({
        code:'BUNCH_QUANTITY_REQUIRED', message:`${p.ProdName} · ${resolution.message}`,
        lineId:line.lineId, candidates:resolution.candidates, snapshot:resolution.snapshot,
      });
      if (resolution.status === 'derived' || resolution.status === 'confirmed') {
        values.bunchQuantity = resolution.quantity;
        values.bunchResolution = resolution.status;
      }
    }
    const factors={boxQuantity:Number(p.SteamOf1Box),bunchQuantity:Number(p.SteamOf1Bunch),stemQuantity:1};
    // Explicit invoice quantities take precedence. Only missing values may use positive DB ratios.
    const source=Object.keys(factors).find(k=>finite(values[k])&&values[k]>0&&factors[k]>0)
      ||Object.keys(factors).find(k=>finite(values[k])&&factors[k]>0);
    if(source&&!nz) for(const k of Object.keys(factors)) if(values[k]==null&&factors[k]>0&&!(sourceScoped&&k==='bunchQuantity'))
      values[k]=Math.round(values[source]*factors[source]/factors[k]*1e6)/1e6;
    const bunchesPerBox=Number(p.BunchOf1Box);
    if(!nz&&bunchesPerBox>0&&Number.isFinite(bunchesPerBox)){
      if(values.boxQuantity==null&&finite(values.bunchQuantity))values.boxQuantity=Math.round(values.bunchQuantity/bunchesPerBox*1e6)/1e6;
      if(!sourceScoped&&values.bunchQuantity==null&&finite(values.boxQuantity))values.bunchQuantity=Math.round(values.boxQuantity*bunchesPerBox*1e6)/1e6;
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
    const coStemsPerBox=document.reviewedMetadata?.country==='CO'?Number(line.sourceEvidence?.packing?.stemsPerBox):NaN;
    if(Number.isFinite(coStemsPerBox)&&coStemsPerBox>0&&finite(values.boxQuantity)&&values.boxQuantity>0
      &&finite(values.stemQuantity)&&values.stemQuantity>0
      &&Math.abs(values.boxQuantity*coStemsPerBox-values.stemQuantity)>0.02
      &&line.reviewed?.conversionConfirmed!==true)
      issue('BOX_STEM_PACKING_MISMATCH',`박스 수량(${values.boxQuantity})×박스당 송이수(${coStemsPerBox})가 총 송이수(${values.stemQuantity})와 다릅니다. 원문 박스(PCS) 수량을 확인하세요.`,line.lineId);
    // Contract gives physical quantities only in the printed unit. Native
    // Out/Est projections above may use Product ratios; never invent source boxes
    // or a stem count for a weight-only bunch when persisting the physical fields.
    if(document.rawMetadata?.sourceFormat==='china_cloud_contract_xlsx')for(const k of Object.keys(factors))values[k]=line[k]??null;
    lines.push({...values,prodName:p.ProdName,outUnit,estUnit,outQuantity,estQuantity,
      steamOf1Box:values.boxQuantity>0&&values.stemQuantity!=null?values.stemQuantity/values.boxQuantity:(factors.boxQuantity>0?factors.boxQuantity:null),
      steamOf1Bunch:values.bunchQuantity>0&&values.stemQuantity!=null?values.stemQuantity/values.bunchQuantity:(!nz&&factors.bunchQuantity>0?factors.bunchQuantity:null)});
  }
  if(!document.lines?.length)issue('RECEIPT_LINES_REQUIRED','입고 품목이 없습니다.');
  const meta=document.reviewedMetadata||{};
  if(document.rawMetadata?.sourceContract?.referenceRequired===true&&(!meta.contractReferenceConfirmation?.confirmed||!['ACTUAL_INVOICE','REFERENCE'].includes(meta.contractReferenceConfirmation.kind)||meta.contractReferenceConfirmation.reference!==document.invoiceNo))issue('CONTRACT_REFERENCE_REQUIRED','원문에 송장번호가 없습니다. 사용자 확인 실제 송장번호 또는 임시 참조번호의 근거를 선택하세요.');
  const date=String(meta.inputDate||'');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))
    ||new Date(date).toISOString().slice(0,10)!==date)issue('INPUT_DATE_REQUIRED','실제 입고일을 입력하세요.');
  else if(date.slice(0,4)!==String(document.orderYear))issue('SOURCE_YEAR_CONFLICT','입고일과 선택 연도가 다릅니다. 연도를 확인하세요.');
  if((!Number.isInteger(document.farmKey)||document.farmKey<=0)&&!hasReceiptFarmSource(document))issue('FARM_REQUIRED','농장 마스터 또는 기존 입고의 공급 농장을 선택하세요.');
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
