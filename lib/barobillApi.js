// lib/barobillApi.js — 바로빌(barobill) SOAP API 클라이언트 (외부 의존성 없음: fetch + 최소 XML 파서)
//
// 규격 출처: dev.barobill.co.kr 개발 준비 가이드 + testws.baroservice.com/*.asmx?wsdl (2026-10-21 추출)
//   - 모든 API 첫 파라미터 CERTKEY(파트너 연동인증키, UUID 36자), 둘째 CorpNum(회원사 사업자번호 10자리)
//   - 테스트: https://testws.baroservice.com/{TI|BANKACCOUNT|CARD|CORPSTATE}.asmx  운영: https://ws.baroservice.com/...
//   - SOAPAction: "http://ws.baroservice.com/{Operation}", 본문 네임스페이스 http://ws.baroservice.com/
//   - 결과가 int 인 API 는 음수가 오류코드 → GetErrString(CERTKEY, ErrCode) 로 메시지 조회
//
// 보안: 인증키·계좌/카드 비밀번호는 서버 env 에만. 응답의 계좌·카드번호는 maskNumber() 로 가린 뒤 내보낸다.
// 쓰기(세금계산서 발급·계좌/카드 등록)는 BAROBILL_ALLOW_WRITE=1 일 때만 허용하고, 그 외엔 호출 전에 막는다.

const SERVICES = Object.freeze({
  TI: 'TI.asmx',            // 전자세금계산서(+홈택스 세금계산서 매입매출 수집)
  BANKACCOUNT: 'BANKACCOUNT.asmx',
  CARD: 'CARD.asmx',
  CORPSTATE: 'CORPSTATE.asmx',
  CASHBILL: 'CASHBILL.asmx',
  EDOC: 'EDOC.asmx',
});
const NS = 'http://ws.baroservice.com/';
const HOSTS = Object.freeze({ test: 'https://testws.baroservice.com', prod: 'https://ws.baroservice.com' });
const WRITE_OPS = new Set([
  'RegistAndIssueTaxInvoice', 'RegistAndIssueTaxInvoiceBulk', 'RegistTaxInvoice', 'RegistTaxInvoiceEX', 'IssueTaxInvoice', 'IssueTaxInvoiceEx',
  'RegistAndReverseIssueTaxInvoice', 'RegistModifyTaxInvoice', 'DeleteTaxInvoice', 'RegistCorp', 'UpdateCorpInfo', 'AddUserToCorp',
  'RegistBankAccount', 'RegistBankAccountEx', 'RegistBankAccountsEx', 'UpdateBankAccount', 'UpdateBankAccountEx', 'StopBankAccount', 'CancelStopBankAccount', 'ReRegistBankAccount',
  'RegistCard', 'RegistCardEx', 'RegistCardsEx', 'UpdateCard', 'StopCard', 'CancelStopCard', 'ReRegistCard', 'RegistBankAccountLogMemo', 'RegistCardLogMemo',
]);

export class BarobillError extends Error {
  constructor(message, { op, code, raw } = {}) {
    super(message);
    this.name = 'BarobillError';
    this.op = op;
    this.code = code;
    this.raw = raw;
  }
}

export function loadBarobillConfig(env = process.env) {
  const mode = String(env.BAROBILL_ENV || 'test').toLowerCase() === 'prod' ? 'prod' : 'test';
  const certKey = String(env.BAROBILL_CERTKEY || '').trim();
  const corpNum = String(env.BAROBILL_CORPNUM || '').replace(/-/g, '').trim();
  const userId = String(env.BAROBILL_USERID || '').trim(); // 바로빌 회원 아이디(계좌/카드 조회 ID 파라미터)
  const allowWrite = String(env.BAROBILL_ALLOW_WRITE || '') === '1';
  const missing = [];
  if (!certKey) missing.push('BAROBILL_CERTKEY');
  if (!corpNum) missing.push('BAROBILL_CORPNUM');
  return { mode, host: HOSTS[mode], certKey, corpNum, userId, allowWrite, configured: missing.length === 0, missing };
}

// 응답에서 민감 번호(계좌·카드) 가리기: 앞 3자리 + *** + 뒤 4자리
export function maskNumber(value) {
  const s = String(value || '').replace(/\s+/g, '');
  if (!s) return '';
  if (s.length <= 7) return `${s.slice(0, 2)}***`;
  return `${s.slice(0, 3)}***${s.slice(-4)}`;
}

