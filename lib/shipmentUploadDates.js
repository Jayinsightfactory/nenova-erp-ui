const weekdayNames = ['일', '월', '화', '수', '목', '금', '토'];
const epsilon = 0.000001;
const total = rows => rows.reduce((sum, row) => sum + row.quantity, 0);

export function allocationDateHeader(cell, XLSX, date1904 = false) {
  if (!cell) return '';
  if (cell.t === 'n' && cell.z && XLSX.SSF.is_date(cell.z)) {
    const date = XLSX.SSF.parse_date_code(cell.v, { date1904 });
    if (date?.y > 1900) return [date.y, String(date.m).padStart(2, '0'), String(date.d).padStart(2, '0')].join('-');
  }
  const text = String(cell.v ?? '').trim();
  const weekday = text.match(/^([일월화수목금토])(?:요일)?$/);
  if (weekday) return weekday[1];
  const date = text.match(/^(20\d{2})[-./](\d{1,2})[-./](\d{1,2})$/);
  if (!date) return '';
  return [date[1], date[2].padStart(2, '0'), date[3].padStart(2, '0')].join('-');
}

export function uploadDateIssue(message) {
  return Object.assign(new Error(message), { code: 'SHIPMENT_UPLOAD_DATE_INVALID', statusCode: 409 });
}

export function planUploadedDates(source, calendar, quantity) {
  if (!(quantity > 0) || !source.some(row => row.header && row.quantity > 0)) return [];
  const dates = new Map();
  for (const row of source) {
    if (!(row.quantity > 0)) continue;
    if (!row.header) throw uploadDateIssue('같은 업체·품목에 출고일 있는 수량과 없는 수량이 섞여 있습니다.');
    const candidates = calendar.filter(day => row.header === day.Timestamp.slice(0, 10) ||
      row.header === weekdayNames[day.WeekDay - 1]);
    if (candidates.length !== 1) throw uploadDateIssue(`출고일 ${row.header}을 선택 차수 달력에서 한 날짜로 확인할 수 없습니다.`);
    const timestamp = candidates[0].Timestamp;
    dates.set(timestamp, (dates.get(timestamp) ?? 0) + row.quantity);
  }
  const allocations = [...dates].map(([timestamp, quantity]) => ({ timestamp, quantity }));
  if (allocations.length === 1) allocations[0].quantity = quantity;
  if (Math.abs(total(allocations) - quantity) > epsilon) {
    throw uploadDateIssue('선출고 차감 또는 환산 후 날짜별 수량 합계가 맞지 않습니다. 날짜별 수량을 확인하세요.');
  }
  return allocations.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

export function addUploadedDates(allocations, baseline, expectedBaseline) {
  if (!expectedBaseline) return allocations;
  const dates = new Map(allocations.map(row => [row.timestamp, row.quantity]));
  let baselineTotal = 0;
  for (const row of baseline) {
    const shipmentDate = row.ShipmentDtm instanceof Date
      ? row.ShipmentDtm.toISOString().replace('T', ' ').replace('Z', '') : String(row.ShipmentDtm ?? '');
    const quantity = Number(row.ShipmentQuantity);
    if (!/^20\d{2}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}$/.test(shipmentDate) ||
        !Number.isFinite(quantity) || quantity < 0) {
      throw uploadDateIssue('기존 출고일 또는 수량을 확인할 수 없어 날짜별 합산을 중단했습니다.');
    }
    baselineTotal += quantity;
    dates.set(shipmentDate, (dates.get(shipmentDate) ?? 0) + quantity);
  }
  if (Math.abs(baselineTotal - expectedBaseline) > epsilon) {
    throw uploadDateIssue('기존 날짜별 수량의 합계가 출고수량과 다릅니다.');
  }
  return [...dates].map(([timestamp, quantity]) => ({ timestamp, quantity }));
}
