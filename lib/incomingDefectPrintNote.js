// Display only. The ledger keeps the full Kakao provenance for reconciliation.
export function incomingDefectPrintNote(value) {
  const note = String(value ?? '').trim();
  if (/kakao-defect:/i.test(note)) {
    const stamp = note.match(/원문\s+(?:\d{4}년\s*)?(\d{1,2})월\s*(\d{1,2})일(?:\s+(오전|오후)?\s*(\d{1,2}):(\d{2}))?/);
    if (!stamp) return '';
    const [, month, day, period, hour, minute] = stamp;
    return `카톡 ${Number(month)}월 ${Number(day)}일${hour ? ` ${period ? period + ' ' : ''}${Number(hour)}:${minute}` : ''}`;
  }
  return note === '소량' ? '' : note;
}
