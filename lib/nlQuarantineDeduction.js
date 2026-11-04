// Preview-only transcription of the sample stem counts in NL source sheet 40-2.
// The cheapest landed-cost line in each kind supplies the FOB deduction price.
const SAMPLES = Object.freeze([
  ['Tulip',10,/tulip|튤립/i],['Gerbera',10,/gerbera|거베라/i],['Lily',5,/lily|lilium|백합/i],
  ['Amaryllis',5,/amaryllis|아마릴리스/i],['Astilbe',10,/astilbe|아스틸베/i],
  ['Agapanthus',10,/agapanthus|아가판서스/i],['Hydrangea',10,/hydrangea|수국/i],
  ['Convallaria',10,/convallaria|은방울꽃/i],['Delphinium',10,/delphinium|델피늄/i],
  ['Gladiolus',10,/gladiolus|글라디올러스/i],['Nerine',10,/nerine|네리네/i],
  // Additional reference screenshot, confirmed 2026-11-04: distinct kinds,
  // not replacements for Nerine / Leucothoe from the 40-2 workbook.
  ['Ornithogalum',10,/ornithogalum|오니소갈룸|오르니토갈룸/i],
  ['Calla',10,/calla|카라/i],['Hyacinthus',5,/hyacinthus|hyacinth|히아신스/i],
  ['Skimmia',6,/skimmia|스키미아/i],['Eryngium',5,/eryngium|에린지움/i],
  ['Matricaria',10,/matricaria|마트리카리아/i],['Campanula',10,/campanula|깜바눌라/i],
  ['Eucalyptus',3,/eucalyptus|유칼립투스/i],['Panicum',10,/panicum|파니쿰/i],
  ['Anthurium',5,/anthurium|안시리움/i],['Euphorbia',10,/euphorbia|유포비아/i],
  ['Acacia',6,/acacia|아카시아/i],['Iris',30,/iris|아이리스/i],
  ['Narcissus',20,/narcissus|daffodil|나르시스/i],['Fritilaria',7,/fritillar|프리틸라리아/i],
  ['Clematis',10,/clematis|클레마티스/i],['Sandersonia',6,/sandersonia|샌더소니아/i],
  ['Ruscus',1,/ruscus|루스커스/i],['Allium',10,/\ballium\b|알리움/i],
  ['Pittosporum',10,/pittosporum|피토스포룸/i],['Cymbidium',2,/cymbidium|심비디움/i],
  ['Kangoroo',10,/kangaroo|kangoroo|캥거루/i],['Nutan',10,/nutan|뉴탄/i],
  ['Astrantia',10,/astrantia|아스트란시아/i],['Leucothoe',10,/leucothoe|레우코취/i],
  ['Cordyline',10,/cordyline|코딜라인|코르딜리네/i],
  ['Rose',10,/\brose\b|장미/i],['Cotinus',10,/cotinus|코티누스/i],
  ['Grevillea',10,/grevillea|그레빌레아/i],['Cortaderia',10,/cortaderia|코르타데리아/i],
  ['Fagus',10,/fagus|파구스/i],['Muscari',10,/muscari|무스카리/i],
  ['Lathyrus',10,/lathyrus|sweet pea|스위트피/i],['Sanguisorba',10,/sanguisorba|상귀소르바/i],
  ['Stipa',16,/stipa|스티파/i],['Polygonatum',10,/polygonatum|폴리고나툼/i],
  ['Aran',10,/\baran\b|아란/i],['Lisianthus',10,/lisianthus|리시안/i],
]);

// The renderer and calculator share one source-backed sample-count table.
export const NL_QUARANTINE_SAMPLES = Object.freeze(SAMPLES.map(([kind, stems]) => Object.freeze({kind, stems})));

export function nlQuarantineKind(line) {
  const label = `${line.originalName || ''} ${line.flowerName || ''}`;
  return SAMPLES.find(([, , pattern]) => pattern.test(label))?.[0] || null;
}

