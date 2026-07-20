// Nenova.exe FormShipmentDistribution 의 농장 후보 범위 계약.
//
// dnSpy 기준 후보는 현재 출고 차수/연도가 아니라 ProdKey 전체의
// ViewWarehouse 에서 만들어진다. 모달 GET, farm-distribution POST,
// 차수피벗 adjust 트랜잭션의 최종 검증이 서로 다른 범위를 사용하면
// 화면에는 보이는 농장을 저장 단계에서 거부하는 회귀가 다시 발생한다.
export const FARM_CANDIDATE_SCOPE_SQL = 'vw.ProdKey=@pk';

export const FARM_CANDIDATE_SCOPE = Object.freeze({
  source: 'ViewWarehouse',
  key: 'ProdKey',
  yearScoped: false,
  weekScoped: false,
  description: 'ViewWarehouse 전체 입고 이력 중 현재 ProdKey에 해당하는 농장 후보',
});
