import {completeReceiptCoverage,hasHistoricalMarginFx,reconstructProductCost} from './profitCustomerMargin.mjs';
import {computeProfitRow,computeProfitTotals,calcRevenueRatio,calcPurchaseRatio} from './profitReportCalc.js';

export const STEM_COST_VERSION='product-stem-wac-v1';
const number=v=>v===null||v===undefined||v===''||!Number.isFinite(Number(v))?null:Number(v);
const majorOf=r=>Number(String(r.OrderWeek).split('-')[0]);
const sumKnown=(rows,field)=>rows.every(r=>number(r[field])!==null)?rows.reduce((n,r)=>n+Number(r[field]),0):null;
const close=(a,b)=>Math.abs(a-b)<=Math.max(1e-6,Math.abs(b)*1e-8);
const round2=v=>Math.sign(v)*Math.round(Math.abs(v)*100+1e-9)/100;
const inScope=(row,year,major)=>String(row.OrderYear)===String(year)&&/^\d{1,2}-\d{1,2}$/.test(String(row.OrderWeek))&&majorOf(row)>=1&&majorOf(row)<=Number(major);

/** Historical line fields, not current Product packaging, are the conversion authority. */
export function historicalStemFactor(rows) {
  const ratios=[];
  for(const row of rows) {
    const out=number(row.OutQuantity),stems=number(row.SteamQuantity);
    if(out===0&&stems===0)continue;
    if(out===null||stems===null||out<=0||stems<=0)return {factor:null,reason:'역사 입출고 송이수 또는 출고단위 수량 누락·음수'};
    ratios.push(stems/out);
  }
  if(!ratios.length)return {factor:null,reason:'재고 단위의 역사 송이 환산 근거 없음'};
  if(ratios.some(v=>!close(v,ratios[0])))return {factor:null,reason:'동일 품목의 역사 송이/출고단위 비율 충돌'};
  return {factor:ratios[0],reason:null,evidenceRows:ratios.length,source:'HISTORICAL_LINE_STEMS_PER_OUT'};
}

export function stemCommodityDefined(product) {
  const units=[product.OutUnit,product.EstUnit].map(v=>String(v||'').trim().toUpperCase());
  const name=`${product.ProdName||''} ${product.DisplayName||''}`;
  return !units.some(v=>/^(KG|G|톤|킬로|그램|L|리터)$/.test(v))&&!/\d\s*(?:KG|G|킬로|그램)(?:\b|\s|$)/i.test(name);
}