export function escapeXml(v) {
  return String(v ?? '').replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));
}

// 파라미터 객체 → XML 조각. 배열은 같은 이름 반복(ArrayOfX 는 { X: [...] } 형태로 전달), 객체는 중첩.
export function toXml(obj) {
  if (obj === null || obj === undefined) return '';
  if (Array.isArray(obj)) return obj.map(toXml).join('');
  if (typeof obj !== 'object') return escapeXml(obj);
  return Object.entries(obj).map(([k, v]) => {
    if (v === undefined) return '';
    if (Array.isArray(v)) return v.map((item) => `<${k}>${toXml(item)}</${k}>`).join('');
    return `<${k}>${toXml(v)}</${k}>`;
  }).join('');
}

export function buildEnvelope(op, params) {
  return `<?xml version="1.0" encoding="utf-8"?>` +
    `<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">` +
    `<soap:Body><${op} xmlns="${NS}">${toXml(params)}</${op}></soap:Body></soap:Envelope>`;
}

// ── 최소 XML 파서: 바로빌 응답(네임스페이스 없는 단순 트리)만 다룬다. 텍스트 리프는 문자열, 반복 자식은 배열.
function unescapeXml(s) {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&amp;/g, '&');
}
export function parseXml(xml) {
  const src = String(xml).replace(/<\?xml[^>]*\?>/, '').replace(/<!--[\s\S]*?-->/g, '');
  let i = 0;
  const parseNode = () => {
    // 현재 위치는 '<' 바로 뒤가 아니라 '<' 자체
    const m = /^<([A-Za-z_][\w.:-]*)((?:\s+[^>]*?)?)(\/?)>/.exec(src.slice(i));
    if (!m) throw new Error(`XML parse error near ${src.slice(i, i + 40)}`);
    const name = m[1].replace(/^.*:/, '');
    const attrs = m[2];
    i += m[0].length;
    if (m[3] === '/') return [name, (/xsi:nil="true"/.test(attrs) ? null : '')];
    const children = {};
    let text = '';
    let hasChild = false;
    for (;;) {
      if (src.startsWith('</', i)) {
        const end = src.indexOf('>', i);
        i = end + 1;
        break;
      }
      if (src[i] === '<') {
        hasChild = true;
        const [cn, cv] = parseNode();
        if (cn in children) {
          if (!Array.isArray(children[cn])) children[cn] = [children[cn]];
          children[cn].push(cv);
        } else children[cn] = cv;
      } else {
        const next = src.indexOf('<', i);
        text += src.slice(i, next < 0 ? src.length : next);
        i = next < 0 ? src.length : next;
      }
    }
    return [name, hasChild ? children : unescapeXml(text.trim())];
  };
  while (i < src.length && src[i] !== '<') i++;
  const [name, value] = parseNode();
  return { [name]: value };
}

// ArrayOfX → 항상 배열
export function asArray(v) {
  if (v === null || v === undefined || v === '') return [];
  if (Array.isArray(v)) return v;
  if (typeof v === 'object') {
    // ArrayOfX 래퍼({ X: ... })는 한 단계만 벗긴다(행 객체 자체를 더 풀면 안 됨)
    const keys = Object.keys(v);
    if (keys.length === 1) {
      const inner = v[keys[0]];
      if (Array.isArray(inner)) return inner;
      return inner === null || inner === undefined || inner === '' ? [] : [inner];
    }
  }
  return [v];
}

