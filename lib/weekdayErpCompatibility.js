// Shared by browser preview and locked server save. A page baseline is NOT ERP isFix.
const isFixed = value => value === true || value === 1;

// C# Math.Round(decimal, 0) defaults to midpoint-to-even. Use decimal tokens,
// not a binary epsilon test at .5. Existing web/SQL rounding is a separate
// evidenced storage rule; this helper does not rewrite any stored amounts.
function decimalFraction(value) {
  const match=String(value).match(/^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i);
  if (!match) throw new Error('양수 decimal 값이 필요합니다.');
  const fraction=match[2] || '', exponent=Number(match[3] || 0);
  let n=BigInt(match[1]+fraction),d=1n;
  const scale=fraction.length-exponent;
  if (Math.abs(scale)>100) throw new Error('decimal 범위 초과');
  if (scale>=0) d=10n**BigInt(scale);else n*=10n**BigInt(-scale);
  return {n,d};
}

function roundEven(n,d) {
  const floor=n/d,rem=n%d,twice=rem*2n;
  return twice>d || (twice===d && floor%2n===1n) ? floor+1n : floor;
}

export function exeDecimalToEvenAmountVat(cost,quantity) {
  const c=decimalFraction(cost),q=decimalFraction(quantity);
  const roundedQty=roundEven(q.n,q.d);
  const grossNumerator=c.n*roundedQty;
  const amount=roundEven(grossNumerator*10n,c.d*11n);
  const gross=Number(grossNumerator)/Number(c.d);
  return {roundedQty:Number(roundedQty),amount:Number(amount),vat:gross-Number(amount),gross};
}

export function weekdaySaveEligibility(actual = {}) {
  if (Number(actual.detailRows) === 1) {
    const fixed = actual.detail ? actual.detail.DetailIsFix : actual.fixed;
    return isFixed(fixed)
      ? { allowed:true, reason:'' }
      : { allowed:false, reason:'ERP 미확정 분배는 요일·수량을 저장할 수 없습니다. 분배관리에서 해당 품종·차수를 확정한 뒤 전산 새로고침하세요. 최초 기준 확정과는 별개입니다.' };
  }
  if (Number(actual.detailRows) === 0) {
    const fixed = actual.master ? actual.master.MasterIsFix : actual.masterFixed;
    return isFixed(fixed)
      ? { allowed:true, reason:'' }
      : { allowed:false, reason:'신규 날짜의 대상 차수가 ERP 미확정입니다. 분배관리에서 확정한 뒤 전산 새로고침하세요. 주문 자동 생성·자동 확정은 하지 않습니다.' };
  }
  return { allowed:false, reason:'복수 상세 또는 확인되지 않은 확정 상태는 저장할 수 없습니다. 전산 연결을 확인하세요.' };
}

// EXE btnSave_Click visits day1(Sunday)..day7(Saturday), updating the
// representative ShipmentDtm for EACH positive day. Last visited wins.
export function exeWeekdayRepresentativeTimestamp(finalDates = [], calendar) {
  let selected = null;
  for (const row of finalDates) {
    if (Number(row.shipmentQuantity) <= 0) continue;
    const period = calendar?.get(row.date);
    if (!period || period.ambiguous || !Number.isInteger(period.weekDay)
      || period.weekDay < 1 || period.weekDay > 7 || period.timestamp !== row.timestamp) {
      throw new Error(`${row.date}: 대표 출고일의 정확한 전산 달력을 확인할 수 없습니다.`);
    }
    if (!selected || period.weekDay > selected.weekDay) selected = period;
  }
  return selected?.timestamp ?? null;
}
