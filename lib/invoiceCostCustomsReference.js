// Original workbook rules, not historical bill amounts. The receipt's approved
// customs total remains authoritative when it differs from this reference.
// Sources: verified profile sourceHash/sourceSheet, audited 2026-11-04.
const rules = Object.freeze({
  US_ORIGINAL_V1:{rate:460,handling:33000,inspectionRate:10000,domestic:90000},
  VN_ORIGINAL_V1:{rate:460,handling:33000,inspectionRate:10000,domestic:99000},
  NZ_ORIGINAL_V1:{rate:375,handling:33000,inspectionRate:10000,domestic:90000},
  EC_ORIGINAL_V1:{rate:460,handlingRate:9000,inspection:36000,domestic:90000,referenceDeduction:20000},
  CO_ORIGINAL_V1:{rate:370,handling:33000,inspectionRate:10000,domestic:99000,referenceDeduction:40000},
  CN_AIR_ORIGINAL_V1:{rate:460,handling:33000,inspectionRate:10000,domestic:99000,referenceDeduction:40000},
  TH_ORIGINAL_V1:{rate:460,handling:33000,inspectionRate:10000,domestic:99000},
});

// Thailand source sheet 40: manually entered KRW/stem, NOT current FOB.
// P6 sums sample quantity * these values; N10 ADDS P6 to customs.
// Keep this historical reference separate from the applied AB5 amount.
export const TH_HISTORICAL_QUARANTINE = Object.freeze([
  ['Den',10,809.654591231149,'R6','S6','T6'],
  ['Mok',5,824.354103540507,'R7','S7','T7'],
  ['Anthurium',5,null,'R8','S8','T8'],
  ['Julling',10,1643.37730384743,'R9','S9','T9'],
  ['Oncidium',10,912.244475410627,'R10','S10','T10'],
  ['Necklace',1,6904.35258164253,'U6','V6','W6'],
  ['Vanda',1,null,'U7','V7','W7'],
].map(Object.freeze));

export function customsReferenceCells(profileId,{weightRef,countRef,weight,count,labelCol,valueCol,start}){
  if(profileId==='CN_SEA_ORIGINAL_V1'){
    const cells=new Map(),put=(ref,value,formula)=>cells.set(ref,{value,...(formula?{formula}:{})});
    put('B19','통관비 · 원본 참고 기본값(실제 청구 아님)');
    const entries=[['B20','C20','창고료',1100000],['B21','C21','통관 수수료',30000],
      ['B22','C22','검역 수수료',100000],['B23','C23','물류',600000],
      ['B24','C24','출고비',100000],['B25','C25','분류작업비',300000],
      ['B26','C26','소독',240000],['B27','C27','Do charge',1703302],
      ['D20','E20','검역비',40000],['D22','E22','수수료',2000000],['D23','E23','보세 운송료',297000]];
    entries.forEach(([label,ref,name,value])=>{put(label,name);put(ref,value);});
    const total=entries.reduce((sum,e)=>sum+e[3],0);
    put('D28','원본 기준 합계');put('E28',total,'SUM(C20:C27,E20:E27)');
    put('AA10','실제 적용 통관비');put('AB10','AB5 적용 · 참고 기본값과 구분');
    put('AA11','적용 통관비와 서식 차이');
    return {cells,total,totalRef:'E28'};
  }
  const rule=rules[profileId];if(!rule)return null;
  const cells=new Map(),put=(ref,value,formula)=>cells.set(ref,{value,...(formula?{formula}:{})});
  const finite=n=>typeof n==='number'&&Number.isFinite(n)&&n>=0;
  const weighted=finite(weight)?weight*rule.rate:'중량 확인 필요';
  const handling=rule.handling??(finite(count)?count*rule.handlingRate:'품목수 확인 필요');
  const inspection=rule.inspection??(finite(count)?count*rule.inspectionRate:'품목수 확인 필요');
  const values=[weighted,handling,inspection,rule.domestic];
  const formulas=[`${weightRef}*${rule.rate}`,rule.handlingRate?`${countRef}*${rule.handlingRate}`:undefined,
    rule.inspectionRate?`${countRef}*${rule.inspectionRate}`:undefined,undefined];
  put(`${labelCol}${start-1}`,'통관비 · 원본 기준 계산(실제 청구 아님)');
  ['백상','통관 수수료','검역 수수료','국내 운송비'].forEach((label,i)=>{
    put(`${labelCol}${start+i}`,label);put(`${valueCol}${start+i}`,values[i],formulas[i]);
  });
  let deduction=rule.referenceDeduction??0;
  put('AA10','원본 참고 검역비');put('AB10',deduction);
  if(profileId==='TH_ORIGINAL_V1'){
    put('R4','40차 검역 참고단가 · 현재 단가 아님');
    put('R5','품종');put('S5','차감 송이');put('T5','원본 원/송이');
    put('U5','품종');put('V5','차감 송이');put('W5','원본 원/송이');
    for(const [name,stems,price,nameRef,stemsRef,priceRef] of TH_HISTORICAL_QUARANTINE){
      put(nameRef,name);put(stemsRef,stems);put(priceRef,price??'원본 미기재');
    }
    deduction=TH_HISTORICAL_QUARANTINE.reduce((sum,[,stems,price])=>sum+stems*(price??0),0);
    put('O6','원본 검역 합계');
    put('P6',deduction,'SUMPRODUCT(S6:S10,T6:T10)+SUMPRODUCT(V6:V7,W6:W7)');
    put('O7','원본 추가비');put('P7',0);
    put('AA10','40차 검역 참고 합계');put('AB10',deduction,'P6');
    put('R11','원본 미기재 단가는 참고 합계에서 제외. 현재 비용은 AB5 적용.');
  }
  put('AA11','적용 통관비와 서식 차이');
  const total=values.every(finite)?values.reduce((a,b)=>a+b,0)+deduction:'입력 필요';
  const totalRef=`${valueCol}${start+4}`;
  put(`${labelCol}${start+4}`,'원본 기준 합계');
  put(totalRef,total,`IF(COUNT(${valueCol}${start}:${valueCol}${start+3})=4,SUM(${valueCol}${start}:${valueCol}${start+3})+$AB$10,"입력 필요")`);
  return {cells,total,totalRef};
}
