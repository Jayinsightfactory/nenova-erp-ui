import { NL_FREIGHT_DEFAULT_CUSTOMS, nlExcelTariffRate, isGrossWeightItem, isChargeableWeightItem } from './freightCalc.js';
import { INVOICE_COST_FORMULAS } from './invoiceReceiptCost.js';

// Preview/download only. These company-template defaults are not an actual bill
// or permission to change historical receipt/cost/profit records.
export function nlNativeCostDefaults(source, quote) {
  if (source.country !== 'NL') return null;
  const formula = INVOICE_COST_FORMULAS.NL_AMOUNT_V1;
  const freightRows = source.excluded.filter(row => !isGrossWeightItem(row.name) && !isChargeableWeightItem(row.name));
  const freightKnown = freightRows.length > 0 && freightRows.every(row => typeof row.amount === 'number' && Number.isFinite(row.amount) && row.amount >= 0);
  const constants = NL_FREIGHT_DEFAULT_CUSTOMS;
  const gwKnown = typeof source.gw === 'number' && Number.isFinite(source.gw) && source.gw > 0;
  const customs = gwKnown ? source.gw * constants.bakSangRate + constants.handlingFee
    + source.lines.length * constants.quarantinePerItem + constants.domesticFreight + constants.extraFee - constants.deductFee : null;
  const input = {
    formulaId: formula.formulaId, formulaVersion: formula.formulaVersion,
    formulaSourceHash: formula.formulaSourceHash, formulaSourceSheet: formula.formulaSourceSheet,
    formulaSourceCells: formula.formulaSourceCells, formulaEffectiveDate: source.inputDate,
    formulaApplicabilityConfirmed: true, nativeCurrency: 'EUR', freightCurrency: 'EUR',
    freightAmount: freightKnown ? freightRows.reduce((sum, row) => sum + row.amount, 0) : null,
    exchangeRateKRW: quote?.rate ?? null, exchangeRateType: quote?.rateType ?? 'LIVE_MARKET_PLUS_15',
    exchangeRateDate: quote?.requestedAt?.slice(0,10) ?? '', exchangeRateSource: quote?.source ?? '',
    exchangeRateSourceUrl: quote?.sourceUrl ?? '', exchangeRateMarketRate: quote?.marketRate ?? null,
    exchangeRateAdjustmentKRW: quote?.adjustmentKRW ?? 15,
    customsTotalKRW: customs, expenseBasis: 'ESTIMATED',
    estimateSource: '네덜란드 기존 원가자료 24-2~37-2 공통서식: GW×460 + 33,000 + 품목수×10,000 + 국내운송90,000 + 소독220,000 - 검역차감0. 실제 청구액이 아닌 수정 가능한 서식 기본값.',
    allocationScope: 'SINGLE_INVOICE', allocationShareNumerator: 1, allocationShareDenominator: 1,
    costSourceId: `입고 ${source.warehouseKey} · 네덜란드 서식 자동 계산본`,
    lineInputs: source.lines.map(line => ({ lineId: line.lineId,
      tariffRate: typeof line.tariffRate === 'number' && Number.isFinite(line.tariffRate) && line.tariffRate >= 0 && line.tariffRate <= 1
        ? line.tariffRate : nlExcelTariffRate(line.originalName),
      // The saved receipt's actual bunch/stem relationship wins over a stale
      // master/packing factor (Nicholii: 50 bunches,150 stems, stored factor1).
      stemsPerBunch: ['단','BUNCH','BUNCHES'].includes(String(line.outUnit).trim().toUpperCase()) && line.outQuantity > 0 && line.stemQuantity > 0
        ? line.stemQuantity / line.outQuantity : line.stemsPerBunch })),
  };
  const missing = [!freightKnown && '입고 운송료', !gwKnown && 'GW 중량', !(quote?.rate > 0) && '현재 EUR 환율'].filter(Boolean);
  return { metadata: {currency:'EUR',transportMode:'AIR',gw:source.gw ?? '',cw:source.cw ?? ''}, input, missing,
    provenance: { freight: '동일 연도·세부차수·입고의 저장 운송료', customs: input.estimateSource, rate: quote ?? null } };
}
