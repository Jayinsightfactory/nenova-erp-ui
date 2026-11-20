// Approved workbook policy: Vietnamese service fees include their evidenced VAT.
// Import VAT is never a service cost. Unknown legacy amounts are not multiplied.
const present = value => value !== null && value !== undefined && value !== '';
const verified = [
  { year: '2026', major: '35', orderWeek: '35-01', awb: '73806000993', net: 63000, vat: 6300, gross: 69300, pdfSha256: '771975f17052d97f6d6207510f82ab0175b88004447951203b5d2b379bdf9e4f' },
  { year: '2026', major: '37', orderWeek: '37-01', awb: '73806001310', net: 63000, vat: 6300, gross: 69300, pdfSha256: '6e2bb9e13f7a9d9f60db9018752d33ff9f293c70fa4b61e038bc99d2b4ca8126' },
];
function projectVietnamGross(row, ledger, scope = {}) {
  let result = row;
  for (const phase of [1, 2]) {
    const docs = (ledger.documents || []).filter(doc => doc.targetKey === `country|베트남|0${phase}`);
    const charges = docs.flatMap(doc => doc.charges.filter(c => ['HANDLING', 'QUARANTINE_AGENCY'].includes(c.code)));
    let evidence = charges.length ? { net: charges.reduce((s,c)=>s+c.net,0), vat: charges.reduce((s,c)=>s+c.vat,0), gross: charges.reduce((s,c)=>s+c.total,0), source: 'settlement_receipts', documents: docs.map(doc=>doc.documentId) } : null;
    if (!evidence) {
      const proof = verified.find(v => v.year === String(scope.year) && v.major === String(scope.major).padStart(2,'0') && v.orderWeek === `${v.major}-0${phase}`);
      const awbs = [...new Set((scope.awbSources || []).filter(s => String(s.year) === String(scope.year) && s.orderWeek === proof?.orderWeek).map(s => String(s.awb).replace(/[\s-]/g,'')))];
      if (proof && awbs.length === 1 && awbs[0] === proof.awb) evidence = { ...proof, source: 'verified_pdf_exact_awb' };
    }
    if (!evidence) continue;
    const stem = `SunYul${phase}`, parts = [1,2,3].map(i=>`${stem}_${i}`);
    const value = parts.some(f=>present(result?.[f])) ? parts.reduce((s,f)=>s+Number(result[f]??0),0) : present(result?.[stem]) ? Number(result[stem]) : null;
    // A verified historical PDF does not fill a missing record; it only explains a matching amount.
    if (value === null || value === 0 && evidence.net !== 0) continue;
    if (value !== evidence.net && value !== evidence.gross) continue;
    result = { ...(result || {}), [stem]: evidence.gross, [`${stem}_1`]: evidence.gross, [`${stem}_2`]: null, [`${stem}_3`]: null,
      VietnamFeeEvidence: [...(result?.VietnamFeeEvidence || []).filter(e=>e.phase!==phase), { phase, ...evidence, before: value, applied: evidence.gross, policy: 'workbook_gross' }] };
  }
  return result;
}
module.exports = { projectVietnamGross };
