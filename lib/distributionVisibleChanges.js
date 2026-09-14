'use strict';

// Display-only grouping. The analysis action always receives the original message.
function visibleChanges(message, selectedWeek) {
  const lines = String(message || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const result = [];
  let week = '', customer = '', context = '', action = '';
  for (const line of lines) {
    const scope = line.match(/^(?:(\d{4})[-년\s]+)?(\d{1,2})\s*-\s*(\d{1,2})(?=\s|차|$)/);
    if (scope) {
      week = `${scope[1] ? `${scope[1]}-` : ''}${scope[2].padStart(2, '0')}-${scope[3].padStart(2, '0')}`;
      context = line.slice(scope[0].length).replace(/변경사항|변경 요청/g, '').trim();
      customer = ''; action = '';
      continue;
    }
    if (/^(추가|취소|삭제)$/.test(line)) { action = line; continue; }
    const hasQuantity = /\d+(?:\.\d+)?\s*(?:박스|단|송이|개|대|box|bunch|stem)/i.test(line);
    if (hasQuantity) {
      const inline = line.match(/^(.+?)\s+[-:：]\s*(.+)$/);
      if (inline) customer = inline[1].trim();
      const change = inline ? inline[2] : line;
      const explicit = change.match(/취소|추가|삭제/);
      if (explicit) action = explicit[0];
      result.push({ week: week || `${selectedWeek || '미선택'} (선택)`, customer: customer || '업체 확인 필요', change: `${context ? `${context} · ` : ''}${change}${!explicit && action ? ` ${action}` : ''}` });
      continue;
    }
    if (/변경사항|변경 요청/.test(line)) { context = line.replace(/변경사항|변경 요청/g, '').trim(); continue; }
    if (/출고|부탁|해주세요|해 주세요|^[-→>]|재고|잔량/.test(line)) continue;
    customer = line;
  }
  return result.length ? result : [{week: week || `${selectedWeek || '미선택'} (선택)`, customer: '자동 분류 확인 필요', change: String(message || '')}];
}

module.exports = { visibleChanges };
