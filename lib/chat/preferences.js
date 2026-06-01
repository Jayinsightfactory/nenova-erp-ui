// lib/chat/preferences.js — chatbot response preference memory
//
// The normal chat history is short-lived. This module keeps small, operator-taught
// answer rules so corrections like "show product -> farm quantities" survive
// later questions and server restarts.

import fs from 'fs/promises';
import path from 'path';

const PREF_PATH = path.join(process.cwd(), 'data', 'chat-preferences.json');
const MAX_RULES = 60;

const DEFAULT_RULES = [
  '입고 농장 수량 답변은 품목을 먼저 쓰고, 같은 품목 안에 농장별 수량을 나열한다. 예: 품목명: 농장A 10단, 농장B 10단.',
  '재고/잔량/수량 조회는 사용자가 0 포함을 요청하지 않으면 0인 항목을 제외해서 답한다.',
];

let cache = null;

function userKey(user) {
  if (!user) return 'anonymous';
  if (typeof user === 'string' || typeof user === 'number') return String(user);
  return user.userId || user.id || user.userName || 'anonymous';
}

function normalizeRule(rule) {
  return String(rule || '').replace(/\s+/g, ' ').trim();
}

async function loadPrefs() {
  if (cache) return cache;
  try {
    const raw = await fs.readFile(PREF_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    cache = {
      global: { rules: Array.isArray(parsed?.global?.rules) ? parsed.global.rules : [] },
      users: parsed?.users && typeof parsed.users === 'object' ? parsed.users : {},
    };
  } catch {
    cache = { global: { rules: [] }, users: {} };
  }
  return cache;
}

async function savePrefs(data) {
  await fs.mkdir(path.dirname(PREF_PATH), { recursive: true });
  await fs.writeFile(PREF_PATH, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function pushRule(list, entry) {
  const rule = normalizeRule(entry?.rule);
  if (!rule) return false;
  const exists = list.some(x => normalizeRule(x?.rule) === rule);
  if (exists) return false;
  list.push({
    rule,
    source: String(entry?.source || '').slice(0, 300),
    createdAt: entry?.createdAt || new Date().toISOString(),
  });
  while (list.length > MAX_RULES) list.shift();
  return true;
}

export async function rememberPreference(user, rule, meta = {}) {
  const normalized = normalizeRule(rule);
  if (!normalized) return { saved: false, rule: '' };
  const prefs = await loadPrefs();
  const scope = meta.scope || 'global';
  const entry = {
    rule: normalized,
    source: meta.source || '',
    createdAt: new Date().toISOString(),
  };

  let saved = false;
  if (scope === 'user') {
    const key = userKey(user);
    const current = prefs.users[key] || { rules: [] };
    current.rules = Array.isArray(current.rules) ? current.rules : [];
    saved = pushRule(current.rules, entry);
    prefs.users[key] = current;
  } else {
    prefs.global.rules = Array.isArray(prefs.global.rules) ? prefs.global.rules : [];
    saved = pushRule(prefs.global.rules, entry);
  }

  if (saved) await savePrefs(prefs);
  return { saved, rule: normalized };
}

export async function getPreferencePrompt(user) {
  const prefs = await loadPrefs();
  const key = userKey(user);
  const stored = [
    ...(prefs.global?.rules || []),
    ...(prefs.users?.[key]?.rules || []),
  ].map(x => normalizeRule(x?.rule)).filter(Boolean);
  const rules = [...DEFAULT_RULES, ...stored].filter((rule, idx, arr) => arr.indexOf(rule) === idx);
  if (!rules.length) return '';
  return `## ANSWER PREFERENCES
${rules.map((rule, idx) => `${idx + 1}. ${rule}`).join('\n')}`;
}

export function detectPreferenceFeedback(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  const compact = raw.replace(/\s+/g, ' ');
  const hasFeedbackMarker = /(앞으로|다음부터|항상|기준|형식|이런\s*식|이렇게|원하는|나와야|답변|정리\s*방식|수정되어서|고쳐|바꿔|보여줘야|표시|제외)/.test(compact);
  if (!hasFeedbackMarker) return null;

  if (/품목/.test(compact) && /농장/.test(compact) && /수량/.test(compact)) {
    return {
      rule: '입고 농장 수량 답변은 품목을 먼저 쓰고, 같은 품목 안에 농장별 수량을 나열한다. 예: 품목명: 농장A 10단, 농장B 10단.',
      confidence: 'high',
    };
  }

  if (/(?:0|영|제로)\s*(?:제외|빼고|말고)|0\s*(?:아닌|이\s*아닌)/.test(compact)) {
    return {
      rule: '재고/잔량/수량 조회는 사용자가 0 포함을 요청하지 않으면 0인 항목을 제외해서 답한다.',
      confidence: 'high',
    };
  }

  if (compact.length <= 220 && /(형식|이런\s*식|이렇게|앞으로|다음부터|항상|답변|정리\s*방식)/.test(compact)) {
    return {
      rule: `사용자가 선호한 답변 형식: ${compact}`,
      confidence: 'medium',
    };
  }

  return null;
}

export function buildPreferenceAck(rule) {
  return {
    messages: [
      {
        type: 'text',
        content: `알겠습니다. 앞으로 챗봇 답변 규칙에 반영할게요.\n저장한 기준: ${rule}`,
      },
    ],
    _preferenceSaved: true,
  };
}
