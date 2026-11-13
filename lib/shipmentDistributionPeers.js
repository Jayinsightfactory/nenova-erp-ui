const COLORS=['#047857','#7c3aed','#be185d','#0369a1','#b45309','#4338ca','#9f1239'];
export const distributionPeerColor=index=>COLORS[((Number(index)||0)%COLORS.length+COLORS.length)%COLORS.length];
export const distributionSlotMark=index=>Number.isInteger(index)&&index>=0&&index<20?String.fromCodePoint(0x2460+index):String(Number(index)+1);

// Different customer reads may finish in any order. Replacing/removing one customer
// must never invalidate the other columns; a week/reset invalidates the entire epoch.
export function createDistributionPeerReads(){
 let epoch=0,serial=0;const requests=new Map();
 const key=(week,custKey)=>`${week}|${Number(custKey)}`;
 return {
  start(week,custKey){
   if(!/^\d{4}-\d{2}-\d{2}$/.test(String(week))||!Number.isSafeInteger(Number(custKey))||Number(custKey)<=0)throw Error('업체를 조회할 연도·차수·업체를 다시 선택하세요.');
   const token={epoch,serial:++serial,week:String(week),custKey:Number(custKey)};requests.set(key(week,custKey),token.serial);return token;
  },
  current(token,week){return !!token&&token.epoch===epoch&&token.week===week&&requests.get(key(token.week,token.custKey))===token.serial;},
  cancel(week,custKey){requests.delete(key(week,custKey));},
  reset(){epoch++;requests.clear();},
 };
}

export function assertDistributionBatchSize(entries){
 if(!Array.isArray(entries)||entries.length>1000)throw Error('한 번에 저장할 변경 행이 1,000개를 넘습니다. 수량 변경을 나누어 저장하세요. 주문등록과 확정해제는 시작하지 않았습니다.');
}
