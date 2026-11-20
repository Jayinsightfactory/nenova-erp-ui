import { normalizeUploadQtyForProduct, isBunchAllocationImportRow } from './shipmentImportQty.js';

export const IMPORT_DISTRIBUTION_MODES = Object.freeze({ REPLACE:'REPLACE', ADD:'ADD', FINAL:'FINAL' });
export const IMPORT_FILE_PROPERTY = 'NenovaDistributionInput';
export const IMPORT_FILE_SCHEMA = 'NENOVA_DISTRIBUTION_V1';
export function importModeError(message) {
  return Object.assign(new Error(message),{statusCode:409,code:'IMPORT_MODE_REVERIFY'});
}
export function requireDistributionMode(value) {
  const mode=value == null ? 'REPLACE' : value;
  if(!Object.values(IMPORT_DISTRIBUTION_MODES).includes(mode))throw importModeError('분배 반영 방식이 유효하지 않습니다. 다시 검증하세요.');
  return mode;
}
export function requireDownloadKind(value) {
  const kind=value == null ? 'FINAL' : value;
  if(!['FINAL','ADDITIONAL'].includes(kind))throw importModeError('다운로드 형식을 선택하고 다시 검증하세요.');
  return kind;
}
export function readImportFileMetadata(workbook) {
  const raw=workbook?.Custprops?.[IMPORT_FILE_PROPERTY];
  if(raw == null || raw==='')return null;
  let meta;try{meta=JSON.parse(String(raw));}catch{throw importModeError('합산 파일 종류 정보가 손상됐습니다. 원본 파일로 다시 검증하세요.');}
  if(meta?.schema!==IMPORT_FILE_SCHEMA || !['FINAL','ADDITIONAL'].includes(meta.kind) || !/^\d{4}$/.test(String(meta.year)) || !/^\d{2}-\d{2}$/.test(meta.week)) {
    throw importModeError('합산 파일 종류 정보가 유효하지 않습니다. 원본 파일로 다시 검증하세요.');
  }
  return {schema:IMPORT_FILE_SCHEMA,kind:meta.kind,year:String(meta.year),week:meta.week};
}
export function resolveImportMode({addToExisting=false,metadata,year,week,earlyImportMode}) {
  if(![true,false,'true','false',undefined,null].includes(addToExisting))throw importModeError('기존 분배 합산 선택이 유효하지 않습니다.');
  const add=addToExisting===true || addToExisting==='true';
  if(metadata) {
    if(metadata.year!==String(year) || metadata.week!==String(week).replace(/^\d{4}-/,''))throw importModeError('이 다운로드 파일의 연도·차수가 선택한 대상과 다릅니다. 대상 차수를 확인하세요.');
    if(earlyImportMode!=='ALREADY_EXCLUDED')throw importModeError('이 파일은 선출고 제외 후 수량입니다. 선출고 원문에서 “이미 선출고 제외”를 선택하고 다시 검증하세요.');
    if(metadata.kind==='FINAL' && add)throw importModeError('최종 합계 파일은 이미 기존 분배를 포함합니다. “기존 분배에 합산하기”를 해제하고 다시 검증하세요.');
    if(metadata.kind==='ADDITIONAL' && !add)throw importModeError('추가분 파일입니다. “기존 분배에 합산하기”를 체크하고 다시 검증하세요.');
    return metadata.kind==='FINAL' ? 'FINAL' : 'ADD';
  }
  return add ? 'ADD' : 'REPLACE';
}
// Addition must not guess that a small delta is a box quantity by comparing it
// with an existing total. Use the workbook's established source unit instead.
export function normalizeImportInput(row,product,mode='REPLACE') {
  requireDistributionMode(mode);
  const source=mode!=='REPLACE' && !String(row.excelUnit || '').trim() && isBunchAllocationImportRow(row,product)
    ? {...row,excelUnit:'단'} : row;
  return normalizeUploadQtyForProduct(source,product);
}
export function projectImportQuantity({mode='REPLACE',inputQty,currentOutQty}) {
  requireDistributionMode(mode);
  const input=Number(inputQty),base=Number(currentOutQty);
  if(!Number.isFinite(input)||input<0||!Number.isFinite(base)||base<0)throw importModeError('기존 분배 또는 업로드 수량이 유효하지 않습니다. 음수 추가분은 합산할 수 없습니다.');
  return mode==='ADD' ? base+input : input;
}
export function verifiedImportTarget(row,inputQty,mode='REPLACE') {
  requireDistributionMode(mode);
  if(mode==='REPLACE')return Number(inputQty);
  const close=(a,b)=>Number.isFinite(Number(a))&&Math.abs(Number(a)-Number(b))<0.00001;
  const target=projectImportQuantity({mode,inputQty,currentOutQty:row.currentOutQty});
  if(row.distributionMode!==mode || !close(row.inputQty,inputQty) || !close(row.uploadQty,target))throw importModeError('분배 방식·기존 수량·추가 수량이 검증 이후 바뀌었습니다. 다시 검증하세요.');
  return target;
}
export function additiveFarmTotal(assignments,targetQty) {
  const total=(assignments||[]).reduce((sum,f)=>sum+Number(f.shipmentQuantity ?? f.ShipmentQuantity ?? 0),0);
  if(!Number.isFinite(total)||total<0||total-Number(targetQty)>0.0001)throw importModeError('농장 배정이 최종 분배 수량을 초과합니다. 기존 농장과 추가 배정을 확인하세요.');
  return total;
}
export function assertAdditionBaseline(row,currentQty) {
  if(row.distributionMode==='ADD' && (!Number.isFinite(Number(currentQty)) || Math.abs(Number(currentQty)-Number(row.currentOutQty))>0.00001)) {
    throw importModeError('기존 분배가 합산 검증 이후 변경됐습니다. 다른 작업의 반영량을 확인하고 다시 검증하세요.');
  }
}