export function prepareStemCostPeriods({year,major,products=[],headers=[],stocks=[],receipts=[],shipments=[],adjustments=[]}) {
  const scopedHeaders=headers.filter(r=>inScope(r,year,major));
  const latest=new Map();
  for(const h of scopedHeaders) {
    if(!(Number(h.ProductRows)>0))continue;
    const m=majorOf(h),minor=Number(String(h.OrderWeek).split('-')[1]),prior=latest.get(m);
    if(!prior||minor>prior.minor||(minor===prior.minor&&(h.ProductRows>prior.ProductRows||h.ProductRows===prior.ProductRows&&h.StockKey>prior.StockKey)))latest.set(m,{...h,minor});
  }
  const validKeys=new Set(scopedHeaders.map(r=>Number(r.StockKey))),index=new Map(),duplicates=new Set();
  for(const s of stocks.filter(r=>validKeys.has(Number(r.StockKey)))) {
    const key=`${s.StockKey}:${s.ProdKey}`;if(index.has(key))duplicates.add(key);index.set(key,number(s.Stock));
  }
  const plans=[],neededWeeks=new Set();
  const group=rows=>{const map=new Map();for(const r of rows)if(inScope(r,year,major)){const key=Number(r.ProdKey);if(!map.has(key))map.set(key,[]);map.get(key).push(r);}return map;};
  const receiptIndex=group(receipts),shipmentIndex=group(shipments),adjustmentIndex=group(adjustments);
  for(const product of products) {
    const pk=Number(product.ProdKey),rr=receiptIndex.get(pk)||[],ss=shipmentIndex.get(pk)||[],aa=adjustmentIndex.get(pk)||[];
    const stockAt=h=>!h?null:index.has(`${h.StockKey}:${pk}`)?index.get(`${h.StockKey}:${pk}`):null;
    let anchor=0;for(const [m,h]of latest)if(m<Number(major)&&stockAt(h)===0&&!duplicates.has(`${h.StockKey}:${pk}`))anchor=Math.max(anchor,m);
    const periods=[];
    for(let m=anchor||1;m<=Number(major);m++) {
      const h=latest.get(m),r=rr.filter(x=>majorOf(x)===m),s=ss.filter(x=>majorOf(x)===m),a=aa.filter(x=>majorOf(x)===m);
      const history=[...rr,...ss].filter(x=>majorOf(x)<=m&&majorOf(x)>(anchor||0));
      const factor=historicalStemFactor(history),endOut=stockAt(h),factorKnown=factor.factor>0;
      const end=endOut===0?0:endOut!==null&&factorKnown?endOut*factor.factor:null;
      const q=sumKnown(r,'SteamQuantity'),ship=sumKnown(s,'SteamQuantity'),adjustOut=sumKnown(a,'Quantity');
      const adjust=adjustOut===0?0:adjustOut!==null&&factorKnown?adjustOut*factor.factor:null;
      const rowUnits=stemCommodityDefined(product)&&r.every(x=>number(x.SteamQuantity)>0&&number(x.OutQuantity)>0)&&s.every(x=>number(x.SteamQuantity)>0&&number(x.OutQuantity)>0);
      const zeroAnchor=(m===anchor&&end===0)||(h&&end===0&&q===0&&ship===0&&adjust===0);
      const nativeSteps=[...new Set([...r,...s,...a].map(x=>x.OrderWeek))].map(week=>{
        const RawIn=sumKnown(r.filter(x=>x.OrderWeek===week),'OutQuantity'),RawOut=sumKnown(s.filter(x=>x.OrderWeek===week),'OutQuantity'),RawAdjust=sumKnown(a.filter(x=>x.OrderWeek===week),'Quantity');
        return {OrderYear:String(year),OrderWeek:week,RawIn,RawOut,RawAdjust,NativeIn:RawIn===null?null:round2(RawIn),NativeOut:RawOut===null?null:round2(RawOut),NativeAdjust:RawAdjust===null?null:round2(RawAdjust)};
      });
      periods.push({year:String(year),major:m,rows:r,product,sourceRefs:[],snapshotExists:!!h,duplicateStock:!!h&&duplicates.has(`${h.StockKey}:${pk}`),
        unitKnown:zeroAnchor||(factorKnown&&rowUnits),unitReason:stemCommodityDefined(product)?factor.reason:'중량·용량 상품은 실제 송이 정의 근거 확인 필요',stemFactor:factor,
        nativeFactor:factor.factor,nativeSteps,
        endQuantity:end,endDisplayQuantity:endOut,receiptQuantity:q,shipQuantity:ship,adjustmentQuantity:adjust,
        hasPositiveAdjustment:a.some(x=>number(x.Quantity)>0),receiptComplete:r.length===0,receiptAmount:r.length===0?0:null});
    }
    if(rr.length||ss.length||aa.length||[...latest.values()].some(h=>index.has(`${h.StockKey}:${pk}`))){
      plans.push({product,periods,anchor});
      // No cost query can repair a missing physical unit/snapshot or unpriced positive
      // adjustment after the latest valid zero anchor. Keep those products held.
      if(periods.every(p=>p.snapshotExists&&p.unitKnown&&!p.duplicateStock&&!p.hasPositiveAdjustment))
        for(const p of periods.filter(p=>p.major>anchor))for(const row of p.rows)neededWeeks.add(String(row.OrderWeek));
    }
  }
  return {plans,neededWeeks:[...neededWeeks].sort((a,b)=>majorOf({OrderWeek:a})-majorOf({OrderWeek:b})||a.localeCompare(b))};
}

