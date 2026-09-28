// Read-only navigation within the server-authorized major category.
// Never changes stored stage, sensitive flags, access scope, or arrival-cost ingestion.
const RULES = {
  '발주': [['컨펌·확정', /컨펌|confirm|확정/i], ['물량·취합', /물량|취합/i], ['발주·주문서', /발주|주문|order|pedido/i]],
  '입고': [['패킹리스트', /packing|패킹/i], ['검역·원산지', /phyto|검역|원산지|\bco\b/i], ['AWB·선적', /awb|선적|shipping|b\/l|\bbl\b/i], ['인보이스·Proforma', /invoice|인보이스|proforma|\bci\b/i], ['입고목록', /입고/i]],
  '원가·운임': [['원가자료', /원가|arrival/i], ['통관·관세', /통관|관세|customs/i], ['운임·물류', /운임|freight|물류|운송/i]],
  '출고': [['차감내역', /차감/i], ['분배·배송', /분배|배송|납품/i], ['출고내역', /출고|shipment|박스|물량/i]],
  '견적·거래처': [['단가·가격표', /단가|가격표/i], ['거래명세·청구', /명세|청구|invoice/i], ['견적서', /견적|estimate|quotation/i], ['판매현황', /판매/i]],
  '송금·경영': [['지출결의', /지출결의|결의서/i], ['계좌·사업자서류', /계좌|통장|사업자|위임장/i], ['손익·매출보고', /손익|이익|매출|수입비교|월말재고|결산/i], ['급여·예산', /급여|예산/i], ['세금·정산', /세금|계산서|정산|면장|credit|settle/i], ['송금·결제', /송금|외화|입금|결제|증빙|사용내역|CNY|USD|EUR/i]],
  '품질': [['피드백·개선', /피드백|feedback|개선|답변/i], ['불량·클레임', /불량|claim|클레임|하자|defect|reclamo/i], ['품질·이슈보고', /품질|quality|이슈|issue/i]],
};
const UNCLASSIFIED = ['엑셀·CSV', 'PDF', '문서·PPT', '이미지', '기타 파일'];

export function subcategories(stage) {
  if (stage === '미분류') return [...UNCLASSIFIED];
  return RULES[stage] ? [...RULES[stage].map(([label]) => label), '기타 ' + stage] : [];
}

export function fileSubcategory(file) {
  if (file.stage === '미분류') {
    const ext = String(file.ext || String(file.filename || '').split('.').pop()).toLowerCase().replace(/^\./, '');
    return /^(xlsx?|xlsm|xlsb|csv)$/.test(ext) ? UNCLASSIFIED[0] : ext === 'pdf' ? UNCLASSIFIED[1]
      : /^(docx?|hwpx?|txt|pptx?)$/.test(ext) ? UNCLASSIFIED[2]
      : /^(png|jpe?g|gif|webp|bmp|heic)$/.test(ext) ? UNCLASSIFIED[3] : UNCLASSIFIED[4];
  }
  const rules = RULES[file.stage];
  if (!rules) return '';
  return rules.find(([, pattern]) => pattern.test(String(file.filename || '')))?.[0] || '기타 ' + file.stage;
}

export function filterCategories(files, stage, subcategory) {
  return files.filter((file) => (!stage || file.stage === stage)
    && (!stage || !subcategory || fileSubcategory(file) === subcategory));
}

export function subcategoryCounts(files, stage) {
  const counts = Object.fromEntries(subcategories(stage).map((label) => [label, 0]));
  for (const file of files) if (file.stage === stage) {
    const label = fileSubcategory(file);
    if (Object.hasOwn(counts, label)) counts[label]++;
  }
  return counts;
}
