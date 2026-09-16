const MENU_HISTORY_KEY = 'nvMenuNavigationHistory';
const MENU_BACK_REQUEST_EVENT = 'nenova:menu-back-request';
const MENU_PAGE_RESET_EVENT = 'nenova:menu-page-reset';
const MAX_MENU_HISTORY = 30;

function requestContextualMenuBack(target) {
  if (!target || typeof target.dispatchEvent !== 'function' || typeof target.CustomEvent !== 'function') return false;
  const event = new target.CustomEvent(MENU_BACK_REQUEST_EVENT, { cancelable: true });
  target.dispatchEvent(event);
  return event.defaultPrevented;
}

function requestMenuPageReset(target) {
  if (!target || typeof target.dispatchEvent !== 'function' || typeof target.CustomEvent !== 'function') return false;
  target.dispatchEvent(new target.CustomEvent(MENU_PAGE_RESET_EVENT));
  return true;
}

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
  MENU_BACK_REQUEST_EVENT,
  MENU_PAGE_RESET_EVENT,
  requestContextualMenuBack,
  requestMenuPageReset,
  rememberMenuRoute,
  takePreviousMenuRoute,
};