export function validatedStemReceiptAmount(rows,lines) {
  if(!Array.isArray(lines)||lines.length!==rows.length||!rows.length)return null;
  const seen=new Set();let amount=0;
  for(const row of rows) {
    const key=Number(row.WdetailKey),matches=lines.filter(x=>x&&Number(x.warehouseDetailKey)===key);
    if(!Number.isSafeInteger(key)||key<=0||seen.has(key)||matches.length!==1)return null;
    seen.add(key);const line=matches[0];
    if(Number(line.prodKey)!==Number(row.ProdKey)||line.quantitySource!=='db'
      ||!(number(line.stems)>0)||!close(Number(line.stems),Number(row.SteamQuantity))
      ||number(line.goodsAmount)===null||number(row.TPrice)===null||!close(Number(line.goodsAmount),Number(row.TPrice))
      ||number(line.landedAmount)===null||Number(line.landedAmount)<0
      ||(line.calculatedStems!==undefined&&!close(Number(line.calculatedStems),Number(row.SteamQuantity))))return null;
    amount+=Number(line.landedAmount);
  }
  return amount;
}

export function calculateStemProductCosts(prepared,arrivalEvidenceByWeek,scope) {
  return prepared.plans.map(({product,periods,anchor})=>{
    const evaluated=periods.map(period=>{
      const p={...period,sourceRefs:[],receiptReasons:[]};if(!p.rows.length)return p;
      let amount=0,complete=true,estimated=false;
      for(const week of new Set(p.rows.map(r=>String(r.OrderWeek)))) {
        const rows=p.rows.filter(r=>String(r.OrderWeek)===week),e=arrivalEvidenceByWeek?.[week]?.[product.ProdKey],out=sumKnown(rows,'OutQuantity');
        const stems=sumKnown(rows,'SteamQuantity');
        const lineAmounts=validatedStemReceiptAmount(rows,e?.stemCostLines);
        const valid=e&&!e.goodsCostMissing&&hasHistoricalMarginFx(e)&&lineAmounts!==null
          &&out>0&&stems>0&&completeReceiptCoverage(e,rows.map(r=>r.WdetailKey),out)
          &&e.unit===product.OutUnit&&rows.every(r=>number(r.TPrice)!==null&&Number(r.TPrice)>=0&&number(r.SteamQuantity)>0);
        if(!valid){complete=false;p.receiptReasons.push(`${week}: 입고 원문 전체·송이수·도착원가·역사 환율 연결 확인 필요`);continue;}
        // Exact physical source-line money is preserved; display prices are not cost inputs.
        amount+=lineAmounts;estimated ||= e.estimated===true;p.sourceRefs.push(...(e.sourceRefs||[]));
      }
      p.receiptComplete=complete;p.receiptAmount=complete?amount:null;p.estimated=estimated;return p;
    });
    const target=evaluated.find(p=>Number(p.major)===Number(scope.major));
    const cost=reconstructProductCost({product:{...product,EstUnit:'송이'},periods:evaluated,targetMajor:scope.major,orderYear:scope.year});
    const zeroEnd=target?.snapshotExists&&target.endQuantity===0&&!target.duplicateStock;
    const noActivity=cost.openingQuantity===0&&zeroEnd&&target.receiptQuantity===0&&target.shipQuantity===0&&target.adjustmentQuantity===0;
    return {...cost,category:product.Category||'미분류',productName:product.DisplayName||product.ProdName,
      displayUnit:product.OutUnit,endingDisplayQuantity:target?.endDisplayQuantity??null,
      receiptDisplay:{boxes:sumKnown(target?.rows||[],'BoxQuantity'),bunches:sumKnown(target?.rows||[],'BunchQuantity'),stems:target?.receiptQuantity??null},
      stemFactor:target?.stemFactor,anchorMajor:anchor||null,
      valuationComplete:cost.unitCost!==null||noActivity,
      endingAmount:zeroEnd?0:cost.unitCost!==null&&cost.endQuantity>=0?cost.unitCost*cost.endQuantity:null,
      reasons:[...new Set([...(cost.reasons||[]),...(target?.unitReason&&!target?.unitKnown?[target.unitReason]:[])])],
      costUnit:'원/송이',formula:'(동일 품목 기초재고액 + 입고 도착원가 총액) / (기초 송이수 + 입고 송이수)'};
  });
}

