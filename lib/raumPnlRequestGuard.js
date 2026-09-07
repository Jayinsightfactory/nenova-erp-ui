// P&L 화면에서 늦게 도착한 이전 거래처 응답이 현재 화면을 덮지 않게 하는 순수 세대 가드.
export function createRaumPnlRequestGuard() {
  let generation = 0;

  return {
    begin(partnerCode) {
      return { generation: ++generation, partnerCode };
    },
    invalidate() {
      generation += 1;
    },
    isCurrent(token, livePartnerCode) {
      return token?.generation === generation
        && token?.partnerCode === livePartnerCode;
    },
  };
}
