// 신한은행 오픈API 연동 계약 테스트 — 네트워크 없이 HMAC·매핑·토큰 갱신·권한 규칙을 검사한다.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');

const api = fs.readFileSync('pages/api/finance/shinhan-sync.js', 'utf8');
const lib = fs.readFileSync('lib/shinhanApi.js', 'utf8');

assert.match(api, /SHINHAN_SYNC_USER_IDS[^\n]+nenovaSS3/, '동기화 실행은 지정 관리자 계정으로 제한해야 합니다.');
assert.match(api, /AUTOMATION_API_TOKEN/, '예약 동기화는 서버 자동화 토큰으로만 호출해야 합니다.');
assert.match(api, /timingSafeEqual/, '자동화 토큰 비교는 상수시간 비교여야 합니다.');
assert.match(api, /maskAccount/, '응답의 계좌번호는 마스킹해야 합니다.');
assert.match(api, /WHERE NOT EXISTS/, '거래 적재는 중복 방지 조건이 있어야 합니다.');
assert.doesNotMatch(api, /clientSecret|SHINHAN_CLIENT_SECRET/, 'API 핸들러는 client secret 을 직접 다루면 안 됩니다.');
assert.doesNotMatch(api, /OrderDetail|ShipmentDetail|OrderMaster|ShipmentMaster/, '은행 동기화는 ERP 원장을 건드리면 안 됩니다.');
assert.doesNotMatch(lib, /console\.log\([^)]*(secret|token)/i, '라이브러리는 비밀값을 로그에 남기면 안 됩니다.');

