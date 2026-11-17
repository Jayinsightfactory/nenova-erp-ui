// Display only. The ledger keeps the full Kakao provenance for reconciliation.
export function incomingDefectPrintNote(value, managerName) {
  const note = String(value ?? '').trim();
  if (/kakao-defect:/i.test(note)) {
    const stamp = note.match(/원문\s+(?:\d{4}년\s*)?(\d{1,2})월\s*(\d{1,2})일(?:\s+(오전|오후)?\s*(\d{1,2}):(\d{2}))?/);
    const manager = String(managerName || '').trim() || '담당자 미지정';
    if (!stamp) return `카-일시 미확인 ${manager}`;
    const [, month, day, period, hour, minute] = stamp;
    const time = hour ? (period ? Number(hour) % 12 + (period === '오후' ? 12 : 0) : Number(hour)) : null;
    return `카-${Number(month)}/${Number(day)}${time === null ? '' : ` ${time}:${minute}`} ${manager}`;
  }
  return note === '소량' ? '' : note;
}
