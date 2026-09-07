#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const MANAGED_NGINX_PATH = '/etc/nginx/sites-enabled/nenova-erp';
export const NGINX_BACKUP_DIR = '/var/backups/nenova-nginx';
export const CERTBOT_TLS_INCLUDE = '/etc/letsencrypt/options-ssl-nginx.conf';

// 앱이 30MiB 업로드를 허용하는 정확한 경로들 — multipart 오버헤드를 감안해 각각 32MiB로 exact
// location을 만든다. 새 업로드 경로를 추가할 때는 여기에만 항목을 더한다(다른 로직은 무변경).
export const MANAGED_UPLOAD_ROUTES = [
  { location: '/api/raum/pnl-import', bodyLimit: '32m' },
  { location: '/api/arrival-cost/upload', bodyLimit: '32m' },
];
// 하위 호환 별칭 — 기존 테스트/호출부가 참조한다.
export const PNL_UPLOAD_LOCATION = MANAGED_UPLOAD_ROUTES[0].location;
export const PNL_UPLOAD_BODY_LIMIT = MANAGED_UPLOAD_ROUTES[0].bodyLimit;

function fail(message, code = 'PNL_NGINX_UNEXPECTED_CONFIG') {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function tokenValue(token) {
  const value = token.value;
  if (value.length >= 2 && ((value[0] === '"' && value.at(-1) === '"') || (value[0] === "'" && value.at(-1) === "'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function tokenizeNginx(source) {
  const tokens = [];
  let index = 0;
  while (index < source.length) {
    const char = source[index];
    if (/\s/.test(char)) { index += 1; continue; }
    if (char === '#') {
      while (index < source.length && source[index] !== '\n') index += 1;
      continue;
    }
    if (char === '{' || char === '}' || char === ';') {
      tokens.push({ type: char, value: char, start: index, end: index + 1 });
      index += 1;
      continue;
    }

    const start = index;
    let quote = null;
    while (index < source.length) {
      const current = source[index];
      if (quote) {
        if (current === '\\') {
          index += Math.min(2, source.length - index);
          continue;
        }
        index += 1;
        if (current === quote) quote = null;
        continue;
      }
      if (current === '"' || current === "'") {
        quote = current;
        index += 1;
        continue;
      }
      if (current === '\\') {
        index += Math.min(2, source.length - index);
        continue;
      }
      if (/\s/.test(current) || current === '#' || current === '{' || current === '}' || current === ';') break;
      index += 1;
    }
    if (quote) fail(`nginx 설정에 닫히지 않은 ${quote} 인용문이 있습니다.`, 'PNL_NGINX_PARSE_ERROR');
    if (index === start) fail(`nginx 설정을 해석할 수 없습니다(offset ${index}).`, 'PNL_NGINX_PARSE_ERROR');
    tokens.push({ type: 'word', value: source.slice(start, index), start, end: index });
  }
  return tokens;
}

/** Comments/quotes/escapes and nested blocks are respected; regex-style brace tokens fail closed. */
export function parseNginxConfig(source) {
  if (typeof source !== 'string') fail('nginx 설정은 문자열이어야 합니다.', 'PNL_NGINX_PARSE_ERROR');
  const tokens = tokenizeNginx(source);
  let cursor = 0;

  function parseContext(expectClose) {
    const nodes = [];
    let header = [];
    while (cursor < tokens.length) {
      const token = tokens[cursor];
      if (token.type === 'word') {
        header.push(token);
        cursor += 1;
        continue;
      }
      if (token.type === ';') {
        if (!header.length) fail(`빈 nginx directive가 있습니다(offset ${token.start}).`, 'PNL_NGINX_PARSE_ERROR');
        nodes.push({
          kind: 'directive', header, values: header.map(tokenValue),
          start: header[0].start, end: token.end,
        });
        header = [];
        cursor += 1;
        continue;
      }
      if (token.type === '{') {
        if (!header.length) fail(`이름 없는 nginx block이 있습니다(offset ${token.start}).`, 'PNL_NGINX_PARSE_ERROR');
        const open = token;
        const blockHeader = header;
        header = [];
        cursor += 1;
        const child = parseContext(true);
        nodes.push({
          kind: 'block', header: blockHeader, values: blockHeader.map(tokenValue), children: child.nodes,
          start: blockHeader[0].start, openStart: open.start, bodyStart: open.end,
          bodyEnd: child.close.start, closeStart: child.close.start, end: child.close.end,
        });
        continue;
      }
      if (token.type === '}') {
        if (header.length) fail(`세미콜론 없는 nginx directive가 있습니다(offset ${header[0].start}).`, 'PNL_NGINX_PARSE_ERROR');
        if (!expectClose) fail(`대응하지 않는 nginx 닫는 중괄호가 있습니다(offset ${token.start}).`, 'PNL_NGINX_PARSE_ERROR');
        cursor += 1;
        return { nodes, close: token };
      }
      fail(`알 수 없는 nginx token입니다(offset ${token.start}).`, 'PNL_NGINX_PARSE_ERROR');
    }
    if (header.length) fail(`세미콜론 없는 nginx directive가 있습니다(offset ${header[0].start}).`, 'PNL_NGINX_PARSE_ERROR');
    if (expectClose) fail('닫히지 않은 nginx block이 있습니다.', 'PNL_NGINX_PARSE_ERROR');
    return { nodes, close: null };
  }

  return parseContext(false).nodes;
}

function direct(nodes, name) {
  return nodes.filter(node => node.kind === 'directive' && node.values[0] === name);
}

function blocks(nodes, name) {
  return nodes.filter(node => node.kind === 'block' && node.values[0] === name);
}

function targetTlsServers(tree) {
  return blocks(tree, 'server').filter(server => {
    const names = new Set(direct(server.children, 'server_name').flatMap(node => node.values.slice(1)));
    return names.has('nenovaweb.com') && names.has('www.nenovaweb.com')
      && direct(server.children, 'listen').some(isTlsListen);
  });
}

function isTlsListen(node) {
  return node.values.slice(1).some(value => /(^|:)443$/.test(value))
    && node.values.slice(1).some(value => value === 'ssl');
}

function locationKey(node) {
  if (node.kind !== 'block' || node.values[0] !== 'location') return null;
  if (node.values.length === 2) return { modifier: '', path: node.values[1] };
  if (node.values.length === 3) return { modifier: node.values[1], path: node.values[2] };
  return { modifier: 'unexpected', path: '' };
}

function syntaxSignature(nodes) {
  return JSON.stringify(nodes.map(node => node.kind === 'directive'
    ? ['directive', node.values]
    : ['block', node.values, JSON.parse(syntaxSignature(node.children))]));
}

function lineIndent(source, offset) {
  const lineStart = source.lastIndexOf('\n', Math.max(0, offset - 1)) + 1;
  const indent = source.slice(lineStart, offset);
  if (!/^\s*$/.test(indent)) fail('대상 location 시작 전의 문법이 예상과 다릅니다.');
  return indent;
}

function insertionPointBeforeClose(source, closeStart) {
  const lineStart = source.lastIndexOf('\n', Math.max(0, closeStart - 1)) + 1;
  if (!/^\s*$/.test(source.slice(lineStart, closeStart))) {
    fail('대상 server 닫는 중괄호가 독립된 줄에 있지 않습니다.');
  }
  return lineStart;
}

function validateExistingExactLocation(exact, root, location, bodyLimit) {
  const limits = direct(exact.children, 'client_max_body_size');
  if (limits.length !== 1 || limits[0].values.length !== 2 || limits[0].values[1].toLowerCase() !== bodyLimit) {
    fail(`기존 exact ${location} location의 body limit가 ${bodyLimit}와 다릅니다.`, 'PNL_NGINX_CONFLICTING_ROUTE');
  }
  const copied = exact.children.filter(node => node !== limits[0]);
  if (syntaxSignature(copied) !== syntaxSignature(root.children)) {
    fail(`기존 exact ${location} location이 현재 root proxy directive 전체와 일치하지 않습니다.`, 'PNL_NGINX_CONFLICTING_ROUTE');
  }
}

/** Return a complete patched config without touching disk. Handles every route in MANAGED_UPLOAD_ROUTES. */
export function buildPnlUploadNginxConfig(source, { validatedIncludes = new Set(), routes = MANAGED_UPLOAD_ROUTES } = {}) {
  const tree = parseNginxConfig(source);
  const candidates = targetTlsServers(tree);
  if (candidates.length !== 1) {
    fail(`nenovaweb.com/www.nenovaweb.com TLS server가 정확히 1개여야 합니다(현재 ${candidates.length}개).`);
  }
  const server = candidates[0];
  for (const include of direct(server.children, 'include')) {
    const includePath = include.values.length === 2 ? include.values[1] : '';
    if (!includePath || !validatedIncludes.has(includePath)) {
      fail(`대상 TLS server에 검증되지 않은 include가 있습니다: ${includePath || '(복합/빈 include)'}`);
    }
  }
  if (direct(server.children, 'client_max_body_size').length) {
    fail('대상 TLS server에 예상하지 못한 전역 client_max_body_size가 있습니다.');
  }

  const locations = blocks(server.children, 'location');
  if (locations.some(node => locationKey(node)?.modifier === 'unexpected')) {
    fail('해석할 수 없는 location header가 대상 TLS server에 있습니다.');
  }
  const roots = locations.filter(node => {
    const key = locationKey(node);
    return key?.modifier === '' && key.path === '/';
  });
  if (roots.length !== 1) fail(`root location /가 정확히 1개여야 합니다(현재 ${roots.length}개).`);
  const root = roots[0];
  if (locations.some(node => {
    const key = locationKey(node);
    return key?.modifier === '~' || key?.modifier === '~*';
  })) {
    fail('대상 TLS server에 regex location이 있어 exact route의 인증 상속을 증명할 수 없습니다.');
  }
  const proxyPass = direct(root.children, 'proxy_pass');
  if (proxyPass.length !== 1 || proxyPass[0].values.length !== 2 || proxyPass[0].values[1] !== 'http://127.0.0.1:3000') {
    fail('root location의 proxy_pass가 확인된 http://127.0.0.1:3000 단일 directive와 다릅니다.');
  }
  if (direct(root.children, 'client_max_body_size').length) {
    fail('root location에 예상하지 못한 client_max_body_size가 있습니다.');
  }

  const pending = [];
  for (const { location, bodyLimit } of routes) {
    for (const node of locations) {
      const key = locationKey(node);
      if (node !== root && (key?.modifier === '' || key?.modifier === '^~')
        && key.path && location.startsWith(key.path)) {
        fail(`${location}를 덮는 기존 prefix location(${key.path})이 있습니다.`, 'PNL_NGINX_CONFLICTING_ROUTE');
      }
    }
    const samePath = locations.filter(node => locationKey(node)?.path === location);
    const exact = samePath.filter(node => locationKey(node)?.modifier === '=');
    const nonExact = samePath.filter(node => locationKey(node)?.modifier !== '=');
    if (nonExact.length || exact.length > 1) {
      fail(`${location}에 충돌하는 location이 있습니다.`, 'PNL_NGINX_CONFLICTING_ROUTE');
    }
    if (exact.length === 1) {
      validateExistingExactLocation(exact[0], root, location, bodyLimit);
      continue;
    }
    pending.push({ location, bodyLimit });
  }

  if (!pending.length) {
    return { changed: false, text: source, status: 'already-configured' };
  }

  const rootBody = source.slice(root.bodyStart, root.bodyEnd);
  const indent = lineIndent(source, root.start);
  const insertAt = insertionPointBeforeClose(source, server.closeStart);
  const exactBlocks = pending
    .map(({ location, bodyLimit }) =>
      `${indent}location = ${location} {\n${indent}    client_max_body_size ${bodyLimit};${rootBody}}\n`)
    .join('');
  return {
    changed: true,
    text: `${source.slice(0, insertAt)}${exactBlocks}${source.slice(insertAt)}`,
    status: 'patch-required',
  };
}

export function validateTlsOnlyIncludeText(source, includePath = CERTBOT_TLS_INCLUDE) {
  const tree = parseNginxConfig(source);
  if (!tree.length) fail(`${includePath}가 비어 있습니다.`, 'PNL_NGINX_UNSAFE_INCLUDE');
  for (const node of tree) {
    if (node.kind !== 'directive' || node.values.length < 2 || !node.values[0].startsWith('ssl_')) {
      fail(`${includePath}에는 flat ssl_* directive만 허용됩니다.`, 'PNL_NGINX_UNSAFE_INCLUDE');
    }
  }
  return true;
}

export function resolveValidatedServerIncludes(source, fsApi = fs) {
  const tree = parseNginxConfig(source);
  const candidates = targetTlsServers(tree);
  if (candidates.length !== 1) {
    fail(`include 검증 대상 TLS server가 정확히 1개여야 합니다(현재 ${candidates.length}개).`);
  }
  const includes = direct(candidates[0].children, 'include');
  if (includes.length !== 1 || includes[0].values.length !== 2 || includes[0].values[1] !== CERTBOT_TLS_INCLUDE) {
    fail(`대상 TLS server는 검증된 Certbot include 하나만 허용합니다: ${CERTBOT_TLS_INCLUDE}`, 'PNL_NGINX_UNSAFE_INCLUDE');
  }
  const resolved = fsApi.realpathSync(CERTBOT_TLS_INCLUDE);
  if (resolved !== CERTBOT_TLS_INCLUDE || !fsApi.statSync(resolved).isFile()) {
    fail(`Certbot include realpath가 예상 파일과 다릅니다: ${resolved}`, 'PNL_NGINX_UNSAFE_INCLUDE');
  }
  validateTlsOnlyIncludeText(fsApi.readFileSync(resolved, 'utf8'), resolved);
  return new Set([CERTBOT_TLS_INCLUDE]);
}

function atomicWriteFile(filePath, content, sourceStat, fsApi = fs) {
  const temporary = `${filePath}.tmp.${process.pid}.${Date.now()}`;
  let descriptor;
  try {
    descriptor = fsApi.openSync(temporary, 'wx', sourceStat.mode);
    fsApi.writeFileSync(descriptor, content, 'utf8');
    fsApi.fsyncSync(descriptor);
    fsApi.closeSync(descriptor);
    descriptor = undefined;
    fsApi.chmodSync(temporary, sourceStat.mode);
    if (process.platform !== 'win32' && typeof fsApi.chownSync === 'function') {
      fsApi.chownSync(temporary, sourceStat.uid, sourceStat.gid);
    }
    fsApi.renameSync(temporary, filePath);
  } catch (error) {
    if (descriptor !== undefined) try { fsApi.closeSync(descriptor); } catch { /* cleanup */ }
    try { fsApi.unlinkSync(temporary); } catch { /* cleanup */ }
    throw error;
  }
}

/** Low-level transaction used by tests; production callers should use applyPnlUploadNginx(). */
export function applyValidatedConfigFile({
  filePath, nextText, expectedOriginalText, backupDir,
  runNginxTest, reloadNginx, now = new Date(), fsApi = fs,
}) {
  const original = fsApi.readFileSync(filePath, 'utf8');
  if (expectedOriginalText !== undefined && original !== expectedOriginalText) {
    fail('검사 이후 nginx 원본 설정이 변경되었습니다. 다시 --check 후 적용하세요.', 'PNL_NGINX_CONFIG_RACE');
  }
  if (original === nextText) return { changed: false, backupPath: null };
  if (!backupDir) fail('nginx backupDir가 필요합니다.', 'PNL_NGINX_UNSAFE_BACKUP');
  const stat = fsApi.statSync(filePath);
  fsApi.mkdirSync(backupDir, { recursive: true, mode: 0o700 });
  if (!fsApi.statSync(backupDir).isDirectory()) fail(`backup 경로가 디렉터리가 아닙니다: ${backupDir}`, 'PNL_NGINX_UNSAFE_BACKUP');
  runNginxTest();
  if (fsApi.readFileSync(filePath, 'utf8') !== original) {
    fail('nginx -t 실행 중 원본 설정이 변경되었습니다. 다시 검사하세요.', 'PNL_NGINX_CONFIG_RACE');
  }
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(backupDir, `${path.basename(filePath)}.pnl-upload-backup.${stamp}`);
  fsApi.copyFileSync(filePath, backupPath, fs.constants.COPYFILE_EXCL);
  fsApi.chmodSync(backupPath, stat.mode);
  if (process.platform !== 'win32' && typeof fsApi.chownSync === 'function') {
    fsApi.chownSync(backupPath, stat.uid, stat.gid);
  }
  let validated = false;
  let reloadAttempted = false;
  try {
    atomicWriteFile(filePath, nextText, stat, fsApi);
    runNginxTest();
    validated = true;
    reloadAttempted = true;
    reloadNginx();
    return { changed: true, backupPath };
  } catch (cause) {
    const rollbackErrors = [];
    try {
      const backup = fsApi.readFileSync(backupPath, 'utf8');
      atomicWriteFile(filePath, backup, stat, fsApi);
    } catch (error) {
      rollbackErrors.push(`backup 복원 실패: ${error.message}`);
    }
    try { runNginxTest(); } catch (error) { rollbackErrors.push(`복원 후 nginx -t 실패: ${error.message}`); }
    if (validated || reloadAttempted) {
      try { reloadNginx(); } catch (error) { rollbackErrors.push(`복원 후 reload 실패: ${error.message}`); }
    }
    const error = new Error(`nginx 설정 적용 실패, backup으로 rollback했습니다: ${cause.message}${rollbackErrors.length ? ` / ${rollbackErrors.join(' / ')}` : ''}`);
    error.code = rollbackErrors.length ? 'PNL_NGINX_ROLLBACK_INCOMPLETE' : 'PNL_NGINX_APPLY_ROLLED_BACK';
    error.cause = cause;
    error.backupPath = backupPath;
    throw error;
  }
}

export function resolveManagedNginxPath(fsApi = fs) {
  const nginxRoot = fsApi.realpathSync('/etc/nginx');
  const resolved = fsApi.realpathSync(MANAGED_NGINX_PATH);
  const relative = path.relative(nginxRoot, resolved);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    fail(`관리 대상 realpath가 /etc/nginx 내부 파일이 아닙니다: ${resolved}`, 'PNL_NGINX_UNSAFE_REALPATH');
  }
  if (!fsApi.statSync(resolved).isFile()) {
    fail(`관리 대상 realpath가 일반 파일이 아닙니다: ${resolved}`, 'PNL_NGINX_UNSAFE_REALPATH');
  }
  return resolved;
}

export function resolveNginxBackupDir(fsApi = fs) {
  fsApi.mkdirSync(NGINX_BACKUP_DIR, { recursive: true, mode: 0o700 });
  const backupsRoot = fsApi.realpathSync('/var/backups');
  const resolved = fsApi.realpathSync(NGINX_BACKUP_DIR);
  const relative = path.relative(backupsRoot, resolved);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || !fsApi.statSync(resolved).isDirectory()) {
    fail(`backup realpath가 /var/backups 내부 디렉터리가 아닙니다: ${resolved}`, 'PNL_NGINX_UNSAFE_BACKUP');
  }
  return resolved;
}

function executable(fsApi, choices) {
  const found = choices.find(candidate => fsApi.existsSync(candidate));
  if (!found) fail(`실행 파일을 찾지 못했습니다: ${choices.join(', ')}`, 'PNL_NGINX_COMMAND_MISSING');
  return found;
}

function runChecked(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (result.error || result.status !== 0) {
    const detail = [result.error?.message, result.stderr, result.stdout].filter(Boolean).join(' ').trim();
    const error = new Error(`${command} ${args.join(' ')} 실패${detail ? `: ${detail}` : ''}`);
    error.code = 'PNL_NGINX_COMMAND_FAILED';
    throw error;
  }
  return result.stdout.trim();
}

export function inspectPnlUploadNginx(fsApi = fs) {
  const resolvedPath = resolveManagedNginxPath(fsApi);
  const source = fsApi.readFileSync(resolvedPath, 'utf8');
  const validatedIncludes = resolveValidatedServerIncludes(source, fsApi);
  const plan = buildPnlUploadNginxConfig(source, { validatedIncludes });
  return { resolvedPath, originalText: source, ...plan };
}

export function applyPnlUploadNginx({ fsApi = fs, commandRunner = runChecked, now = new Date() } = {}) {
  if (process.platform !== 'linux' || typeof process.getuid !== 'function' || process.getuid() !== 0) {
    fail('--apply는 Linux root 권한에서만 실행할 수 있습니다.', 'PNL_NGINX_ROOT_REQUIRED');
  }
  const plan = inspectPnlUploadNginx(fsApi);
  if (!plan.changed) return { changed: false, resolvedPath: plan.resolvedPath, backupPath: null };
  const nginx = executable(fsApi, ['/usr/sbin/nginx', '/usr/bin/nginx']);
  const systemctl = executable(fsApi, ['/usr/bin/systemctl', '/bin/systemctl']);
  const backupDir = resolveNginxBackupDir(fsApi);
  const result = applyValidatedConfigFile({
    filePath: plan.resolvedPath,
    nextText: plan.text,
    expectedOriginalText: plan.originalText,
    backupDir,
    now,
    fsApi,
    runNginxTest: () => commandRunner(nginx, ['-t']),
    reloadNginx: () => {
      commandRunner(systemctl, ['reload', 'nginx']);
      commandRunner(systemctl, ['is-active', '--quiet', 'nginx']);
    },
  });
  return { ...result, resolvedPath: plan.resolvedPath };
}

function usage() {
  console.error('usage: node scripts/ensure-pnl-upload-nginx.mjs --check | --apply');
}

function main(argv) {
  if (argv.length !== 1 || !['--check', '--apply'].includes(argv[0])) {
    usage();
    process.exitCode = 2;
    return;
  }
  if (argv[0] === '--check') {
    const plan = inspectPnlUploadNginx();
    console.log(JSON.stringify({ status: plan.status, path: MANAGED_NGINX_PATH, realpath: plan.resolvedPath }));
    return;
  }
  const result = applyPnlUploadNginx();
  console.log(JSON.stringify({ status: result.changed ? 'applied' : 'already-configured', ...result }));
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (invokedPath === import.meta.url) {
  try { main(process.argv.slice(2)); }
  catch (error) {
    console.error(`${error.code || 'PNL_NGINX_ERROR'}: ${error.message}`);
    process.exitCode = 1;
  }
}
