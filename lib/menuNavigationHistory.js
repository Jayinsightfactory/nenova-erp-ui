const MENU_HISTORY_KEY = 'nvMenuNavigationHistory';
const MAX_MENU_HISTORY = 30;

function safePath(value) {
  const path = String(value || '').trim();
  return path.startsWith('/') && !path.startsWith('//') ? path : '';
}

function readMenuHistory(storage) {
  if (!storage) return [];
  try {
    const parsed = JSON.parse(storage.getItem(MENU_HISTORY_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.map(safePath).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function writeMenuHistory(storage, history) {
  if (!storage) return;
  try {
    storage.setItem(MENU_HISTORY_KEY, JSON.stringify(history.slice(-MAX_MENU_HISTORY)));
  } catch {}
}

function rememberMenuRoute(path, storage) {
  const target = safePath(path);
  if (!target || !storage) return;
  const history = readMenuHistory(storage);
  if (history[history.length - 1] !== target) history.push(target);
  writeMenuHistory(storage, history);
}

function takePreviousMenuRoute(currentPath, storage) {
  const current = safePath(currentPath);
  const history = readMenuHistory(storage);
  let target = '';
  while (history.length && !target) {
    const candidate = history.pop();
    if (candidate && candidate !== current) target = candidate;
  }
  writeMenuHistory(storage, history);
  return target;
}

module.exports = {
  MENU_HISTORY_KEY,
  rememberMenuRoute,
  takePreviousMenuRoute,
};
