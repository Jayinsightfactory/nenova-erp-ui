// Read-only workbook projection. Never changes the approved cost or ERP inputs.
const finite = value => typeof value === 'number' && Number.isFinite(value);
const unitLabel = unit => ({ STEM: '송이', BUNCH: '단', BOX: '박스' })[unit] || unit;
const col = index => {
  let result = '';
  for (let n = index + 1; n; n = Math.floor((n - 1) / 26)) result = String.fromCharCode(65 + (n - 1) % 26) + result;
  return result;
};
export function invoiceCostFormulaComparison({ document, snapshot, rows, profile }) {
  const cells = new Map();
  const put = (ref, value) => { if (value !== undefined && value !== null) cells.set(ref, { value }); };
  const formula = (ref, expression, value) => cells.set(ref, { formula: expression, value });
  const input = snapshot.input, settings = new Map(input.lineInputs.map(row => [row.lineId, row]));
  const sea = profile.id === 'CN_SEA_ORIGINAL_V1', air = profile.id === 'CN_AIR_ORIGINAL_V1';
  const nl = profile.id === 'NL_ORIGINAL_V1', co = profile.id === 'CO_ORIGINAL_V1', th = profile.id === 'TH_ORIGINAL_V1';
  const first = 13, last = first + rows.length - 1;
  const sum = key => rows.reduce((s, row) => s + (row.cost.componentAmounts[key] ?? 0), 0);
  const freight = sum('freightNative'), customs = sum('customsKRW');
  put('A1', `${document.orderYear}/${document.orderWeek} 원본 수식 계산·저장값 비교`);
  put('A2', '기존 입고·저장 원가는 변경하지 않습니다. 환율(B4)을 바꾸면 이 파일 안에서만 다시 계산됩니다.');
  put('A3', '원본의 배분식을 현재 입고에 적용합니다. 개별 청구비 내역은 저장 총액을 나눠 추정하지 않습니다.');
  put('A4', '환율'); put('B4', input.exchangeRateKRW);
  put('D4', '운임 합계(외화)'); put('E4', freight);
  put('G4', '통관 합계(원)'); put('H4', customs);
  put('A5', 'GW (kg)'); put('B5', document.reviewedMetadata?.gw);
  put('D5', 'CW (kg)'); put('E5', document.reviewedMetadata?.cw);
  put('A6', '원본 근거'); put('B6', `${profile.sourceSheet} / ${profile.formulaId}`);
  put('A7', sea ? '중국 해상: W열 박스 CBM, X열 박스당 단수를 입력하면 실제 부피 비율로 계산합니다.'
    : '입고수량·단위와 승인 당시 비용 입력을 사용합니다. 과거 양식의 판매가·비용 상수는 가져오지 않습니다.');
  put('A8', '운임 배분 기준'); put('B8', sea ? '실제 CBM' : nl ? '상품금액' : air || co ? '무게 / 부피중량' : th ? '그룹 박스 비율' : '기준단위 수량');
  const headers = ['원문 품목', '입고수량', '전산 단위', '원본 계산 단가', '기존 저장 단가', '단가 차이',
    '원본 계산 합계', '기존 저장 합계', '합계 차이', '확인 사항',
    '계산 기준수량', '상품금액(외화)', '운임 배분비', '통관 배분비', '관세율', '기타비/전산단위(원)',
    '배분 운임(외화)', '상품+운임(원)', '관세(원)', '통관비(원)', '기타비(원)', '계산 기준단위',
    '박스 CBM 입력', '박스당 단수 입력', '입고 CBM', '배분용 무게(kg)', '배분용 부피중량(kg)', '그룹 박스수', '그룹 수량'];
  headers.forEach((label, index) => put(`${col(index)}12`, label));
  const prepared = rows.map(({ source, detail, cost }, i) => {
    const setting = settings.get(cost.lineId), group = input.costGroups?.find(group => group.groupId === setting.groupId);
    const basis = nl || co || th ? 'STEM' : profile.priceBasis || cost.unit;
    let factor = 1;
    if (basis !== cost.unit) {
      const stems = setting.stemsPerBunch, bunches = setting.bunchesPerBox;
      factor = basis === 'STEM' ? cost.unit === 'BUNCH' ? stems : stems * bunches
        : basis === 'BOX' ? cost.unit === 'BUNCH' ? 1 / bunches : 1 / (bunches * stems)
          : cost.unit === 'BOX' ? bunches : 1 / stems;
    }
    const quantity = cost.quantity === 0 ? 0 : nl ? detail.stemQuantity : cost.quantity * factor;
    const cbm = sea && finite(setting.boxCbm) && setting.boxCbm > 0 ? setting.boxCbm : null;
    const bunches = sea && finite(setting.bunchesPerBox) && setting.bunchesPerBox > 0 ? setting.bunchesPerBox : null;
    const gw = cost.quantity === 0 ? 0 : co ? group.grossWeightKg * quantity / group.quantity : air ? setting.grossWeightKg : null;
    const cw = cost.quantity === 0 ? 0 : co ? group.volumeWeightKg * quantity / group.quantity : air ? setting.volumeWeightKg : null;
    return { r: first + i, source, cost, setting, group, basis, quantity, cbm, bunches, gw, cw,
      volume: cost.quantity === 0 ? 0 : cbm && bunches ? quantity * cbm / bunches : null };
  });
  const total = field => prepared.reduce((s, row) => s + (row[field] ?? 0), 0);
  const totalQuantity = total('quantity'), totalVolume = total('volume');
  const totalGoods = rows.reduce((s, row) => s + row.source.lineAmount, 0);
  const missingVolume = sea && prepared.some(row => row.cost.quantity > 0 && row.volume === null);
  const sameWeight = document.reviewedMetadata?.gw === document.reviewedMetadata?.cw;
  const groupBoxes = input.costGroups?.reduce((s, group) => s + group.boxQuantity, 0);
  let calculatedTotal = 0;
  for (const row of prepared) {
    const { r, source, cost, setting, group, quantity, basis, volume } = row;
    const zero = cost.quantity === 0;
    put(`A${r}`, source.originalName); put(`B${r}`, cost.quantity); put(`C${r}`, unitLabel(cost.unit));
    put(`E${r}`, cost.costPerUnitKRW); put(`H${r}`, cost.totalCostKRW);
    put(`K${r}`, quantity); put(`L${r}`, source.lineAmount);
    const otherPerUnit = sea || air ? setting.otherCostPerUnitKRW ?? 0 : 0;
    put(`O${r}`, zero ? 0 : setting.tariffRate); put(`P${r}`, otherPerUnit);
    put(`V${r}`, unitLabel(basis)); put(`W${r}`, row.cbm); put(`X${r}`, row.bunches);
    put(`Z${r}`, row.gw); put(`AA${r}`, row.cw);
    if (th) { put(`AB${r}`, group?.boxQuantity); put(`AC${r}`, group?.quantity); }
    if (sea) formula(`Y${r}`, `IF(B${r}=0,0,IF(AND(ISNUMBER(W${r}),W${r}>0,ISNUMBER(X${r}),X${r}>0),K${r}*W${r}/X${r},"입력 필요"))`, zero ? 0 : volume ?? '입력 필요');
    const ready = !missingVolume;
    const freightShare = zero ? 0 : sea ? ready ? volume / totalVolume : null
      : nl ? source.lineAmount / totalGoods : air || co ? row[sameWeight ? 'gw' : 'cw'] / total(sameWeight ? 'gw' : 'cw')
        : th ? group.boxQuantity / groupBoxes * quantity / group.quantity : quantity / totalQuantity;
    const customsShare = zero ? 0 : nl ? source.lineAmount / totalGoods : air || co ? row.gw / total('gw')
      : th ? group.boxQuantity / groupBoxes * quantity / group.quantity : quantity / totalQuantity;
    const sumRange = column => `SUM(${column}${first}:${column}${last})`;
    const weightFormula = sea ? `IF(COUNT(Y${first}:Y${last})=${rows.length},Y${r}/${sumRange('Y')},"입력 필요")`
      : nl ? `L${r}/${sumRange('L')}` : air || co ? `IF($B$5=$E$5,Z${r}/${sumRange('Z')},AA${r}/${sumRange('AA')})`
        : th ? `AB${r}/$E$8*K${r}/AC${r}` : `K${r}/${sumRange('K')}`;
    if (th) { put('D8', '그룹 총박스'); put('E8', groupBoxes); }
    formula(`M${r}`, `IF(B${r}=0,0,${weightFormula})`, freightShare ?? '입력 필요');
    const customsFormula = nl ? `L${r}/${sumRange('L')}` : air || co ? `Z${r}/${sumRange('Z')}`
      : th ? `AB${r}/$E$8*K${r}/AC${r}` : `K${r}/${sumRange('K')}`;
    formula(`N${r}`, `IF(B${r}=0,0,${customsFormula})`, customsShare);
    const freightValue = zero ? 0 : ready ? freight * freightShare : null;
    formula(`Q${r}`, `IF(ISNUMBER(M${r}),$E$4*M${r},"입력 필요")`, freightValue ?? '입력 필요');
    const cnfValue = freightValue === null ? null : (source.lineAmount + freightValue) * input.exchangeRateKRW;
    formula(`R${r}`, `IF(ISNUMBER(Q${r}),(L${r}+Q${r})*$B$4,"입력 필요")`, cnfValue ?? '입력 필요');
    const tariffValue = zero ? 0 : cnfValue === null ? null : cnfValue * setting.tariffRate;
    formula(`S${r}`, `IF(ISNUMBER(R${r}),R${r}*O${r},"입력 필요")`, tariffValue ?? '입력 필요');
    const customsValue = sea ? 0 : customs * customsShare;
    formula(`T${r}`, sea ? '0' : `$H$4*N${r}`, customsValue);
    const otherValue = cost.quantity * otherPerUnit;
    formula(`U${r}`, `B${r}*P${r}`, otherValue);
    const amount = cnfValue === null ? null : cnfValue + tariffValue + customsValue + otherValue;
    calculatedTotal += amount ?? 0;
    formula(`G${r}`, `IF(COUNT(R${r}:U${r})=4,SUM(R${r}:U${r}),"입력 필요")`, amount ?? '입력 필요');
    formula(`D${r}`, `IF(B${r}=0,"수량 0",IF(ISNUMBER(G${r}),G${r}/B${r},"입력 필요"))`, zero ? '수량 0' : amount === null ? '입력 필요' : amount / cost.quantity);
    formula(`F${r}`, `IF(AND(ISNUMBER(D${r}),ISNUMBER(E${r})),D${r}-E${r},"비교 불가")`, zero || amount === null ? '비교 불가' : amount / cost.quantity - cost.costPerUnitKRW);
    formula(`I${r}`, `IF(ISNUMBER(G${r}),G${r}-H${r},"비교 불가")`, amount === null ? '비교 불가' : amount - cost.totalCostKRW);
    formula(`J${r}`, `IF(B${r}=0,"수량 0",IF(ISNUMBER(I${r}),IF(ABS(I${r})<0.01,"일치(1전 미만)","차이 확인"),"CBM·박스당 단수 입력 필요"))`,
      zero ? '수량 0' : amount === null ? 'CBM·박스당 단수 입력 필요' : Math.abs(amount - cost.totalCostKRW) < 0.01 ? '일치(1전 미만)' : '차이 확인');
  }
  put('A10', '합계');
  formula('G10', `IF(COUNT(G${first}:G${last})=${rows.length},SUM(G${first}:G${last}),"입력 필요")`, missingVolume ? '입력 필요' : calculatedTotal);
  const storedTotal = rows.reduce((s, row) => s + row.cost.totalCostKRW, 0);
  formula('H10', `SUM(H${first}:H${last})`, storedTotal);
  formula('I10', 'IF(ISNUMBER(G10),G10-H10,"비교 불가")', missingVolume ? '비교 불가' : calculatedTotal - storedTotal);
  return { cells, last };
}
