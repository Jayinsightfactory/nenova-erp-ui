// Historical receiving/cost evidence: docs/plans/profit-cost-source-recovery-2026-10-23.md
// and docs/work-sessions/2026-10-29_profit-stem-independent-audit.md.
// Selection alone confers no extraction, receipt, or costing capability.
export const SUPPLEMENTAL_PACKING_ORIGINS = [
  { code: 'NZ', name: '뉴질랜드 (New Zealand)', desc: '지원 서식 원본 확인 · 검토 후 입고' },
  { code: 'JP', name: '일본 (Japan)', desc: '국가 선택 가능 · 패킹·입고·원가 미지원' },
  { code: 'IL', name: '이스라엘 (Israel)', desc: '국가 선택 가능 · 패킹·입고·원가 미지원' },
];

const issuer = /\bNew Zealand Bloom Ltd\b/i;
const origin = /\bwholly grown in New Zealand\b/i;
const money = /^(?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2}$/;
const cents = value => Number(value.replace(/[,.]/g, ''));

export function nzOriginComparisonDocument(invoice) {
  return {
    documentId:invoice.invoice,
    rawMetadata:{currency:invoice.currency,metadataEvidence:{invoice_total:{page:1,quote:invoice.total}}},
    lines:invoice.products.map((row,index)=>({
      lineId:`${invoice.invoice}:${index+1}`, lineNo:index+1, originalName:row.description, printedUnits:row.units,
      sourceEvidence:{sourcePage:1,descriptionEvidence:{page:1,quote:row.description},sourceFieldStates:{
        boxQuantity:{status:'VALUE',rawValue:row.boxes},
        unitPrice:{status:'VALUE',rawValue:row.price},
        lineAmount:{status:'VALUE',rawValue:row.total},
      }},
    })),
  };
}

export function packingOriginMismatch(pdf, selected) {
  return selected === 'AU' && origin.test(pdf?.text || '')
    ? '선택한 국가: 호주. 원본 원산지: 뉴질랜드. 국가 목록에서 뉴질랜드를 선택하세요. 품목 매칭은 시작하지 않았습니다.'
    : '';
}

export function inspectNzBloomInvoice(pdf) {
  const source = String(pdf?.text || '');
  if (pdf?.pages?.length !== 1 || !issuer.test(source) || !origin.test(source)) return null;
  const rows = [];
  for (const item of [...(pdf.pages[0].items || [])].sort((a,b) => b.y-a.y || a.x-b.x)) {
    const row = rows.at(-1);
    if (row && Math.abs(row[0].y-item.y) <= 2) row.push(item);
    else rows.push([item]);
  }
  const cells = rows.map(row => row.sort((a,b) => a.x-b.x).map(item=>item.str.trim()).filter(Boolean));
  const header = cells.findIndex(row => row.join(' ') === 'Mark Product Variety Boxes Units Price Total');
  const end = cells.findIndex((row,i) => i>header && /\bTotal\s*\(NZD\)/i.test(row.join(' ')));
  const labels = pdf.pages[0].items.filter(item => /^Invoice Number$/i.test(item.str));
  if (labels.length !== 1 || header < 0 || end <= header+1) return null;
  const [label] = labels;
  const ids = pdf.pages[0].items.filter(item => /^\d+$/.test(item.str)
    && Math.abs(item.x-label.x) <= 4 && label.y-item.y > 0 && label.y-item.y <= 30);
  if (ids.length !== 1) return null;
  const subtotal = cells[end].join(' ').match(/^Subtotals\s+(\d+)\s+Total\s*\(NZD\)\s+([\d,.]+)$/i);
  const printed = subtotal?.[2];
  if (!printed || !money.test(printed)) return null;
  const products = [];
  for (const row of cells.slice(header+1,end)) {
    if (row.length !== 6) return null;
    const [description,variety,boxes,units,price,total] = row;
    const count = Number(units.replaceAll(',',''));
    if (!/^\d+$/.test(boxes) || !/^\d[\d,]*$/.test(units) || !Number.isSafeInteger(count) || count <= 0 || !money.test(price) || !money.test(total)
        || count*cents(price) !== cents(total)) return null;
    products.push({description,variety,boxes:Number(boxes),units:count,price,total});
  }
  if (products.reduce((sum,row)=>sum+cents(row.total),0) !== cents(printed)
      || products.reduce((sum,row)=>sum+row.boxes,0) !== Number(subtotal[1])) return null;
  const dateLabel = pdf.pages[0].items.find(item => /^Date$/i.test(item.str) && Math.abs(item.y-label.y)<35);
  const dateCandidates = dateLabel ? pdf.pages[0].items.filter(item => Math.abs(item.x-dateLabel.x)<5
    && dateLabel.y-item.y>0 && dateLabel.y-item.y<=30 && /^\d{1,2}-[A-Za-z]{3}-\d{2,4}$/.test(item.str)) : [];
  const sourceDate = dateCandidates.length===1 ? dateCandidates[0].str : null;
  return { invoice:ids[0].str, supplier:'New Zealand Bloom Ltd', origin:'NZ', currency:'NZD', total:printed, products, sourceDate };
}
