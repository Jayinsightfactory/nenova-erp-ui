// Physical counts only. Factors follow EXE ShipmentQuantityToEstQuantity, not generic per-box ratios.
const EPS=0.000001;
const positive=v=>v!==null&&v!==undefined&&v!==''&&typeof v!=='boolean'&&Number.isFinite(Number(v))&&Number(v)>0?Number(v):null;
const whole=n=>Number.isFinite(n)&&(n===0||Math.round(n)!==0)&&Number.isSafeInteger(Math.round(n))&&Math.abs(n-Math.round(n))<EPS;
export function dateUnitFactor(p={},unit){
 const from=String(p.OutUnit??'').trim();if(!['단','송이'].includes(unit))return null;if(from===unit)return 1;
 const bunch=positive(p.BunchOf1Box),stem=positive(p.SteamOf1Bunch),boxStem=positive(p.SteamOf1Box);
 if(from==='박스')return unit==='단'?bunch:(boxStem??(bunch&&stem?bunch*stem:null));
 if(from==='단'&&unit==='송이')return stem;
 if(from==='송이'&&unit==='단')return stem?1/stem:null;
 return null;
}
export function dateQuantityUnits(product,values=[]){
 const order=product?.OutUnit==='송이'?['송이','단']:['단','송이'];
 return order.map(unit=>({unit,factor:dateUnitFactor(product,unit)})).filter(p=>p.factor&&values.every(v=>v!==null&&v!==undefined&&v!==''&&typeof v!=='boolean'&&Number(v)>=0&&whole(Number(v)*p.factor)));
}
export function dateDisplayQuantity(native,presentation){
 if(!presentation||native===''||native===null||native===undefined||typeof native==='boolean')return '';
 const n=Number(native)*presentation.factor;return whole(n)?String(Math.round(n)):'';
}
export function dateInputQuantity(display,presentation){
 if(!presentation)return {quantity:'',error:'단·송이 입수 정보를 확인하세요.'};
 if(display===''||display===null||display===undefined||typeof display==='boolean'||!Number.isSafeInteger(Number(display))||Number(display)<0)return {quantity:'',error:'단·송이 수량은 0 이상의 정수로 입력하세요.'};
 const native=Number(display)/presentation.factor,rounded=Math.round(native*1000)/1000;
 if(!Number.isFinite(native)||Math.abs(native-rounded)>EPS||Math.abs(rounded*presentation.factor-Number(display))>EPS)return {quantity:'',error:'현재 원장 정밀도로 정확히 저장할 수 없는 수량입니다. 반올림하지 않습니다.'};
 return {quantity:rounded,error:''};
}
export function datePackingSignature(p={}){return JSON.stringify([p.OutUnit??null,...['BunchOf1Box','SteamOf1Bunch','SteamOf1Box'].map(k=>p[k]===null||p[k]===undefined||p[k]===''?null:typeof p[k]==='boolean'?p[k]:Number(p[k]))]);}
