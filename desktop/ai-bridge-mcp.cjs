#!/usr/bin/env node
'use strict';
// stdio MCP 서버: Nenova Desktop의 로컬 AI 브리지(HTTP, 127.0.0.1)를 MCP 도구로 감싼다.
// 앱이 --ai-bridge로 실행 중이어야 하며, 토큰 파일(ai-bridge-token.json)에서 포트·토큰을 읽는다.
// 사용 예시는 docs/desktop/AI_BRIDGE.md 참조. Electron 없이 순수 Node로 동작한다.
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');

function tokenFileCandidates() {
  const fromEnv = process.env.NENOVA_AI_BRIDGE_TOKEN_FILE;
  const appData = process.env.APPDATA || '';
  return [fromEnv, appData && path.join(appData, 'Nenova Desktop', 'ai-bridge-token.json'), appData && path.join(appData, 'nenova-desktop', 'ai-bridge-token.json')].filter(Boolean);
}
function readBridgeInfo() {
  for (const file of tokenFileCandidates()) {
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (Number.isFinite(data.port) && typeof data.token === 'string') return data;
    } catch { /* try next */ }
  }
  throw new Error('AI 브리지 토큰 파일을 찾지 못했습니다. Nenova Desktop을 --ai-bridge 플래그로 먼저 실행하세요.');
}

const TOOLS = [
  { name: 'tabs_list', method: 'tabs/list', description: '열린 업무 탭 목록(id, URL, 제목, 활성 여부)과 잠금 상태를 반환한다.', schema: {} },
  { name: 'tabs_open', method: 'tabs/open', description: 'nenovaweb 업무 경로를 새 탭으로 연다. bootstrap 메뉴 allowlist 안의 경로만 허용된다.', schema: { url: { type: 'string', description: '/orders 같은 경로 또는 https://nenovaweb.com URL' } }, required: ['url'] },
  { name: 'page_text', method: 'page/text', description: '탭 본문 텍스트를 읽는다. tabId 생략 시 활성 탭.', schema: { tabId: { type: 'string' } } },
  { name: 'page_query', method: 'page/query', description: 'CSS 셀렉터로 요소의 텍스트 또는 속성을 읽는다(실행 아님, 읽기 전용).', schema: { tabId: { type: 'string' }, selector: { type: 'string' }, attribute: { type: 'string' }, all: { type: 'boolean' } }, required: ['selector'] },
  { name: 'page_click', method: 'page/click', description: '셀렉터 요소를 클릭한다. ERP 쓰기성 경로(주문/분배/재고/견적 등)는 기본 차단되고 감사 로그에 남는다.', schema: { tabId: { type: 'string' }, selector: { type: 'string' } }, required: ['selector'] },
  { name: 'page_fill', method: 'page/fill', description: '셀렉터 input/textarea에 값을 입력한다. ERP 쓰기성 경로는 기본 차단된다.', schema: { tabId: { type: 'string' }, selector: { type: 'string' }, value: { type: 'string' } }, required: ['selector', 'value'] },
  { name: 'page_screenshot', method: 'page/screenshot', description: '탭 화면을 PNG로 캡처하고 저장된 파일 경로를 반환한다(검증용).', schema: { tabId: { type: 'string' } } },
  { name: 'console_logs', method: 'console/logs', description: '탭의 최근 콘솔 로그를 반환한다.', schema: { tabId: { type: 'string' }, limit: { type: 'number' } } },
];

async function callBridge(method, params) {
  const { port, token } = readBridgeInfo();
  const response = await fetch(`http://127.0.0.1:${port}/rpc`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ method, params }), signal: AbortSignal.timeout(30000),
  });
  const body = await response.json();
  if (!body.ok) throw new Error(body.error || `브리지 오류(${response.status})`);
  return body.result;
}

function send(message) { process.stdout.write(JSON.stringify(message) + '\n'); }
const rl = readline.createInterface({ input: process.stdin });
rl.on('line', async line => {
  let msg; try { msg = JSON.parse(line); } catch { return; }
  if (msg.id === undefined || msg.id === null) return; // notification
  const reply = result => send({ jsonrpc: '2.0', id: msg.id, result });
  try {
    if (msg.method === 'initialize') {
      reply({ protocolVersion: msg.params?.protocolVersion || '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'nenova-desktop-ai-bridge', version: '1.0.0' } });
    } else if (msg.method === 'tools/list') {
      reply({ tools: TOOLS.map(t => ({ name: t.name, description: t.description, inputSchema: { type: 'object', properties: t.schema, required: t.required || [] } })) });
    } else if (msg.method === 'tools/call') {
      const tool = TOOLS.find(t => t.name === msg.params?.name);
      if (!tool) throw new Error(`알 수 없는 도구: ${msg.params?.name}`);
      const result = await callBridge(tool.method, msg.params?.arguments || {});
      reply({ content: [{ type: 'text', text: typeof result === 'string' ? result : JSON.stringify(result, null, 1) }] });
    } else if (msg.method === 'ping') {
      reply({});
    } else {
      send({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: `지원하지 않는 method: ${msg.method}` } });
    }
  } catch (error) {
    if (msg.method === 'tools/call') reply({ content: [{ type: 'text', text: String(error?.message || error) }], isError: true });
    else send({ jsonrpc: '2.0', id: msg.id, error: { code: -32000, message: String(error?.message || error) } });
  }
});