export function buildStemReportComparison({scope,products,live,legacy}) {
  const rows=(live.rows||[]).map(row=>{
    const items=products.filter(p=>p.category===row.category),sumValue=field=>items.every(p=>number(p[field])!==null)?items.reduce((s,p)=>s+p[field],0):null;
    const active=['N','L','O','Q','E','F'].some(k=>number(row.auto?.[k])!==null&&Number(row.auto[k])!==0);
    const absentProducts=active&&items.length===0;
    const E=absentProducts?null:sumValue('openingAmount'),F=absentProducts?null:sumValue('endingAmount');
    // Disable the legacy stock-price fallback, then use the unchanged common financial formulas (including AC/AJ).
    const input={...row,confirmed:false,calculationFrozen:false,auto:{...row.auto,E,F},manual:{...row.manual,E:null,F:null},stock:null};
    const calc=computeProfitRow(input);
    const reasons=[];
    if(absentProducts)reasons.push('활동 금액이 있으나 대응 품목 원천이 없습니다.');
    if(['N','L','O','Q'].some(k=>number(row.auto?.[k])===null))reasons.push('매출·매입 원천 입력값이 누락되었습니다.');
    if(active&&['H','S'].some(k=>number(calc[k])===null))reasons.push('운임 또는 통관비 입력 근거가 누락되었습니다.');
    const receiptAmount=sumValue('receiptAmount');
    const expectedReceipt=number(calc.G)!==null&&number(calc.H)!==null?calc.G+calc.H:null;
    const receiptDelta=receiptAmount!==null&&expectedReceipt!==null?receiptAmount-expectedReceipt:null;
    if(receiptDelta!==null&&Math.abs(receiptDelta)>1)reasons.push('품목 도착원가 합계와 본표 매입·운임·통관비 합계가 다릅니다.');
    for(const issue of live.audit?.issues||[])if(issue.severity==='error'&&(!issue.category||issue.category===row.category))reasons.push(issue.message||'원천 검증 오류');
    const incomplete=items.some(p=>p.valuationComplete!==true)||reasons.length>0;
    if(incomplete){calc.I=null;calc.J=null;calc.K=null;}
    const baseline=computeProfitRow({...row,confirmed:false,calculationFrozen:false});
    const old=legacy?.rows?.find(r=>r.category===row.category)?.calc||null;
    const differences=Object.fromEntries(['E','F','I','J','K'].map(k=>[k,{policy:number(calc[k])!==null&&number(baseline[k])!==null?calc[k]-baseline[k]:null,source:number(baseline[k])!==null&&number(old?.[k])!==null?baseline[k]-old[k]:null}]));
    return {...row,calc,items,legacy:old,currentLegacy:baseline,differences,reasons,
      receiptReconciliation:{allocated:receiptAmount,reportCost:expectedReceipt,delta:receiptDelta},
      status:E===null||F===null||incomplete||[calc.I,calc.J,calc.K].some(v=>number(v)===null)?'held':items.some(p=>p.estimated)?'estimated':'calculated'};
  });
  const totals=computeProfitTotals(rows);for(const row of rows){row.calc.D=calcRevenueRatio(row.calc,totals);row.calc.U=calcPurchaseRatio(row.calc,totals);}
  return {ok:true,year:scope.year,major:scope.major,modelVersion:STEM_COST_VERSION,rows,totals,legacyTotals:legacy?.totals||legacy?.confirmedTotals||null,
    products,readOnly:true,asOf:new Date().toISOString(),notes:['송이 기준 품목별 가중평균으로 기초·기말재고액만 재평가합니다. 기존 매출·입고원가·통관비 및 국가별 손익식은 유지합니다.','원가 미확정 품목은 전체 원가·수익률을 보류합니다. 원본 PDF 포장단수와 판매 단수는 같은 단위로 가정하지 않습니다.','기존 엑셀식 저장·확정본과 다운로드/인쇄는 변경하지 않았습니다. 이 비교 계산은 DB에 저장하지 않습니다.']};
}
