const { validateReceipt } = require('./customsSettlementPlan.cjs');
const fail = (stage = 'layout') => { throw Object.assign(Error('정형 정산표의 신고번호·AWB·비용을 검산하지 못했습니다. 원본 확인이 필요합니다.'), { statusCode: 422, code: `SETTLEMENT_${stage.toUpperCase()}` }); };
function parseSettlementPage(page, sourceHash) {
  if (!page || page.page !== 1 || !Array.isArray(page.items) || ![page.width, page.height].every(v => Number.isFinite(v) && v > 0)) fail();
  const items = page.items.map(r => ({ ...r, x: r.x / page.width, y: r.y / page.height, width: r.width / page.width, height: r.height / page.height }));
  // Layout is a versioned first-page template, not fuzzy free-form financial parsing.
  const at = (y, left, right, tolerance = 0.009) => items.filter(r => Math.abs(r.y - y) < tolerance && r.x >= left && r.x < right).sort((a, b) => a.x - b.x).map(r => r.str).join('');
  const label = text => items.filter(r => r.x < 0.25 && r.str.replace(/\s/g, '').includes(text));
  const duty = label('관세').filter(r => !r.str.includes('부가'));
  const agency = items.filter(r => r.x < .25 && /검역|행수수료/.test(r.str)).filter((r, i, all) => all.findIndex(other => Math.abs(other.y - r.y) < .009) === i);
  const totals = label('비용합');
  const importVat = label('부가세');
  if (duty.length !== 1 || importVat.length !== 1 || totals.length !== 1 || agency.length > 1) fail('anchors');
  const dutyY = duty[0].y, totalY = totals[0].y;
  const step = dutyY - importVat[0].y;
  const rowCount = Math.round((dutyY - totalY) / step);
  if (!(step > 0.012 && step < 0.03) || ![2, 4].includes(rowCount) || Math.abs(dutyY - totalY - step * rowCount) > 0.009
    || (rowCount === 4 && (agency.length !== 1 || Math.abs(agency[0].y - dutyY + step * 3) > .009))) fail('rows');
  const numberAt = (y, left, right) => { const raw = at(y, left, right); if (!/^(?:\d+|\d{1,3}(?:[,.]\d{3})+)$/.test(raw)) fail('amount'); const n = Number(raw.replace(/[,.]/g, '')); if (!Number.isSafeInteger(n)) fail('amount'); return n; };
  const codes = ['DUTY', 'IMPORT_VAT', 'HANDLING', 'QUARANTINE_AGENCY'].slice(0, rowCount);
  const charges = codes.map((code, i) => {
    const y = dutyY - step * i, net = numberAt(y, .26, .37), total = numberAt(y, .48, .61);
    let vat, vatSource = 'ocr';
    try { vat = numberAt(y, .38, .47); } catch (error) {
      // Only a nonnumeric fee VAT cell may be derived; never tax/net/gross/grand total.
      if (['DUTY', 'IMPORT_VAT'].includes(code) || net <= 0 || net % 10 !== 0 || total !== net + net / 10) throw error;
      vat = total - net; vatSource = 'VAT_DERIVED_FROM_NET_TOTAL';
    }
    return { code, net, vat, total, vatSource };
  });
  const arrivalDates = items.filter(r => r.x >= .19 && r.x < .31 && r.y > .68 && /^20\d{2}[-_]\d{2}[-_]\d{2}$/.test(r.str)).sort((a, b) => b.y - a.y);
  if (!arrivalDates.length) fail('date');
  const headerY = arrivalDates[0].y;
  const directIds = items.map(r => r.str.replace(/_/g, '-')).filter(s => /^\d{5}-\d{2}-\d{6}[A-Z]$/i.test(s));
  const documentId = directIds.length === 1 ? directIds[0] : at(headerY, .40, .65).replace(/_/g, '-');
  if (!/^\d{5}-\d{2}-\d{6}[A-Z]$/i.test(documentId)) fail('declaration');
  const awb = at(headerY - step, .40, .65).replace(/[\s-]/g, '');
  const date = arrivalDates[0].str.replace(/_/g, '-');
  if(documentId.split('-')[1]!==date.slice(2,4))fail('declaration_year');
  const receipt = { issuer: 'SUNYUL', documentId, sourceHash, awb, date, charges, total: numberAt(totalY, .48, .61), template: 'SUNYUL_FIRST_PAGE_V1' };
  const decimalAt = (y,left,right) => { const text=at(y,left,right).replace(/,/g,'').replace(/KGS?$/i,''); return /^\d+(?:\.\d+)?$/.test(text)?Number(text):null; };
  const currencies=items.filter(r=>r.x>=.76&&r.x<.92&&Math.abs(r.y-headerY+step*3)<.009&&/^(USD|CNY|EUR|JPY|AUD)$/.test(r.str));
  receipt.currency=currencies.length===1?currencies[0].str:null;
  receipt.foreignAmount=decimalAt(headerY-step*4,.76,.92);
  receipt.grossWeight=decimalAt(headerY-step*4,.19,.31);
  return validateReceipt(receipt);
}
module.exports = { parseSettlementPage };
