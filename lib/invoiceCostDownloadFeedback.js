import { calculateAuOriginalCustoms } from './auOriginalCostInputs.js';

const AU_LABELS = {gw:'GW(kg)',itemCount:'검역 품목수',baeksangRateKRW:'백상 요율',clearanceFeeKRW:'통관 수수료',inspectionRateKRW:'검역 요율',domesticTransportKRW:'국내 운송비'};
// Presentation only: keep the existing server-preview eligibility unchanged.
export function invoiceCostDownloadFeedback({busy=false,preview=null,notice=null,form={},reviewOnly=false,manualLineCount=0,inputEdited=false}={}) {
  if (busy) return {disabled:true,reason:'처리 중입니다. 완료될 때까지 기다려 주세요.'};
  if (preview?.status === 'APPROVED') return {disabled:false,reason:''};
  const issues=(preview?.issues || []).filter(i=>i.severity!=='warning').map(i=>i.message).filter(Boolean);
  if (issues.length) return {disabled:true,reason:[...new Set(issues)].join(' · ')};
  if (notice?.type === 'error' && notice.text) return {disabled:true,reason:notice.text};
  if (reviewOnly) return {disabled:true,reason:'국가·운송 방식에 맞는 검증 공식을 확인하세요.'};
  const missing=[];
  if (form.exchangeRateKRW === '' || form.exchangeRateKRW == null || !Number.isFinite(Number(form.exchangeRateKRW)) || Number(form.exchangeRateKRW)<=0) missing.push('환율');
  if (form.formulaId==='AU_CNF_BUNCH_V1' && form.auOriginalMode==='FORMULA') missing.push(...calculateAuOriginalCustoms(form.auOriginal).missing.map(k=>AU_LABELS[k] || k));
  if (missing.length) return {disabled:true,reason:`${missing.join(', ')} 입력을 확인한 뒤 ‘입력값으로 미리보기’를 눌러 주세요.`};
  if (manualLineCount>0) return {disabled:true,reason:`직접 입력이 필요한 ${manualLineCount}개 행을 확인한 뒤 미리보기를 실행하세요.`};
  if (form.formulaApplicabilityConfirmed!==true) return {disabled:true,reason:'입력값을 검토하고 ‘공식 적용 확인’을 체크한 뒤 미리보기를 실행하세요.'};
  return {disabled:true,reason:inputEdited?'입력값이 변경되었습니다. ‘입력값으로 미리보기’를 다시 눌러 주세요.':'‘입력값으로 미리보기’를 먼저 눌러 검증을 완료해 주세요.'};
}
