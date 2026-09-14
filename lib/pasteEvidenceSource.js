'use strict';
function mappedEvidenceSource(messages,orders) {
  if(messages.length!==1||!orders.length)return messages;
  if(orders.some(order=>!order.custMatch?.CustKey||!order.custMatch?.CustName||!order.items?.length||order.items.some(item=>item.skip||!item.prodKey||!item.prodName||!(Number(item.qty)>0)||!['추가','취소'].includes(item.action))))return messages;
  const original=messages[0];
  // Preserve original scope and timestamp; matching names may not move a request to another week.
  const scopes=String(original.message).split(/\r?\n/).map(line=>line.trim().match(/^((?:20\d{2}-)?\d{1,2}\s*-\s*\d{1,2})(?=차|\s|$)/)?.[1]).filter(Boolean);
  const lines=[...scopes];
  for(const order of orders) {
    lines.push(order.custMatch.CustName);
    for(const item of order.items)lines.push(`${item.prodName} ${item.qty}${item.unit} ${item.action}`);
  }
  return [{...original,message:lines.join('\n')}];
}
module.exports={mappedEvidenceSource};
