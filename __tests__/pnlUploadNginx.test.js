const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const TLS_SERVER = `server {
    listen 443 ssl;
    server_name nenovaweb.com www.nenovaweb.com;

    location = /n8n {
        return 301 /n8n/;
    }

    location ^~ /n8n/ {
        proxy_pass http://127.0.0.1:5678;
    }

    location / {
        # Every directive and comment in this body must be cloned.
        auth_request /_auth;
        proxy_set_header Host $host;
        proxy_set_header X-Literal "quoted } # { text";
        proxy_pass http://127.0.0.1:3000;
        proxy_read_timeout 300s;
    }
}
`;

const REDIRECT_SERVER = `server {
    listen 80;
    server_name nenovaweb.com www.nenovaweb.com;
    return 301 https://$host$request_uri;
}
`;

async function main() {
  const {
    CERTBOT_TLS_INCLUDE,
    MANAGED_UPLOAD_ROUTES,
    PNL_UPLOAD_LOCATION,
    applyValidatedConfigFile,
    buildPnlUploadNginxConfig,
    parseNginxConfig,
    resolveValidatedServerIncludes,
    validateTlsOnlyIncludeText,
  } = await import('../scripts/ensure-pnl-upload-nginx.mjs');

  assert.ok(MANAGED_UPLOAD_ROUTES.length >= 2, '여러 업로드 경로를 관리해야 한다.');
  assert.ok(MANAGED_UPLOAD_ROUTES.some(r => r.location === '/api/arrival-cost/upload'),
    '도착원가 업로드 경로도 관리 대상이어야 한다.');

  const original = `${TLS_SERVER}\n${REDIRECT_SERVER}`;
  const plan = buildPnlUploadNginxConfig(original);
  assert.equal(plan.changed, true);
  for (const route of MANAGED_UPLOAD_ROUTES) {
    assert.match(plan.text, new RegExp(`location = ${route.location.replaceAll('/', '\\/')} \\{`));
  }
  assert.equal((plan.text.match(/client_max_body_size 32m;/g) || []).length, MANAGED_UPLOAD_ROUTES.length,
    '32m은 관리 대상 경로 수만큼 exact location에 있어야 한다.');
  for (const directive of [
    'auth_request /_auth;',
    'proxy_set_header Host $host;',
    'proxy_set_header X-Literal "quoted } # { text";',
    'proxy_pass http://127.0.0.1:3000;',
    'proxy_read_timeout 300s;',
  ]) {
    assert.equal(plan.text.split(directive).length - 1, 1 + MANAGED_UPLOAD_ROUTES.length,
      `${directive}가 root와 관리 대상 exact location 전체에 있어야 한다.`);
  }
  assert.equal(plan.text.split('proxy_pass http://127.0.0.1:5678;').length - 1, 1, 'n8n location은 복제하거나 변경하지 않는다.');
  assert.ok(plan.text.endsWith(REDIRECT_SERVER), '80 redirect server는 바이트 그대로 보존해야 한다.');

  const idempotent = buildPnlUploadNginxConfig(plan.text);
  assert.equal(idempotent.changed, false);
  assert.equal(idempotent.text, plan.text);
  assert.equal(idempotent.status, 'already-configured');

  // 한 경로만 이미 설정된 상태에서 전체를 다시 돌리면, 빠진 경로만 추가되고
  // 이미 있는 경로는 중복·변경되지 않아야 한다.
  const onlyFirstRoute = buildPnlUploadNginxConfig(original, { routes: [MANAGED_UPLOAD_ROUTES[0]] });
  assert.equal(onlyFirstRoute.changed, true);
  assert.equal((onlyFirstRoute.text.match(/client_max_body_size 32m;/g) || []).length, 1);
  const completed = buildPnlUploadNginxConfig(onlyFirstRoute.text);
  assert.equal(completed.changed, true, '두 번째 경로가 아직 빠져 있으므로 patch-required여야 한다.');
  assert.equal(completed.status, 'patch-required');
  assert.equal((completed.text.match(/client_max_body_size 32m;/g) || []).length, MANAGED_UPLOAD_ROUTES.length);
  assert.equal(
    completed.text.split(`location = ${MANAGED_UPLOAD_ROUTES[0].location} {`).length - 1, 1,
    '이미 있던 첫 번째 경로 location을 중복 삽입하면 안 된다.',
  );
  const reCompleted = buildPnlUploadNginxConfig(completed.text);
  assert.equal(reCompleted.changed, false, '두 경로 모두 설정된 뒤에는 already-configured여야 한다.');

  const conflictingLimit = plan.text.replace('client_max_body_size 32m;', 'client_max_body_size 16m;');
  assert.throws(() => buildPnlUploadNginxConfig(conflictingLimit), error => error.code === 'PNL_NGINX_CONFLICTING_ROUTE');

  const conflictingPrefix = original.replace(
    '    location / {',
    `    location ${PNL_UPLOAD_LOCATION} { proxy_pass http://127.0.0.1:3000; }\n\n    location / {`,
  );
  assert.throws(() => buildPnlUploadNginxConfig(conflictingPrefix), error => error.code === 'PNL_NGINX_CONFLICTING_ROUTE');

  const coveringPrefix = original.replace(
    '    location / {',
    '    location ^~ /api/ { auth_request /api-auth; proxy_pass http://127.0.0.1:3000; }\n\n    location / {',
  );
  assert.throws(() => buildPnlUploadNginxConfig(coveringPrefix), error => error.code === 'PNL_NGINX_CONFLICTING_ROUTE');

  const regexLocation = original.replace(
    '    location / {',
    '    location ~ ^/private/ { auth_request /private-auth; }\n\n    location / {',
  );
  assert.throws(() => buildPnlUploadNginxConfig(regexLocation), /regex location/);

  const serverInclude = original.replace(
    '    location = /n8n {',
    '    include /etc/nginx/snippets/unknown-server-routes.conf;\n\n    location = /n8n {',
  );
  assert.throws(() => buildPnlUploadNginxConfig(serverInclude), /include/);

  const certbotConfig = original.replace(
    '    location = /n8n {',
    `    include ${CERTBOT_TLS_INCLUDE};\n\n    location = /n8n {`,
  );
  assert.throws(() => buildPnlUploadNginxConfig(certbotConfig), /검증되지 않은 include/,
    '순수 builder는 include를 기본 허용하면 안 된다.');
  const certbotPlan = buildPnlUploadNginxConfig(certbotConfig, { validatedIncludes: new Set([CERTBOT_TLS_INCLUDE]) });
  assert.equal(certbotPlan.changed, true);
  assert.equal(certbotPlan.text.split(`include ${CERTBOT_TLS_INCLUDE};`).length - 1, 1,
    '검증된 TLS include는 exact location으로 복제하지 않고 server에 그대로 둔다.');

  const tlsOnlyText = `
# Managed by Certbot
ssl_session_cache shared:le_nginx_SSL:10m;
ssl_session_timeout 1440m;
ssl_session_tickets off;
ssl_protocols TLSv1.2 TLSv1.3;
ssl_prefer_server_ciphers off;
`;
  assert.equal(validateTlsOnlyIncludeText(tlsOnlyText), true);
  for (const unsafe of [
    'include /etc/nginx/other.conf;',
    'location /private { deny all; }',
    'auth_request /_auth;',
  ]) {
    assert.throws(() => validateTlsOnlyIncludeText(unsafe), error => error.code === 'PNL_NGINX_UNSAFE_INCLUDE');
  }
  const includeFs = {
    realpathSync: value => value,
    statSync: () => ({ isFile: () => true }),
    readFileSync: value => {
      assert.equal(value, CERTBOT_TLS_INCLUDE);
      return tlsOnlyText;
    },
  };
  assert.deepEqual([...resolveValidatedServerIncludes(certbotConfig, includeFs)], [CERTBOT_TLS_INCLUDE]);
  const extraInclude = certbotConfig.replace(
    `include ${CERTBOT_TLS_INCLUDE};`,
    `include ${CERTBOT_TLS_INCLUDE};\n    include /etc/nginx/other.conf;`,
  );
  assert.throws(() => resolveValidatedServerIncludes(extraInclude, includeFs), error => error.code === 'PNL_NGINX_UNSAFE_INCLUDE');

  const wrongUpstream = original.replace('proxy_pass http://127.0.0.1:3000;', 'proxy_pass http://127.0.0.1:3001;');
  assert.throws(() => buildPnlUploadNginxConfig(wrongUpstream), /proxy_pass/);

  const serverWideLimit = original.replace('    location = /n8n {', '    client_max_body_size 64m;\n\n    location = /n8n {');
  assert.throws(() => buildPnlUploadNginxConfig(serverWideLimit), /전역 client_max_body_size/);

  const duplicateTls = `${TLS_SERVER}\n${TLS_SERVER}\n${REDIRECT_SERVER}`;
  assert.throws(() => buildPnlUploadNginxConfig(duplicateTls), /정확히 1개/);
  assert.throws(() => parseNginxConfig('server { listen 443 ssl; server_name "unterminated; }'), error => error.code === 'PNL_NGINX_PARSE_ERROR');
  assert.throws(() => parseNginxConfig('server { location ~ ^/x/[0-9]{2}$ { return 200; } }'),
    error => error.code === 'PNL_NGINX_PARSE_ERROR', '모호한 regex brace 문법은 추측하지 않고 차단한다.');

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pnl-nginx-test-'));
  try {
    const successFile = path.join(tempRoot, 'success.conf');
    const backupDir = path.join(tempRoot, 'backups');
    fs.writeFileSync(successFile, original);
    const calls = [];
    const success = applyValidatedConfigFile({
      filePath: successFile,
      nextText: plan.text,
      expectedOriginalText: original,
      backupDir,
      now: new Date('2026-09-07T12:00:00.000Z'),
      runNginxTest: () => calls.push('test'),
      reloadNginx: () => calls.push('reload'),
    });
    assert.equal(success.changed, true);
    assert.deepEqual(calls, ['test', 'test', 'reload']);
    assert.equal(fs.readFileSync(successFile, 'utf8'), plan.text);
    assert.equal(fs.readFileSync(success.backupPath, 'utf8'), original);

    const validationFile = path.join(tempRoot, 'validation-failure.conf');
    fs.writeFileSync(validationFile, original);
    let validationCalls = 0;
    let validationReloads = 0;
    assert.throws(() => applyValidatedConfigFile({
      filePath: validationFile,
      nextText: plan.text,
      expectedOriginalText: original,
      backupDir,
      now: new Date('2026-09-07T12:01:00.000Z'),
      runNginxTest: () => {
        validationCalls += 1;
        if (validationCalls === 2) throw new Error('nginx -t rejected patch');
      },
      reloadNginx: () => { validationReloads += 1; },
    }), error => error.code === 'PNL_NGINX_APPLY_ROLLED_BACK');
    assert.equal(fs.readFileSync(validationFile, 'utf8'), original, 'nginx -t 실패 시 원본을 복원해야 한다.');
    assert.equal(validationCalls, 3, '변경 전·변경 후·복원 후 nginx -t가 실행되어야 한다.');
    assert.equal(validationReloads, 0, '새 설정 검증 실패 시 실행 중 nginx를 reload하면 안 된다.');

    const reloadFile = path.join(tempRoot, 'reload-failure.conf');
    fs.writeFileSync(reloadFile, original);
    let reloadTests = 0;
    let reloadCalls = 0;
    assert.throws(() => applyValidatedConfigFile({
      filePath: reloadFile,
      nextText: plan.text,
      expectedOriginalText: original,
      backupDir,
      now: new Date('2026-09-07T12:02:00.000Z'),
      runNginxTest: () => { reloadTests += 1; },
      reloadNginx: () => {
        reloadCalls += 1;
        if (reloadCalls === 1) throw new Error('reload failed');
      },
    }), error => error.code === 'PNL_NGINX_APPLY_ROLLED_BACK');
    assert.equal(fs.readFileSync(reloadFile, 'utf8'), original, 'reload 실패도 원본 복원 후 재reload해야 한다.');
    assert.equal(reloadTests, 3);
    assert.equal(reloadCalls, 2);

    const unchanged = applyValidatedConfigFile({
      filePath: successFile,
      nextText: plan.text,
      runNginxTest: () => assert.fail('idempotent apply must not run nginx -t'),
      reloadNginx: () => assert.fail('idempotent apply must not reload'),
    });
    assert.deepEqual(unchanged, { changed: false, backupPath: null });

    const preflightFile = path.join(tempRoot, 'preflight-failure.conf');
    fs.writeFileSync(preflightFile, original);
    assert.throws(() => applyValidatedConfigFile({
      filePath: preflightFile,
      nextText: plan.text,
      expectedOriginalText: original,
      backupDir,
      runNginxTest: () => { throw new Error('existing config invalid'); },
      reloadNginx: () => assert.fail('invalid existing config must not reload'),
    }), /existing config invalid/);
    assert.equal(fs.readFileSync(preflightFile, 'utf8'), original);

    const racedFile = path.join(tempRoot, 'race.conf');
    fs.writeFileSync(racedFile, `${original}\n# changed by another process\n`);
    assert.throws(() => applyValidatedConfigFile({
      filePath: racedFile,
      nextText: plan.text,
      expectedOriginalText: original,
      backupDir,
      runNginxTest: () => assert.fail('race must be rejected before nginx -t'),
      reloadNginx: () => assert.fail('race must not reload'),
    }), error => error.code === 'PNL_NGINX_CONFIG_RACE');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }

  const helperSource = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'ensure-pnl-upload-nginx.mjs'), 'utf8');
  assert.match(helperSource, /MANAGED_NGINX_PATH = '\/etc\/nginx\/sites-enabled\/nenova-erp'/);
  assert.match(helperSource, /realpathSync\(MANAGED_NGINX_PATH\)/);
  assert.match(helperSource, /NGINX_BACKUP_DIR = '\/var\/backups\/nenova-nginx'/);
  assert.match(helperSource, /CERTBOT_TLS_INCLUDE = '\/etc\/letsencrypt\/options-ssl-nginx\.conf'/);
  assert.doesNotMatch(helperSource, /backupPath\s*=\s*`\$\{filePath\}/, 'backup을 sites-enabled 파일 옆에 만들면 안 된다.');
  assert.doesNotMatch(helperSource, /client_max_body_size\s+(?:50m|64m|100m)/);

  console.log('P&L upload scoped nginx helper tests passed');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
