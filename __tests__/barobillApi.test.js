// 바로빌 SOAP 클라이언트 — 봉투 생성·응답 파싱·마스킹·쓰기 차단·오류코드 처리 (네트워크 없음, fetch 주입)
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildEnvelope, parseXml, asArray, maskNumber, loadBarobillConfig, createBarobillClient, mapBankRow, mapCardRow, mapTaxRow, BarobillError } from '../lib/barobillApi.js';

// 1) 설정
const cfg = loadBarobillConfig({ BAROBILL_CERTKEY: 'B22E4495-AC22-405D-B2A1-A72079B3642C', BAROBILL_CORPNUM: '134-86-94367' });
assert.equal(cfg.mode, 'test'); assert.equal(cfg.host, 'https://testws.baroservice.com'); assert.equal(cfg.corpNum, '1348694367'); assert.equal(cfg.configured, true);
assert.equal(loadBarobillConfig({ BAROBILL_ENV: 'prod', BAROBILL_CERTKEY: 'x', BAROBILL_CORPNUM: '1' }).host, 'https://ws.baroservice.com');
assert.deepEqual(loadBarobillConfig({}).missing, ['BAROBILL_CERTKEY', 'BAROBILL_CORPNUM']);

// 2) 봉투: 첫 파라미터 CERTKEY, 네임스페이스, 이스케이프, 배열(ArrayOfString)
const env = buildEnvelope('GetCorpStates', { CERTKEY: 'k', CorpNum: '1', CheckCorpNumList: { string: ['a', 'b<'] } });
assert.match(env, /<GetCorpStates xmlns="http:\/\/ws\.baroservice\.com\/"><CERTKEY>k<\/CERTKEY><CorpNum>1<\/CorpNum><CheckCorpNumList><string>a<\/string><string>b&lt;<\/string><\/CheckCorpNumList>/);

// 3) 파서: 단일/반복/nil/엔티티
const xml = '<?xml version="1.0"?><soap:Envelope xmlns:soap="s"><soap:Body><GetBankAccountEx2Response xmlns="n"><GetBankAccountEx2Result>'
  + '<BankAccountEx><BankName>하나</BankName><BankAccountNum>38412345678901</BankAccountNum><Alias>a &amp; b</Alias></BankAccountEx>'
  + '<BankAccountEx><BankName>신한</BankName><BankAccountNum>14012345678</BankAccountNum><Alias xsi:nil="true" /></BankAccountEx>'
  + '</GetBankAccountEx2Result></GetBankAccountEx2Response></soap:Body></soap:Envelope>';
const list = asArray(parseXml(xml).Envelope.Body.GetBankAccountEx2Response.GetBankAccountEx2Result);
assert.equal(list.length, 2); assert.equal(list[0].Alias, 'a & b'); assert.equal(list[1].Alias, null);
assert.deepEqual(asArray(parseXml('<R><X><A>1</A></X></R>').R), [{ A: '1' }], '요소 1개도 배열');
assert.deepEqual(asArray(''), []);

// 4) 마스킹
assert.equal(maskNumber('38412345678901'), '384***8901'); assert.equal(maskNumber('1234'), '12***'); assert.equal(maskNumber(''), '');

