export const PRODUCT_EDIT_FIELDS = ['ProdCode','ProdName','DisplayName','FlowerName','CounName','Cost','OutUnit','EstUnit','BunchOf1Box','SteamOf1Bunch','SteamOf1Box','BoxWeight','BoxCBM','TariffRate'];
export const PRODUCT_EXPECTED_FIELDS = [...PRODUCT_EDIT_FIELDS,'CountryFlower'];
const numeric = new Set(['Cost','BunchOf1Box','SteamOf1Bunch','SteamOf1Box','BoxWeight','BoxCBM','TariffRate']);
export function productMasterSnapshot(row) {
  return Object.fromEntries(PRODUCT_EXPECTED_FIELDS.map(k=>[k,row[k]??null]));
}
export function productEditPayload(form) {
  const values={};
  for(const key of PRODUCT_EDIT_FIELDS) {
    const input=key[0].toLowerCase()+key.slice(1);
    // Only edited fields, not every stale value loaded with the form.
    if(Object.hasOwn(form,input)) values[key]=form[input];
  }
  return {prodKey:form.ProdKey,values,expected:form.ProdKey?productMasterSnapshot(form):undefined};
}
export function productSaveError(message,status=400) {const e=Error(message);e.status=status;return e;}
export function validateProductValues(values) {
  if(!values||typeof values!=='object'||Array.isArray(values)||!Object.keys(values).length)throw productSaveError('변경할 값을 입력하세요.');
  const result={};
  for(const [key,value]of Object.entries(values)) {
    if(!PRODUCT_EDIT_FIELDS.includes(key))throw productSaveError('허용되지 않은 품목 항목입니다.');
    if(numeric.has(key)) {
      if(value===null||value==='') {result[key]=null;continue;}
      if(!['string','number'].includes(typeof value)||!/^\d+(\.\d+)?$/.test(String(value)))throw productSaveError(`${key}: 0 이상의 숫자가 필요합니다.`);
      const n=Number(value),scale=key==='TariffRate'?4:['BoxWeight','BoxCBM'].includes(key)?3:6;
      if(!Number.isFinite(n)||n>9999999||Math.abs(n*10**scale-Math.round(n*10**scale))>0.00001)throw productSaveError(`${key}: 숫자 범위/소수 자릿수를 확인하세요.`);
      if(key==='TariffRate'&&n>1)throw productSaveError('관세율 범위를 확인하세요.');
      result[key]=n;
    } else {
      if(value!==null&&typeof value!=='string')throw productSaveError(`${key}: 문자가 필요합니다.`);
      result[key]=value===null?null:value.trim();
    }
  }
  return result;
}
export function assertProductSnapshot(current,expected) {
  if(!current||!expected||PRODUCT_EXPECTED_FIELDS.some(k=>!Object.hasOwn(expected,k)||(current[k]??null)!==expected[k]))throw productSaveError('품목이 변경되었거나 삭제됐습니다. 새로고침 후 다시 수정하세요.',409);
}
export function nativeCountryFlower(country,flower,isSelectFlower) {
  return isSelectFlower===true||isSelectFlower===1?country:country+flower;
}