export function createBarobillClient(options = {}) {
  const cfg = loadBarobillConfig(options.env || process.env);
  const fetchImpl = options.fetch || globalThis.fetch;
  const timeoutMs = options.timeoutMs || 30000;

  async function call(service, op, params = {}, { includeCert = true } = {}) {
    if (!SERVICES[service]) throw new BarobillError(`알 수 없는 서비스: ${service}`, { op });
    if (WRITE_OPS.has(op) && !cfg.allowWrite) {
      throw new BarobillError(`${op} 는 쓰기 API — BAROBILL_ALLOW_WRITE=1 이 아니면 호출하지 않습니다.`, { op, code: 'WRITE_BLOCKED' });
    }
    const body = buildEnvelope(op, includeCert ? { CERTKEY: cfg.certKey, ...params } : params);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let res;
    try {
      res = await fetchImpl(`${cfg.host}/${SERVICES[service]}`, {
        method: 'POST',
        headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: `"${NS}${op}"` },
        body,
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    const text = await res.text();
    if (!res.ok) throw new BarobillError(`HTTP ${res.status} (${service}.${op})`, { op, code: res.status, raw: text.slice(0, 500) });
    const parsed = parseXml(text);
    const bodyNode = parsed?.Envelope?.Body;
    const fault = bodyNode?.Fault;
    if (fault) throw new BarobillError(`SOAP Fault: ${fault.faultstring || JSON.stringify(fault)}`, { op, code: 'FAULT', raw: text.slice(0, 500) });
    const resp = bodyNode?.[`${op}Response`];
    const result = resp ? resp[`${op}Result`] : undefined;
    return result === undefined ? resp : result;
  }

  // int 결과 음수면 오류 → 메시지 조회
  async function errString(code) {
    try {
      return await call('TI', 'GetErrString', { ErrCode: Number(code) });
    } catch {
      return null;
    }
  }
  async function intResult(service, op, params) {
    const r = Number(await call(service, op, params));
    if (Number.isFinite(r) && r < 0) {
      const msg = await errString(r);
      throw new BarobillError(`${op} 실패 ${r}${msg ? `: ${msg}` : ''}`, { op, code: r });
    }
    return r;
  }

  const base = () => ({ CorpNum: cfg.corpNum });

  return {
    config: cfg,
    call,
    // ── 연결·자격
    ping: () => call('TI', 'Ping', {}, { includeCert: false }),
    checkCert: () => intResult('TI', 'CheckCERTIsValid', base()),                 // 1 = 유효
    checkCorpIsMember: (checkCorpNum = cfg.corpNum) => intResult('TI', 'CheckCorpIsMember', { ...base(), CheckCorpNum: checkCorpNum }),
    balance: () => call('TI', 'GetBalanceCostAmountEx', base()),                   // 선불 잔액
    // ── 사업자 상태
    corpState: async (checkCorpNum) => call('CORPSTATE', 'GetCorpState', { ...base(), CheckCorpNum: String(checkCorpNum).replace(/-/g, '') }),
    corpStates: async (list) => asArray(await call('CORPSTATE', 'GetCorpStates', { ...base(), CheckCorpNumList: { string: list.map((s) => String(s).replace(/-/g, '')) } })),
    // ── 계좌
    bankAccounts: async ({ availOnly = 1 } = {}) => asArray(await call('BANKACCOUNT', 'GetBankAccountEx2', { ...base(), AvailOnly: availOnly }))
      .map((a) => ({ bank: a.BankName, bankCode: a.BankCode, type: a.BankAccountType, accountNo: maskNumber(a.BankAccountNum), alias: a.Alias, usage: a.Usage, cycle: a.CollectCycle })),
    bankLog: async ({ accountNo, from, to, direction = 0, page = 1, perPage = 100, order = 1 }) => {
      const r = await call('BANKACCOUNT', 'GetPeriodBankAccountLogEx2', {
        ...base(), ID: cfg.userId, BankAccountNum: String(accountNo).replace(/-/g, ''), StartDate: ymd(from), EndDate: ymd(to),
        TransDirection: direction, CountPerPage: perPage, CurrentPage: page, OrderDirection: order,
      });
      return { page: Number(r.CurrentPage), maxPage: Number(r.MaxPageNum), total: Number(r.MaxIndex), rows: asArray(r.BankAccountLogList).map(mapBankRow) };
    },
    // ── 카드
    cards: async ({ availOnly = 1 } = {}) => asArray(await call('CARD', 'GetCardEx2', { ...base(), AvailOnly: availOnly }))
      .map((c) => ({ company: c.CardCompanyName, companyCode: c.CardCompanyCode, type: c.CardType, cardNo: maskNumber(c.CardNum), alias: c.Alias, usage: c.Usage, cycle: c.CollectCycle })),
    cardLog: async ({ cardNo, from, to, page = 1, perPage = 100, order = 1 }) => {
      const r = await call('CARD', 'GetPeriodCardLogEx3', {
        ...base(), ID: cfg.userId, CardNum: String(cardNo).replace(/-/g, ''), StartDate: ymd(from), EndDate: ymd(to),
        CountPerPage: perPage, CurrentPage: page, OrderDirection: order,
      });
      return { page: Number(r.CurrentPage), maxPage: Number(r.MaxPageNum), total: Number(r.MaxIndex), rows: asArray(r.CardLogList).map(mapCardRow) };
    },
    // ── 세금계산서(발행 목록·홈택스 매입)
    taxSalesList: async ({ from, to, taxType = 1, dateType = 1, page = 1, perPage = 100 }) => {
      const r = await call('TI', 'GetPeriodTaxInvoiceSalesListEx', {
        ...base(), UserID: cfg.userId, TaxType: taxType, DateType: dateType, StartDate: ymd(from), EndDate: ymd(to), CountPerPage: perPage, CurrentPage: page,
      });
      return { page: Number(r.CurrentPage), maxPage: Number(r.MaxPageNum), total: Number(r.MaxIndex), rows: asArray(r.SimpleTaxInvoiceEx2List).map(mapTaxRow) };
    },
    taxPurchaseMonthly: async ({ month, taxType = 1, dateType = 1, page = 1, perPage = 100, order = 1 }) => {
      const r = await call('TI', 'GetMonthlyTaxInvoicePurchaseListEx', {
        ...base(), UserID: cfg.userId, TaxType: taxType, DateType: dateType, BaseMonth: String(month).replace(/-/g, '').slice(0, 6), CountPerPage: perPage, CurrentPage: page, OrderDirection: order,
      });
      return { page: Number(r.CurrentPage), maxPage: Number(r.MaxPageNum), total: Number(r.MaxIndex), rows: asArray(r.SimpleTaxInvoiceEx2List).map(mapTaxRow) };
    },
    taxState: (mgtKey) => call('TI', 'GetTaxInvoiceStateEX', { ...base(), MgtKey: mgtKey }),
    taxLog: async (mgtKey) => asArray(await call('TI', 'GetTaxInvoiceLog', { ...base(), MgtKey: mgtKey })),
    // ── 발급(쓰기, BAROBILL_ALLOW_WRITE=1 필요). invoice 는 WSDL TaxInvoice 구조 그대로.
    registAndIssueTaxInvoice: ({ invoice, sendSMS = false, forceIssue = false, mailTitle = '' }) =>
      intResult('TI', 'RegistAndIssueTaxInvoice', { ...base(), Invoice: invoice, SendSMS: sendSMS, ForceIssue: forceIssue, MailTitle: mailTitle }),
  };
}

function ymd(d) {
  if (!d) return '';
  if (d instanceof Date) return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  return String(d).replace(/-/g, '').slice(0, 8);
}
function num(v) {
  const n = Number(String(v ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}
export function mapBankRow(r) {
  const deposit = num(r.Deposit);
  const withdraw = num(r.Withdraw);
  return {
    accountNo: maskNumber(r.BankAccountNum),
    txDtm: r.TransDT,                                  // yyyyMMddHHmmss
    txType: deposit > 0 ? '입금' : '출금',
    amount: deposit > 0 ? deposit : withdraw,
    deposit, withdraw,
    balance: num(r.Balance),
    kind: r.TransType,
    office: r.TransOffice,
    remark: r.TransRemark,
    refKey: r.TransRefKey,
    memo: r.Memo,
  };
}
export function mapCardRow(r) {
  return {
    cardNo: maskNumber(r.CardNum),
    useKey: r.UseKey,
    useDtm: r.UseDT,
    approvalType: r.CardApprovalType,
    approvalNo: r.CardApprovalNum,
    amount: num(r.Amount),
    tax: num(r.Tax),
    serviceCharge: num(r.ServiceCharge),
    total: num(r.TotalAmount),
    store: r.UseStoreName,
    storeCorpNum: r.UseStoreCorpNum,
    storeTaxType: r.UseStoreTaxType,
    currency: r.Currency,
    installment: r.InstallmentMonths,
    memo: r.Memo,
  };
}
export function mapTaxRow(r) {
  return {
    ntsSendKey: r.NTSSendKey,
    ntsSendDt: r.NTSSendDT,
    issueDt: r.IssueDT,
    writeDate: r.WriteDate,
    taxType: Number(r.TaxType),
    purposeType: Number(r.PurposeType),
    invoicer: { corpNum: r.InvoicerCorpNum, name: r.InvoicerCorpName },
    invoicee: { corpNum: r.InvoiceeCorpNum, name: r.InvoiceeCorpName },
    amount: num(r.AmountTotal),
    tax: num(r.TaxTotal),
    total: num(r.TotalAmount),
    itemName: r.ItemName,
    remark1: r.Remark1,
  };
}

export { SERVICES, NS, HOSTS, WRITE_OPS };
