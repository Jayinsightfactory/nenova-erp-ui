// Raw messages are evidence, not executable instructions or proof of ERP completion.
const MAX_TEXT_BYTES = 2 * 1024 * 1024;
function validCalendarDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0,10) === value;
}
function periodBounds(from, to) {
  if (!validCalendarDate(from) || !validCalendarDate(to)) throw new Error('조회 시작일과 종료일을 확인하세요.');
  const start = new Date(`${from}T00:00:00+09:00`), end = new Date(`${to}T00:00:00+09:00`);
  end.setTime(end.getTime() + 86400000);
  if (end <= start || end - start > 7 * 86400000) throw new Error('한 번에 최대 7일을 선택하세요.');
  return { from: start.toISOString(), to: end.toISOString() };
}
function parseSalesExport(text) {
  if (typeof text !== 'string' || new TextEncoder().encode(text).length > MAX_TEXT_BYTES) throw new Error('2MB 이하의 카카오 대화 텍스트 파일을 선택하세요.');
  const room = text.replace(/^\uFEFF/,'').split(/\r?\n/,1)[0].replace(/\s+님과 카카오톡 대화\s*$/,'').trim();
  const rows = []; let date = '', current = null;
  for (const line of text.replace(/^\uFEFF/, '').replace(/\r\n?/g,'\n').split('\n')) {
    const d = line.match(/^-+\s*(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일/);
    if (d) { if (current) rows.push(current); current = null; date = `${d[1]}-${d[2].padStart(2,'0')}-${d[3].padStart(2,'0')}`; continue; }
    const m = line.match(/^\[(.+?)\]\s*\[(오전|오후)\s*(\d{1,2}):(\d{2})\]\s?(.*)$/);
    if (m) {
      if (current) rows.push(current);
      const h = Number(m[3]), minute = Number(m[4]);
      const iso = validCalendarDate(date) && h >= 1 && h <= 12 && minute < 60 ? `${date}T${String(h%12+(m[2]==='오후'?12:0)).padStart(2,'0')}:${m[4]}:00+09:00` : '';
      current = { sender:m[1], message:m[5], created_at:iso, timestamp_approximate:!iso, source:'uploaded-kakao', chatroom:room.length<=100 && !room.startsWith('[')?room:'업로드 대화', message_type:'text' };
    } else if (current) current.message += `\n${line}`;
  }
  if (current) rows.push(current);
  if (!rows.length) throw new Error('카카오 내보내기 형식을 찾지 못했습니다. 일반 변경 문장은 기존 입력칸에 붙여넣으세요.');
  return rows.map(r=>({...r,message:r.message.trimEnd()}));
}
function mergeMessages(oldRows, rows) {
  const map = new Map(oldRows.map(r=>[r.identity,r])); let duplicateCount=0;
  for (const r of rows) {
    if (!r.identity) throw new Error('메시지 식별값이 없습니다.');
    if (map.has(r.identity)) { duplicateCount++; continue; }
    map.set(r.identity,r);
  }
  return {rows:[...map.values()].sort((a,b)=>String(a.created_at).localeCompare(String(b.created_at)) || String(a.identity).localeCompare(String(b.identity))),duplicateCount};
}
function selectedText(rows, selected) {
  return rows.filter(r=>selected[r.identity]).map(r=>r.message).join('\n\n');
}
module.exports={MAX_TEXT_BYTES,periodBounds,parseSalesExport,mergeMessages,selectedText};