(async () => {
  const {
    buildClientHash, buildHsKey, maskAccount, mapTransactionRow, mapLoanRow,
    createShinhanClient, loadShinhanConfig, SHINHAN_BASE_URLS, SHINHAN_PATHS, parseAccountList, isTokenExpiredError,
  } = await import('../lib/shinhanApi.js');

  // 가이드 4.2: client_hash = Base64(HMAC-SHA256(secret, "timestamp|client_id"))
  const expectHash = crypto.createHmac('sha256', 'SECRET').update('1700000000|CID', 'utf8').digest('base64');
  assert.equal(buildClientHash('CID', 'SECRET', 1700000000), expectHash);
  // 가이드 5.2: hsKey = Base64(HMAC-SHA256(secret, body))
  const body = JSON.stringify({ dataHeader: { subChannel: 'X' }, dataBody: { a: 1 } });
  assert.equal(buildHsKey('SECRET', body), crypto.createHmac('sha256', 'SECRET').update(body, 'utf8').digest('base64'));

  assert.equal(maskAccount('110-123-456789'), '110******789');
  assert.equal(maskAccount(''), '');
  assert.deepEqual(parseAccountList('110-123-456789, 140-000-111222'), ['110123456789', '140000111222']);

  const cfg = loadShinhanConfig({ SHINHAN_CLIENT_ID: 'id', SHINHAN_CLIENT_SECRET: 's', SHINHAN_ENV: 'prod' });
  assert.equal(cfg.baseUrl, SHINHAN_BASE_URLS.prod);
  assert.equal(cfg.configured, true);
  const none = loadShinhanConfig({});
  assert.equal(none.configured, false);
  assert.deepEqual(none.missing, ['SHINHAN_CLIENT_ID', 'SHINHAN_CLIENT_SECRET']);
  assert.equal(none.baseUrl, SHINHAN_BASE_URLS.dev, '설정 전 기본은 개발(테스트) 서버여야 합니다.');

  // 응답 매핑 (가이드 별첨)
  const dep = mapTransactionRow({ 거래일자: '2026-10-13', 거래시간: '093012', 입금금액: '1500000', 출금금액: '0', 거래메모: '㈜꽃집', 잔액: '12345678', 입지구분: '1', 거래점명: '강남' }, { accountNo: '110123456789', custName: '네노바' });
  assert.deepEqual(dep, {
    txDtm: '2026-10-13 09:30:12', txType: '입금', accountNo: '110123456789', accountName: '', custName: '네노바',
    amount: 1500000, balance: 12345678, counterpart: '㈜꽃집', bankName: '신한은행', branchName: '강남', memo: '㈜꽃집',
  });
  const wd = mapTransactionRow({ 거래일자: '20261013', 거래시간: '1200', 입금금액: '0', 출금금액: '300', 입지구분: '2' });
  assert.equal(wd.txType, '출금'); assert.equal(wd.amount, 300); assert.equal(wd.txDtm, '2026-10-13 12:00:00');
  const loan = mapLoanRow({ 거래일자: '20260901', 거래순번: 7, 거래종류: '대출금 상환', 거래금액: '1000.5', 원금금액: '900', 이자금액: '100.5', 거래후잔액: '5000', 이율: '4.5' }, { accountNo: '1' });
  assert.equal(loan.txType, '출금'); assert.equal(loan.amount, 1000.5); assert.match(loan.memo, /대출금 상환/);

  assert.equal(isTokenExpiredError({ resultCode: '89' }), true);
  assert.equal(isTokenExpiredError({ resultCode: '400', resultMessage: 'Access token has expired' }), true);
  assert.equal(isTokenExpiredError({ resultCode: '400', resultMessage: 'Not allowed IP address' }), false);

  // 클라이언트: 토큰 캐시·만료 재발급·헤더 구성 (fetch 모의)
  const calls = [];
  let tokenNo = 0;
  let clock = 1_700_000_000_000;
  const fakeFetch = async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith(SHINHAN_PATHS.token)) {
      tokenNo += 1;
      return { ok: true, status: 200, json: async () => ({ dataHeader: {}, dataBody: { access_token: `tok${tokenNo}`, token_type: 'Bearer', expires_in: 86400, scope: 'oob' } }) };
    }
    if (init.headers.Authorization === 'Bearer tok1' && calls.filter((c) => c.url.endsWith(SHINHAN_PATHS.transactions)).length === 2) {
      return { ok: true, status: 200, json: async () => ({ dataHeader: { successCode: '1', resultCode: '89', resultMessage: 'Access token has expired' }, dataBody: {} }) };
    }
    return { ok: true, status: 200, json: async () => ({ dataHeader: { successCode: '0' }, dataBody: { 계좌잔액: '10', 고객명: '네노바', 거래내역: [{ 거래일자: '2026-10-13', 거래시간: '010101', 입금금액: '5', 출금금액: '0', 입지구분: '1' }] } }) };
  };
  const client = createShinhanClient({ env: { SHINHAN_CLIENT_ID: 'CID', SHINHAN_CLIENT_SECRET: 'SECRET', SHINHAN_SUB_CHANNEL: 'SUB', SHINHAN_CLIENT_IP: '172.233.89.171' }, fetch: fakeFetch, now: () => clock });
  const r1 = await client.fetchTransactions({ accountNo: '110-123-456789', from: '2026-10-01', to: '2026-10-13' });
  assert.equal(r1.rows.length, 1); assert.equal(r1.rows[0].custName, '네노바'); assert.equal(r1.balance, 10);
  const tokenReq = calls[0];
  assert.equal(tokenReq.init.headers['Content-Type'], 'application/x-www-form-urlencoded; charset=UTF-8');
  const form = new URLSearchParams(tokenReq.init.body);
  assert.equal(form.get('grant_type'), 'client_credentials'); assert.equal(form.get('scope'), 'oob');
  assert.equal(form.get('client_hash'), buildClientHash('CID', 'SECRET', Math.floor(clock / 1000)));
  const txReq = calls[1];
  assert.equal(txReq.init.headers.apiKey, 'CID');
  assert.equal(txReq.init.headers.Authorization, 'Bearer tok1');
  assert.equal(txReq.init.headers.hsKey, buildHsKey('SECRET', txReq.init.body));
  assert.equal(txReq.init.headers.clientIp, '172.233.89.171');
  assert.deepEqual(JSON.parse(txReq.init.body), { dataHeader: { subChannel: 'SUB' }, dataBody: { 계좌번호: '110123456789', 조회시작일: '20261001', 조회종료일: '20261013' } });

  // 두 번째 호출: 만료(89) → 토큰 재발급 후 자동 재시도
  const r2 = await client.fetchTransactions({ accountNo: '110123456789', from: '2026-10-01', to: '2026-10-13' });
  assert.equal(r2.rows.length, 1);
  assert.equal(tokenNo, 2, '만료 응답이면 접근키를 새로 받아야 합니다.');
  assert.equal(calls.filter((c) => c.url.endsWith(SHINHAN_PATHS.transactions)).length, 3);

  // 9분 경과 전엔 캐시, 경과 후엔 재발급 (가이드: 유효 10분)
  clock += 8 * 60 * 1000; await client.fetchTransactions({ accountNo: '110123456789', from: '2026-10-01', to: '2026-10-13' }); assert.equal(tokenNo, 2);
  clock += 2 * 60 * 1000; await client.fetchTransactions({ accountNo: '110123456789', from: '2026-10-01', to: '2026-10-13' }); assert.equal(tokenNo, 3);

  // 미설정이면 은행 호출 없이 명확한 오류
  const bare = createShinhanClient({ env: {}, fetch: async () => { throw new Error('must not call'); } });
  await assert.rejects(() => bare.fetchTransactions({ accountNo: '1', from: '2026-01-01', to: '2026-01-02' }), /신한 API 미설정/);

  console.log('shinhanBankSync.test.js passed');
})().catch((err) => { console.error(err); process.exit(1); });
