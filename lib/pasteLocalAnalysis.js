import {customerReviewCandidates} from './pasteAiMatchReview.js';
import {stripTrailingOrderMemo} from './pasteNaturalInlineOrder.js';
import {parseExplicitOrderUnit} from './pasteOrderUnit.js';

// All-or-nothing coverage: never drop an unknown line to save a model call.
export function inspectLocalPasteParse(text, parsed, customers, mappings={}) {
  const expected=[];let customer='',headerFlower='';
  let lineNumber=0;
  for(const raw of String(text).split(/\r?\n/)) {
    lineNumber++;
    const line=raw.trim();
    if(!line||/^[-_=ㅡ─]{4,}$/.test(line))continue;
    if(/^(?:20\d{2}년\s*)?\d{1,2}\s*(?:-\s*\d{1,2}|차)\s*(?:콜\s*)?(?:콜롬비아\s*|중국\s*|호주\s*|네덜란드\s*)?(?:카네이션|수국|장미|알스트로)?\s*(?:변경사항|발주|추가|취소)?$/.test(line)){
      headerFlower=line.match(/카네이션|수국|장미|알스트로/)?.[0]||'';continue;
    }
    // Exact customers take precedence: digits in a company name are not quantities.
    const exact=customerReviewCandidates(line,customers,mappings).lockedKey;
    if(exact){customer=line;continue;}
    const value=stripTrailingOrderMemo(line);
    // Missing unit is allowed only with a flower header and explicit action.
    const m=/^(.+?)\s*(\d+(?:\.\d+)?)\s*(박\s*스|단|송\s*이|대|스\s*팀|스\s*템|st|stems?|steam|ea)?\s*(추가|취소)?$/i.exec(value);
    if(!customer)return {eligible:false,reason:'customer-or-header',lineNumber};
    if(!m||value!==line||!Number.isFinite(+m[2])||+m[2]<=0||/[+−:：|]/.test(m[1])||/[-−]\s*$/.test(m[1])||/\d\s*박스/.test(m[1]))return {eligible:false,reason:'unsupported-line',lineNumber};
    if(!m[3]&&(!headerFlower||!m[4]))return {eligible:false,reason:'unit-context',lineNumber};
    expected.push({customer,qty:+m[2],unit:parseExplicitOrderUnit(m[3])||(headerFlower==='장미'?'단':'박스'),action:m[4]||'추가',product:m[1].trim().replace(/\s+/g,' ')});
  }
  const actual=(parsed?.orders||[]).flatMap(o=>(o.items||[]).map(i=>({customer:o.custName,qty:Number(i.qty),unit:parseExplicitOrderUnit(i.unit),action:i.action||'추가',product:String(i.inputName||'').trim().replace(/\s+/g,' ')})));
  const eligible=expected.length>0&&expected.length===actual.length&&expected.every(({product,...row},i)=>{
    const {product:parsedName,...parsedRow}=actual[i];
    return (parsedName===product||parsedName.endsWith(' '+product))&&JSON.stringify(row)===JSON.stringify(parsedRow);
  });
  return {eligible,reason:eligible?'complete':'parser-disagreement',lineNumber:0};
}
export function canUseLocalPasteParse(...args){return inspectLocalPasteParse(...args).eligible;}

export function createPasteAnalysisMetrics(now=()=>performance.now()) {
  const start=now(),metrics={modelCalls:0,inputTokens:0,outputTokens:0,localParse:false};
  return {metrics,record(){metrics.modelCalls++;},recordUsage(usage={}){metrics.inputTokens+=Number(usage.input_tokens||0);metrics.outputTokens+=Number(usage.output_tokens||0);},finish(){return {...metrics,elapsedMs:Math.round(now()-start)};}};
}
