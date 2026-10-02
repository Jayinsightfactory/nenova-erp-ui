import { normalizePasteToken } from './pasteLocalMapping.js';

// One browser queues alias writes. A confirmed ERP save is never retried here.
export function createPasteMappingSaver({ post, onSaved = () => {}, onState = () => {} }) {
  let tail = Promise.resolve();
  const failed = new Map();
  let pending = 0;
  const publish = () => onState({ pending, failures: [...failed.values()].map(x => ({ key: x.key, inputName: x.item.inputName, error: x.error })) });
  function save(item, prod) {
    const key = normalizePasteToken(item?.inputName);
    if (!key || !Number.isInteger(Number(prod?.ProdKey)) || Number(prod.ProdKey) <= 0) return Promise.resolve(null);
    const value = { prodKey: Number(prod.ProdKey), prodName: prod.ProdName, displayName: prod.DisplayName, flowerName: prod.FlowerName, counName: prod.CounName };
    const manual = item.manualSelection !== false;
    pending++; publish();
    const work = tail.then(async () => {
      try {
        const result = await post({ inputToken: item.inputName, ...value, force: true, manual });
        if (result?.success !== true || !result.key) throw new Error(result?.error || '매칭 저장 응답 확인 실패');
        failed.delete(key);
        const saved = { key: result.key, value: { ...value, manual } };
        onSaved(saved);
        return saved;
      } catch (error) {
        failed.set(key, { key, item: { inputName: item.inputName, manualSelection: manual }, prod, error: error?.message || '서버 매칭 저장 실패' });
        return null;
      } finally { pending--; publish(); }
    });
    tail = work.catch(() => {});
    return work;
  }
  return { save, discardFailures: (keys = []) => { keys.forEach(key => failed.delete(normalizePasteToken(key))); publish(); }, retry: () => Promise.all([...failed.values()].map(x => save(x.item, x.prod))) };
}

export function uniquePasteMappingItems(items = []) {
  const byAlias = new Map(), conflicts = new Set();
  for (const item of items) {
    const key = normalizePasteToken(item?.inputName);
    if (!key || !item.prodKey || item.skip) continue;
    if (byAlias.has(key) && Number(byAlias.get(key).prodKey) !== Number(item.prodKey)) conflicts.add(key);
    else byAlias.set(key, item);
  }
  return { items: [...byAlias].filter(([key]) => !conflicts.has(key)).map(([, item]) => item), conflicts: [...conflicts] };
}