function unmatchedKind(line) {
  return String(line.originalName || '').trim().match(/^[\p{L}]+/u)?.[0]
    || (String(line.flowerName || '').trim() !== '기타' ? String(line.flowerName || '').trim() : '')
    || '미분류';
}
export const nlQuarantineGroup = line => nlQuarantineKind(line) || unmatchedKind(line);

export function nlQuarantineDeduction(lines, { freight, exchangeRate, customsBeforeDeduction }) {
  if (!(typeof freight === 'number' && Number.isFinite(freight) && freight >= 0
    && typeof exchangeRate === 'number' && Number.isFinite(exchangeRate) && exchangeRate > 0
    && typeof customsBeforeDeduction === 'number' && Number.isFinite(customsBeforeDeduction)
    && customsBeforeDeduction >= 0)) return { ready: false, reason: '운임·환율·통관비 확인 필요' };
  const quantityLines = lines.filter(line => Number(line.stemQuantity) > 0);
  if (quantityLines.some(line => line.lineAmount == null || line.lineAmount === ''
    || !Number.isFinite(Number(line.lineAmount)) || Number(line.lineAmount) <= 0))
    return { ready: false, reason: '수량 있는 품목의 원문 FOB 금액 확인 필요' };
  const active = quantityLines;
  if (!active.length || active.some(line => !(Number(line.unitPrice) >= 0)
    || typeof line.effectiveTariffRate !== 'number' || !Number.isFinite(line.effectiveTariffRate)
    || line.effectiveTariffRate < 0 || line.effectiveTariffRate > 1))
    return { ready: false, reason: '품목별 원문 FOB 단가 또는 세율 확인 필요' };
  const goods = active.reduce((n,line) => n + Number(line.lineAmount), 0);
  const kinds = [...new Set(active.map(nlQuarantineGroup))];
  const excluded = kinds.filter(kind => !SAMPLES.some(([sample]) => sample === kind));
  const sampledKinds = kinds.filter(kind => !excluded.includes(kind));
  let deduction = 0, selected = [], signature = '';
  const seen = new Set();
  for (let i = 0; i < 32; i++) {
    const customs = customsBeforeDeduction - deduction;
    if (customs < 0) return { ready: false, reason: '검역 차감액이 통관비보다 큽니다' };
    selected = sampledKinds.map(kind => {
      const candidates = active.filter(line => nlQuarantineKind(line) === kind).map(line => {
        const share = Number(line.lineAmount) / goods, stems = Number(line.stemQuantity);
        const fobPerStem = Number(line.lineAmount) / stems;
        const tariff = Number(line.effectiveTariffRate);
        const landed = (fobPerStem + freight * share / stems) * exchangeRate * (1 + tariff)
          + customs * share / stems;
        return { kind, lineId: line.lineId, originalName: line.originalName,
          stems: SAMPLES.find(([name]) => name === kind)[1], fobPerStem,
          landedPerStem: landed, tariffRate: tariff };
      });
      if (candidates.some(row => !Number.isFinite(row.landedPerStem))) return null;
      return candidates.sort((a,b) => a.landedPerStem - b.landedPerStem || String(a.lineId).localeCompare(String(b.lineId)))[0];
    });
    if (selected.some(row => !row)) return { ready: false, reason: '품목 세율 확인 필요' };
    const nextSignature = selected.map(row => row.lineId).join('|');
    const nextDeduction = selected.reduce((n,row) => n + row.stems * row.fobPerStem * exchangeRate, 0);
    if (nextSignature === signature && Math.abs(nextDeduction - deduction) < .000001)
      return { ready: true, kindCount: kinds.length, excluded: excluded.map(kind => ({ kind, reason: '원본 샘플표에 차감 송이수 없음 · 0원' })), deduction: nextDeduction,
        selected: selected.map(row => ({ ...row, deductionKRW: row.stems * row.fobPerStem * exchangeRate })) };
    if (seen.has(nextSignature)) return { ready: false, reason: '최저 도착원가 품목이 차감 계산 중 교차합니다. 수동 확인 필요' };
    seen.add(nextSignature); signature = nextSignature; deduction = nextDeduction;
  }
  return { ready: false, reason: '검역 차감 계산이 수렴하지 않습니다' };
}
