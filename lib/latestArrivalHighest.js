// All candidates must have a comparable KRW unit before a maximum can be claimed.
export function highestComparableArrival(refs = []) {
  const unit = refs[0]?.unit;
  if (!unit || refs.some(ref => ref.unit !== unit || !Number.isFinite(ref.cost) || ref.conversionError)) return null;
  return refs.reduce((highest, ref) => ref.cost > highest.cost ? ref : highest);
}
