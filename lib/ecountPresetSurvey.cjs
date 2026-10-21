'use strict';
// 2026-10-21 원본 ECOUNT 간편검색 프리셋 조사(읽기 전용 관측, 개인정보·계정값 없음)를 화면별 활성 프리셋 라벨 목록으로 바꾼다.
// 근거는 라벨의 존재뿐이다: results[program].presets 의 라벨, 프리셋 묶음이 보이지 않은 화면은 순서 실험(order, 값 'missing' 제외)의 라벨.
// 날짜 값 자체는 lib/ecountPageActions.cjs datePreset 테스트가 관측값으로 검증하고, 원본 조회 결과 동일성은 여기서 주장하지 않는다.
const survey=require('../data/ecount-workbench/evidence/2026-10-21-source-survey.json');
const {presetIdForLabel}=require('./ecountPageActions.cjs');
const RESET_LABELS=Object.freeze(['다시 작성','다시작성']);
function cleanLabel(entry){return Array.isArray(entry)&&typeof entry[0]==='string'?entry[0].trim():'';}
function observedLabels(program){
  const result=typeof program==='string'&&Object.hasOwn(survey.results,program)?survey.results[program]:null;
  if(!result)return [];
  const presets=(Array.isArray(result.presets)?result.presets:[]).map(cleanLabel).filter(label=>label&&label!=='initial');
  if(presets.length)return [...new Set(presets)];
  const order=(Array.isArray(result.order)?result.order:[]).filter(entry=>Array.isArray(entry)&&entry[1]!=='missing').map(cleanLabel).filter(Boolean);
  return [...new Set(order)];
}
// datePreset id 가 있는 관측 라벨만. 미관측·비날짜 라벨(계좌 양식, 현황 등)은 presetIdForLabel 이 거부하므로 제외된다.
function enabledPresetLabels(program){
  return observedLabels(program).filter(label=>{if(RESET_LABELS.includes(label))return false;try{return presetIdForLabel(label)!=null;}catch{return false;}});
}
function resetObserved(program){return observedLabels(program).some(label=>RESET_LABELS.includes(label));}
function surveyedPrograms(){return Object.keys(survey.results);}
module.exports={SURVEY_OBSERVED_ON:survey.observedOn,RESET_LABELS,observedLabels,enabledPresetLabels,resetObserved,surveyedPrograms};
