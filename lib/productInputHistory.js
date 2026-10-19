export const PRODUCT_HISTORY_FIELDS = {ProdCode:'품목코드',ProdName:'품목명',DisplayName:'표시명',FlowerName:'품종',CounName:'국가',Cost:'기본단가',OutUnit:'출고단위',EstUnit:'견적단위',BunchOf1Box:'1박스단수',SteamOf1Bunch:'1단송이',SteamOf1Box:'1박스송이',BoxWeight:'박스무게',BoxCBM:'박스CBM',TariffRate:'관세%'};
export function productHistoryChanges(before,after) {
  return Object.entries(PRODUCT_HISTORY_FIELDS).filter(([key])=>(before?.[key]??null)!==(after?.[key]??null)).map(([key,label])=>({key,label,before:before?.[key]??null,after:after?.[key]??null}));
}
export function historyValue(key,value) { return value==null?'빈칸':key==='TariffRate'?`${Number((Number(value)*100).toFixed(4))}%`:String(value); }
export async function appendProductInputHistory(q,sql,actor,before,after) {
  await q(`INSERT INTO SystemActionLog (Actor,ActionType,Method,Endpoint,AffectedTable,AffectedCount,Payload,Result,ResultDesc,RiskLevel) VALUES (@actor,'PRODUCT_INPUT_EDIT','POST','/api/master','Product',1,@payload,'SUCCESS',N'품목 입력 전후 기록','HIGH')`,{
    actor:{type:sql.NVarChar(100),value:String(actor).slice(0,100)},payload:{type:sql.NVarChar(sql.MAX),value:JSON.stringify({changes:[{prodKey:after.ProdKey,prodName:after.ProdName,before:before||{},after:Object.fromEntries(Object.keys(PRODUCT_HISTORY_FIELDS).map(k=>[k,after[k]??null]))}],created:!before})}
  });
}
