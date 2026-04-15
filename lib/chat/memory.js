// lib/chat/memory.js — 세션 단위 대화 기록 (인메모리)
//
// 목적: 사용자의 후속 질문 ("아까 그거 박스 수량이 이상한데?") 이해 가능하도록
// 최근 N턴의 Q&A 를 LLM 프롬프트에 주입.
//
// 특성:
// - 프로세스 메모리 (pm2 재시작 시 소실 — 그걸로 OK)
// - userId 단위 분리
// - TTL 30분 (비활성 세션 자동 정리)
// - 최근 6턴까지만 유지 (토큰 폭증 방지)

const MAX_TURNS = 6;
const TTL_MS = 30 * 60 * 1000;

// userId → { turns: [...], lastAt: timestamp }
const store = new Map();

// 5분마다 TTL 초과 세션 정리
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of store.entries()) {
    if (now - v.lastAt > TTL_MS) store.delete(k);
  }
}, 5 * 60 * 1000);

function key(user) {
  return user?.userId || 'anonymous';
}

export function getHistory(user) {
  const k = key(user);
  const s = store.get(k);
  if (!s) return [];
  if (Date.now() - s.lastAt > TTL_MS) { store.delete(k); return []; }
  return s.turns;
}

// turn = { userMessage, botText, payload }
export function appendTurn(user, turn) {
  const k = key(user);
  const now = Date.now();
  const s = store.get(k) || { turns: [], lastAt: now };
  s.turns.push(turn);
  while (s.turns.length > MAX_TURNS) s.turns.shift();
  s.lastAt = now;
  store.set(k, s);
}

// 홈 버튼 누르면 대화 초기화 API 에서 호출
export function clearHistory(user) {
  store.delete(key(user));
}

// LLM 프롬프트용 포매팅
export function formatHistoryForPrompt(turns) {
  if (!turns || turns.length === 0) return '';
  const lines = turns.map((t, i) => {
    const u = (t.userMessage || '').slice(0, 200);
    const b = (t.botText || '').slice(0, 300);
    return `[${i + 1}] 사용자: ${u}\n    봇: ${b}`;
  });
  return `## 최근 대화 (참고용)\n${lines.join('\n')}`;
}
