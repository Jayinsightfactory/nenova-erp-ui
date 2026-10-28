import { hasKakaoDefectMarker } from './salesDefectAutoSource.js';

export function resolveDefectRowSourceFile(raw = {}, commonSource = '') {
  const own=Object.prototype.hasOwnProperty.call(raw,'sourceFileName')||Object.prototype.hasOwnProperty.call(raw,'SourceFileName');
  if(own)return String(raw.sourceFileName??raw.SourceFileName??'').trim();
  const common=String(commonSource??'').trim();
  if(hasKakaoDefectMarker(common)&&!String(raw.note??raw.Note??'').trim().toLowerCase().startsWith(common.toLowerCase()+':')) {
    throw new Error('자동수집 공통 표식을 다른 입력행에 적용할 수 없습니다. 화면을 새로고침한 뒤 수기행을 다시 저장하세요.');
  }
  return common;
}
