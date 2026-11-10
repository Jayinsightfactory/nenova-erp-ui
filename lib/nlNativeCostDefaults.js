import { isGrossWeightItem, isChargeableWeightItem } from './freightCalc.js';
import { nlInvoiceTariffRate } from './nlInvoiceTariffReference.js';
import { INVOICE_COST_FORMULAS } from './invoiceReceiptCost.js';
import { nlCompanyTemplateCost } from './nlCompanyTemplateCost.js';
import { receiptFreightAmount } from './invoiceReceiptExpenses.js';

// Preview/download only. These company-template defaults are not an actual bill
// or permission to change historical receipt/cost/profit records.
export function nlNativeCostDefaults(source, quote) {
  if (source.country !== 'NL') return null;
  const formula = INVOICE_COST_FORMULAS.NL_AMOUNT_V1;
  const freightRows = source.excluded.filter(row => !isGrossWeightItem(row.name) && !isChargeableWeightItem(row.name));
  const legacyFreightKnown = freightRows.length > 0 && freightRows.every(row => typeof row.amount === 'number' && Number.isFinite(row.amount) && row.amount >= 0);
  const gwKnown = typeof source.gw === 'number' && Number.isFinite(source.gw) && source.gw > 0;
  const lineInputs = source.lines.map(line => ({ lineId: line.lineId,
    tariffRate: typeof line.tariffRate === 'number' && Number.isFinite(line.tariffRate) && line.tariffRate >= 0 && line.tariffRate <= 1
      ? line.tariffRate : nlInvoiceTariffRate(line.originalName, line.originName),
    stemsPerBunch: ['단','BUNCH','BUNCHES'].includes(String(line.outUnit).trim().toUpperCase()) && line.outQuantity > 0 && line.stemQuantity > 0
      ? line.stemQuantity / line.outQuantity : line.stemsPerBunch }));
  const freightAmount = receiptFreightAmount(source, legacyFreightKnown ? freightRows.reduce((sum, row) => sum + row.amount, 0) : null);
  const freightKnown = freightAmount != null;
  const prepared = source.lines.map((line,i) => ({ ...line, effectiveTariffRate: lineInputs[i].tariffRate }));
  const template = nlCompanyTemplateCost(prepared, { gw: source.gw, freight: freightAmount,
    exchangeRate: quote?.rate });
  const input = {
    formulaId: formula.formulaId, formulaVersion: formula.formulaVersion,
    formulaSourceHash: formula.formulaSourceHash, formulaSourceSheet: formula.formulaSourceSheet,
    formulaSourceCells: formula.formulaSourceCells, formulaEffectiveDate: source.inputDate,
    formulaApplicabilityConfirmed: true, nativeCurrency: 'EUR', freightCurrency: 'EUR',
    freightAmount,
    exchangeRateKRW: quote?.rate ?? null, exchangeRateType: quote?.rateType ?? 'LIVE_MARKET_PLUS_15',
    exchangeRateDate: quote?.requestedAt?.slice(0,10) ?? '', exchangeRateSource: quote?.source ?? '',
    exchangeRateSourceUrl: quote?.sourceUrl ?? '', exchangeRateMarketRate: quote?.marketRate ?? null,
    exchangeRateAdjustmentKRW: quote?.adjustmentKRW ?? 15,
    customsTotalKRW: template.ready ? template.total : null, expenseBasis: 'ESTIMATED',
    nlTemplateCosts: template.ready ? template.costs : null,
    estimateSource: template.estimateSource || '네덜란드 서식 기본값을 계산할 수 없습니다. 부족한 근거를 확인하세요.',
    allocationScope: 'SINGLE_INVOICE', allocationShareNumerator: 1, allocationShareDenominator: 1,
    costSourceId: `입고 ${source.warehouseKey} · 네덜란드 서식 자동 계산본`,
    lineInputs,
  };
  const missing = [!freightKnown && '입고 운송료', !gwKnown && 'GW 중량', !(quote?.rate > 0) && '현재 EUR 환율',
    freightKnown && gwKnown && quote?.rate > 0 && !template.ready && template.reason].filter(Boolean);
  return { metadata: {currency:'EUR',transportMode:'AIR',gw:source.gw ?? '',cw:source.cw ?? ''}, input, missing,
    provenance: { freight: '동일 연도·세부차수·입고의 저장 운송료', customs: input.estimateSource,
      quarantineSelections: template.costs?.selections ?? [], quarantineExcluded: template.costs?.excluded ?? [], rate: quote ?? null } };
}