// 5) 클라이언트: fetch 주입 — SOAPAction/URL/본문 확인, 결과 추출, 음수 오류 → GetErrString, 쓰기 차단
const calls = [];
const fakeFetch = async (url, init) => {
  calls.push({ url, action: init.headers.SOAPAction, body: init.body });
  const op = /<soap:Body><(\w+)/.exec(init.body)[1];
  const respond = (inner) => ({ ok: true, status: 200, text: async () => `<?xml version="1.0"?><soap:Envelope xmlns:soap="s"><soap:Body><${op}Response xmlns="n">${inner}</${op}Response></soap:Body></soap:Envelope>` });
  if (op === 'Ping') return respond('');
  if (op === 'CheckCERTIsValid') return respond('<CheckCERTIsValidResult>1</CheckCERTIsValidResult>');
  if (op === 'CheckCorpIsMember') return respond('<CheckCorpIsMemberResult>-10001</CheckCorpIsMemberResult>');
  if (op === 'GetErrString') return respond('<GetErrStringResult>인증키 불일치</GetErrStringResult>');
  if (op === 'GetBankAccountEx2') return respond('<GetBankAccountEx2Result><BankAccountEx><BankName>하나</BankName><BankAccountNum>38412345678901</BankAccountNum></BankAccountEx></GetBankAccountEx2Result>');
  if (op === 'GetPeriodBankAccountLogEx2') return respond('<GetPeriodBankAccountLogEx2Result><CurrentPage>1</CurrentPage><MaxPageNum>1</MaxPageNum><MaxIndex>1</MaxIndex><BankAccountLogList><BankAccountLogEx2><BankAccountNum>38412345678901</BankAccountNum><Deposit>20000000</Deposit><Withdraw>0</Withdraw><Balance>77961637</Balance><TransDT>20261019153000</TransDT><TransRemark>희경</TransRemark></BankAccountLogEx2></BankAccountLogList></GetPeriodBankAccountLogEx2Result>');
  return { ok: false, status: 500, text: async () => 'boom' };
};
const client = createBarobillClient({ env: { BAROBILL_CERTKEY: 'KEY-1', BAROBILL_CORPNUM: '1348694367', BAROBILL_USERID: 'nenova' }, fetch: fakeFetch });
await client.ping();
assert.equal(calls[0].url, 'https://testws.baroservice.com/TI.asmx'); assert.equal(calls[0].action, '"http://ws.baroservice.com/Ping"');
assert.ok(!calls[0].body.includes('CERTKEY'), 'Ping 은 인증키 없음');
assert.equal(await client.checkCert(), 1);
assert.match(calls[1].body, /<CERTKEY>KEY-1<\/CERTKEY><CorpNum>1348694367<\/CorpNum>/);
await assert.rejects(() => client.checkCorpIsMember(), (e) => e instanceof BarobillError && e.code === -10001 && /인증키 불일치/.test(e.message));
const accts = await client.bankAccounts();
assert.deepEqual(accts.map((a) => a.accountNo), ['384***8901'], '계좌번호 마스킹');
const log = await client.bankLog({ accountNo: '384-12345678901', from: '2026-10-01', to: '2026-10-21' });
assert.match(calls.at(-1).body, /<ID>nenova<\/ID><BankAccountNum>38412345678901<\/BankAccountNum><StartDate>20261001<\/StartDate><EndDate>20261021<\/EndDate>/);
assert.equal(log.total, 1); assert.equal(log.rows[0].txType, '입금'); assert.equal(log.rows[0].amount, 20000000); assert.equal(log.rows[0].accountNo, '384***8901');
await assert.rejects(() => client.registAndIssueTaxInvoice({ invoice: {} }), (e) => e.code === 'WRITE_BLOCKED', 'BAROBILL_ALLOW_WRITE 없으면 발급 차단');
assert.ok(!calls.some((c) => /RegistAndIssueTaxInvoice/.test(c.body)), '차단된 쓰기는 네트워크에 안 나감');

// 6) 행 매핑
assert.equal(mapCardRow({ CardNum: '4518441234569872', TotalAmount: '597,600' }).cardNo, '451***9872');
assert.equal(mapTaxRow({ AmountTotal: '1000', TaxTotal: '100', TotalAmount: '1100', TaxType: '1' }).total, 1100);
assert.equal(mapBankRow({ Deposit: '0', Withdraw: '500' }).txType, '출금');

// 7) API 라우트 계약: GET 전용·관리자/자동화 토큰·DB 미접촉·키 마스킹
const route = fs.readFileSync(new URL('../pages/api/finance/barobill.js', import.meta.url), 'utf8');
assert.match(route, /req\.method !== 'GET'/); assert.match(route, /isAdminUser\(user\)/); assert.match(route, /checkAutomationAuth/);
assert.ok(!/lib\/db/.test(route), '바로빌 조회 라우트는 DB 를 읽지도 쓰지도 않는다');
assert.match(route, /maskKey\(cfg\.certKey\)/);
console.log('barobill api tests passed');
