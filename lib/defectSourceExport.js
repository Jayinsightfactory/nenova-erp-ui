// Raw messages stay in memory. Reports contain hashes/ordinals and business keys.
export function parseDefectSourceExport(text) {
  if (!String(text).split(/\r?\n/)[0].includes('네노바 수입(불량 공유방)')) throw new Error('불량 공유방 원문 파일이 아닙니다.');
  const messages = []; let date = '', current = null;
  for (const line of String(text).split(/\r?\n/)) {
    const day = line.match(/^-+\s+(\d{4}년 \d+월 \d+일)/);
    if (day) { date = day[1]; current = null; continue; }
    const message = line.match(/^\[([^\]]+)\] \[((?:오전|오후) \d+:\d+)\] (.*)$/);
    if (message) { current = { ordinal: messages.length + 1, stamp: `${date} ${message[2]}`, content: message[3] }; messages.push(current); }
    else if (current) current.content += `\n${line}`;
  }
  for (const message of messages) message.content = message.content.split('\n')
    .filter(line => !/^.*님이 .*님을 초대했습니다\.$|^.*님이 (들어왔습니다|나갔습니다)\.$/.test(line.trim())).join('\n').trim();
  return messages;
}
