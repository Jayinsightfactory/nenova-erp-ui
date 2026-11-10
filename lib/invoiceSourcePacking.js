// Cost-only packing evidence. Never changes ERP receipt quantities.
const positive = value => typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
export function sourcePackingForCost(line, evidence = {}) {
  const stems = positive(line.stemQuantity), boxes = positive(line.boxQuantity), bunches = positive(line.bunchQuantity);
  const source = evidence.packing || {};
  let stemsPerBunch = stems && bunches ? stems / bunches : positive(source.stemsPerBunch);
  const stemsPerBox = stems && boxes ? stems / boxes : null;
  if (source.stemsPerBox != null && stemsPerBox && Math.abs(source.stemsPerBox - stemsPerBox) > 1e-6) stemsPerBunch = null;
  if (source.stemsPerBunch != null && stems && bunches && Math.abs(source.stemsPerBunch - stems / bunches) > 1e-6) stemsPerBunch = null;
  return {stemsPerBunch, bunchesPerBox: stemsPerBunch && stemsPerBox ? stemsPerBox / stemsPerBunch : null};
}
