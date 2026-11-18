// Shared preview/read policy. No SQL, filesystem, rates or monetary defaults.
const present=value=>value!==null&&value!==undefined&&value!=='';
function dbCostValue(saved,field){
  const stem=String(field).match(/^(Customs[12]|SunYul[12])(?:_[123])?$/)?.[1];
  if(stem){
    const parts=[1,2,3].map(i=>saved?.[`${stem}_${i}`]);
    if(parts.some(present))return {protected:true,value:parts.reduce((n,v)=>n+Number(v??0),0)};
    if(present(saved?.[stem]))return {protected:true,value:Number(saved[stem])};
  }
  if(present(saved?.[field]))return {protected:true,value:Number(saved[field])};
  if(field==='ActualQuarantineAgencyFee'&&present(saved?.ItemCount))return {protected:true,value:null,reason:'item_count'};
  return {protected:false,value:null};
}
function missingCountryValues(saved,values,phase){
  const h=Number(phase);if(![1,2].includes(h))return {};
  const allowed=new RegExp(`^(?:Customs${h}_[123]|SunYul${h}_[123]|Quarantine${h})$`);
  return Object.fromEntries(Object.entries(values||{}).filter(([field,value])=>allowed.test(field)
    &&Number.isSafeInteger(value)&&value>=0&&!dbCostValue(saved,field).protected));
}
function missingColombiaValues(saved,values){
  return Object.fromEntries(Object.entries(values||{}).filter(([field,value])=>
    /^(CustomsFee|HandlingFee|ActualQuarantineAgencyFee|DisinfectFee)$/.test(field)
    &&Number.isSafeInteger(value)&&value>=0&&!dbCostValue(saved,field).protected));
}
module.exports={present,dbCostValue,missingCountryValues,missingColombiaValues};
