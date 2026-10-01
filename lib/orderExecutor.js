// lib/orderExecutor.js — 안전장치가 들어간 자동 주문 실행기.
//
// POST /api/orders 는 같은 품목을 "가산"한다(멱등성 없음). 자동 실행기는 그 위에서
//   ① ERP 쓰기 범위 검사(허용 거래처·연도만)  ② requestId 원장 중복 차단
//   ③ 실행 전 현재수량 SELECT  ④ 목표수량과의 delta만 전송(가산 방지)
//   ⑤ 실행 후 SELECT 대조  ⑥ 409(ERP_EDIT_LOCKED) 백오프 재시도 3회  ⑦ 결과 원장 기록
// 을 보장한다. cancelPlan(requestId) 은 원장에 기록된 실제 적용 delta 의 정확한 음수만 보낸다.
// 분배/출고(ShipmentMaster/Detail)는 절대 호출하지 않으며, 대상 차수에 출고가 있으면 거부한다.
//
// 의존성은 주입한다: { query(sqlText, params), sql, postOrder(body) -> {status, body}, sleep(ms) }
// 원장: 웹 전용 dbo.WebOrderExecLedger (scripts/apply-order-exec-ledger-migration.mjs)
import { assertErpWriteScope, requireErpWriteScope } from './erpWriteScope.js';
import { normalizeOrderUnit } from './orderUtils.js';

export const LEDGER_TABLE = 'WebOrderExecLedger';
export const LEDGER_COLUMNS = ['LedgerKey', 'RequestId', 'Kind', 'CustKey', 'OrderYear', 'OrderWeek', 'Status', 'PlanJson', 'ResultJson', 'ErrorText', 'CreatedAt', 'UpdatedAt'];
export const QTY_EPSILON = 1e-6;
export const DEFAULT_BACKOFF_MS = [1000, 3000, 9000];
export const ORDER_EXEC_SOURCE = 'my-customer';
export const ORDER_EXEC_MODE = 'REPLACE';
const RETRY_CODES = new Set(['ERP_EDIT_LOCKED', 'STALE_CURRENT_QTY']);
const UNIT_COLUMN = { 박스: 'BoxQuantity', 단: 'BunchQuantity', 송이: 'SteamQuantity' };

function execError(code, message, extra = {}) {
  return Object.assign(new Error(message), { code, ...extra });
}

const round6 = (n) => Math.round(Number(n || 0) * 1e6) / 1e6;
const sameQty = (a, b) => Math.abs(Number(a || 0) - Number(b || 0)) <= QTY_EPSILON;
const itemKey = (item) => `${item.prodKey}|${item.unit}`;

/** 요청 정규화 + 범위 검사. DB 를 건드리기 전에 실패해야 한다. */
export function validateExecRequest(input = {}, allowedScope) {
  if (!allowedScope || !allowedScope.custKey || !allowedScope.year) {
    throw execError('ERP_SCOPE_MISMATCH', '자동 실행 허용 범위(allowedScope)가 설정되지 않았습니다.');
  }
  const scope = requireErpWriteScope({ custKey: input.custKey, year: input.year }, '자동 주문 실행');
  assertErpWriteScope({ OrderYear: scope.orderYear, CustKey: scope.custKey },
    { orderYear: String(allowedScope.year), custKey: Number(allowedScope.custKey) }, '자동 주문 실행 대상');
  const week = String(input.week || '').trim();
  if (!/^\d{2}-\d{2}$/.test(week)) throw execError('ORDER_WEEK_INVALID', `차수 형식 오류: ${week || '(없음)'} (예: 41-01)`);
  const requestId = String(input.requestId || '').trim();
  if (!/^[A-Za-z0-9:_.#-]{4,100}$/.test(requestId)) throw execError('REQUEST_ID_INVALID', 'requestId(4~100자, 영숫자/:_.#-)가 필요합니다.');
  if (!Array.isArray(input.items) || input.items.length === 0) throw execError('ITEMS_REQUIRED', '품목이 없습니다.');
  const seen = new Set();
  const items = input.items.map((raw) => {
    const prodKey = Number(raw.prodKey);
    const targetQty = Number(raw.targetQty ?? raw.qty);
    if (!Number.isInteger(prodKey) || prodKey <= 0) throw execError('ITEM_INVALID', `prodKey 오류: ${raw.prodKey}`);
    if (!Number.isFinite(targetQty) || targetQty < 0) throw execError('ITEM_INVALID', `목표수량은 0 이상이어야 합니다: prodKey=${prodKey}`);
    const unit = normalizeOrderUnit(raw.unit, '박스');
    const key = `${prodKey}`;
    if (seen.has(key)) throw execError('ITEM_DUPLICATE', `같은 품목이 두 번 있습니다: prodKey=${prodKey}`);
    seen.add(key);
    return { prodKey, unit, targetQty: round6(targetQty) };
  });
  const mode = input.mode === 'live' ? 'live' : 'dry';
  return { custKey: scope.custKey, year: scope.orderYear, week, requestId, items, mode };
}

/** 품목별 현재 주문수량(요청 단위 열) — 살아있는 OrderMaster/OrderDetail 만. */
export async function readCurrentQuantities({ query, sql }, { custKey, year, week, items }) {
  const out = new Map();
  for (const item of items) {
    const col = UNIT_COLUMN[item.unit];
    const r = await query(
      `SELECT ISNULL(SUM(od.${col}),0) AS Qty, ISNULL(SUM(od.OutQuantity),0) AS OutQty, COUNT(*) AS Rows
         FROM OrderMaster om
         JOIN OrderDetail od ON od.OrderMasterKey=om.OrderMasterKey
        WHERE om.CustKey=@ck AND om.OrderYear=@year AND om.OrderWeek=@wk AND od.ProdKey=@pk
          AND ISNULL(om.isDeleted,0)=0 AND ISNULL(od.isDeleted,0)=0`,
      {
        ck: { type: sql.Int, value: custKey },
        year: { type: sql.NVarChar, value: year },
        wk: { type: sql.NVarChar, value: week },
        pk: { type: sql.Int, value: item.prodKey },
      }
    );
    const row = r.recordset?.[0] || {};
    if (Number(row.Rows || 0) > 1) throw execError('ORDER_DETAIL_DUPLICATE', `같은 품목 주문행이 ${row.Rows}개입니다(prodKey=${item.prodKey}). 자동 실행을 중단합니다.`);
    out.set(itemKey(item), { qty: round6(row.Qty), outQty: round6(row.OutQty) });
  }
  return out;
}

/** 실행 계획: 목표 − 현재 = delta. delta 0 품목은 보내지 않는다. */
export function planDeltas(items, current) {
  return items.map((item) => {
    const before = current.get(itemKey(item))?.qty ?? 0;
    const delta = round6(item.targetQty - before);
    const beforeOutQty = current.get(itemKey(item))?.outQty ?? 0;
    return { ...item, beforeQty: before, beforeOutQty, deltaQty: sameQty(delta, 0) ? 0 : delta };
  });
}

async function preflight({ query, sql }, req) {
  const cust = await query(`SELECT TOP 1 CustKey FROM Customer WHERE CustKey=@ck AND ISNULL(isDeleted,0)=0`, { ck: { type: sql.Int, value: req.custKey } });
  if (!cust.recordset?.[0]) throw execError('ERP_SCOPE_MISMATCH', `사용 가능한 거래처가 아닙니다: ${req.custKey}`);
  const ship = await query(
    `SELECT COUNT(*) AS N FROM ShipmentMaster
      WHERE CustKey=@ck AND OrderYear=@year AND OrderWeek=@wk AND ISNULL(isDeleted,0)=0`,
    { ck: { type: sql.Int, value: req.custKey }, year: { type: sql.NVarChar, value: req.year }, wk: { type: sql.NVarChar, value: req.week } }
  );
  if (Number(ship.recordset?.[0]?.N || 0) > 0) throw execError('SHIPMENT_EXISTS', '대상 차수에 출고(분배) 기록이 있어 자동 주문 실행을 거부합니다.');
}

async function ledgerGet({ query, sql }, requestId) {
  const r = await query(`SELECT TOP 1 ${LEDGER_COLUMNS.join(',')} FROM ${LEDGER_TABLE} WHERE RequestId=@rid`, { rid: { type: sql.NVarChar, value: requestId } });
  return r.recordset?.[0] || null;
}

/** 원장 선점(UNIQUE RequestId). 이미 있으면 false. */
async function ledgerClaim({ query, sql }, { requestId, kind, custKey, year, week, plan }) {
  const r = await query(
    `INSERT INTO ${LEDGER_TABLE} (RequestId, Kind, CustKey, OrderYear, OrderWeek, Status, PlanJson)
     SELECT @rid, @kind, @ck, @year, @wk, N'RUNNING', @plan
      WHERE NOT EXISTS (SELECT 1 FROM ${LEDGER_TABLE} WITH (UPDLOCK, HOLDLOCK) WHERE RequestId=@rid);
     SELECT @@ROWCOUNT AS Claimed;`,
    {
      rid: { type: sql.NVarChar, value: requestId },
      kind: { type: sql.NVarChar, value: kind },
      ck: { type: sql.Int, value: custKey },
      year: { type: sql.NVarChar, value: year },
      wk: { type: sql.NVarChar, value: week },
      plan: { type: sql.NVarChar, value: JSON.stringify(plan) },
    }
  );
  const rows = (r.recordsets || []).flat();
  return Number((rows[rows.length - 1] || r.recordset?.[0] || {}).Claimed || 0) === 1;
}

async function ledgerFinish({ query, sql }, requestId, status, result, errorText = null) {
  await query(
    `UPDATE ${LEDGER_TABLE} SET Status=@st, ResultJson=@res, ErrorText=@err, UpdatedAt=SYSDATETIME() WHERE RequestId=@rid`,
    {
      rid: { type: sql.NVarChar, value: requestId },
      st: { type: sql.NVarChar, value: status },
      res: { type: sql.NVarChar, value: JSON.stringify(result ?? null) },
      err: { type: sql.NVarChar, value: errorText ? String(errorText).slice(0, 1000) : null },
    }
  );
}

/** POST /api/orders — 409 ERP_EDIT_LOCKED 는 백오프 재시도(기본 3회). 매 시도 전 delta 를 다시 계산한다. */
async function sendWithRetry(deps, req, recompute) {
  const backoff = deps.backoffMs || DEFAULT_BACKOFF_MS;
  const sleep = deps.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  let attempt = 0;
  for (;;) {
    const plan = await recompute();
    // exe FormOrderAdd 동일 환산(myCustomerOrderAllUnits, SteamOf1Bunch 반영)을 타도록
    // '내 업체' 절대모드(REPLACE)로 목표수량을 보낸다. expectedCurrentQty=현재 OutQuantity 로
    // 낙관적 잠금. REPLACE 는 FormOrderAdd EditMode=2 와 같이 runStockCalculation 을 생략한다.
    const sendItems = plan.filter((p) => p.deltaQty !== 0)
      .map((p) => ({ prodKey: p.prodKey, qty: p.targetQty, unit: p.unit, expectedCurrentQty: p.beforeOutQty }));
    if (!sendItems.length) return { plan, response: null, attempts: attempt };
    const response = await deps.postOrder({
      custKey: req.custKey, year: req.year, week: req.week, items: sendItems,
      source: ORDER_EXEC_SOURCE, orderMode: ORDER_EXEC_MODE,
    });
    attempt += 1;
    const code = response?.body?.code;
    if (response?.status === 409 && RETRY_CODES.has(code) && attempt <= backoff.length) {
      await sleep(backoff[attempt - 1]);
      continue;
    }
    if (!(response?.status >= 200 && response?.status < 300) || response?.body?.success !== true) {
      throw execError(code || 'ORDER_POST_FAILED', `주문 저장 실패(HTTP ${response?.status}): ${response?.body?.error || '응답 없음'}`, { attempts: attempt, httpStatus: response?.status });
    }
    return { plan, response, attempts: attempt };
  }
}

async function runPlan(deps, req, { kind, targetOf }) {
  if (req.mode === 'live') {
    const existing = await ledgerGet(deps, req.requestId);
    if (existing) return { status: 'SKIPPED_DUPLICATE', requestId: req.requestId, priorStatus: existing.Status };
  }
  const current0 = await readCurrentQuantities(deps, req);
  const items = req.items.map((it) => ({ ...it, targetQty: targetOf(it, current0) }));
  const plan0 = planDeltas(items, current0);
  if (req.mode === 'dry') return { status: 'DRY_RUN', requestId: req.requestId, plan: plan0 };

  const claimed = await ledgerClaim(deps, { requestId: req.requestId, kind, custKey: req.custKey, year: req.year, week: req.week, plan: plan0 });
  if (!claimed) {
    const prior = await ledgerGet(deps, req.requestId);
    return { status: 'SKIPPED_DUPLICATE', requestId: req.requestId, priorStatus: prior?.Status || null };
  }
  try {
    const { plan, response, attempts } = await sendWithRetry(deps, req, async () => planDeltas(items, await readCurrentQuantities(deps, req)));
    const after = await readCurrentQuantities(deps, req);
    const verify = items.map((it) => {
      const afterQty = after.get(itemKey(it))?.qty ?? 0;
      return { prodKey: it.prodKey, unit: it.unit, targetQty: it.targetQty, afterQty, ok: sameQty(afterQty, it.targetQty) };
    });
    const applied = plan.map((p) => ({ prodKey: p.prodKey, unit: p.unit, beforeQty: p.beforeQty, deltaQty: p.deltaQty, targetQty: p.targetQty }));
    const result = { applied, verify, attempts, orderMasterKey: response?.body?.orderMasterKey ?? null, warning: response?.body?.warning || null };
    if (verify.some((v) => !v.ok)) {
      await ledgerFinish(deps, req.requestId, 'VERIFY_MISMATCH', result, '실행 후 수량이 목표와 다릅니다.');
      throw execError('VERIFY_MISMATCH', '실행 후 수량이 목표와 다릅니다.', { result });
    }
    const status = plan.every((p) => p.deltaQty === 0) ? 'NOOP' : 'DONE';
    await ledgerFinish(deps, req.requestId, status, result);
    return { status, requestId: req.requestId, ...result };
  } catch (error) {
    if (error.code !== 'VERIFY_MISMATCH') await ledgerFinish(deps, req.requestId, 'FAILED', { attempts: error.attempts || null }, `${error.code || ''} ${error.message}`);
    throw error;
  }
}

/** 목표수량 실행. mode 'dry' 는 DB 쓰기 없이 계획만 반환한다. */
export async function executePlan(deps, input) {
  const req = validateExecRequest(input, deps.allowedScope);
  await preflight(deps, req);
  if (req.mode === 'live') await deps.assertLedgerSchema?.();
  return runPlan(deps, req, { kind: 'exec', targetOf: (it) => it.targetQty });
}

/** 실행 취소: 원장에 기록된 실제 적용 delta 의 정확한 음수만 보낸다(현재 − 적용분). */
export async function cancelPlan(deps, requestId, { mode = 'live' } = {}) {
  const prior = await ledgerGet(deps, String(requestId || ''));
  if (!prior) throw execError('LEDGER_NOT_FOUND', `원장에 없는 requestId: ${requestId}`);
  if (prior.Kind !== 'exec' || !['DONE', 'NOOP'].includes(prior.Status)) throw execError('CANCEL_NOT_ALLOWED', `취소할 수 없는 상태: ${prior.Kind}/${prior.Status}`);
  const result = JSON.parse(prior.ResultJson || '{}');
  const applied = (result.applied || []).filter((a) => Number(a.deltaQty) !== 0);
  const cancelId = `${prior.RequestId}#cancel`;
  if (!applied.length) return { status: 'NOOP', requestId: cancelId, applied: [] };
  const req = validateExecRequest({
    custKey: prior.CustKey, year: prior.OrderYear, week: prior.OrderWeek, requestId: cancelId, mode,
    items: applied.map((a) => ({ prodKey: a.prodKey, unit: a.unit, targetQty: 0 })),
  }, deps.allowedScope);
  await preflight(deps, req);
  const deltaOf = new Map(applied.map((a) => [itemKey(a), Number(a.deltaQty)]));
  return runPlan(deps, req, {
    kind: 'cancel',
    targetOf: (it, current) => {
      const target = round6((current.get(itemKey(it))?.qty ?? 0) - deltaOf.get(itemKey(it)));
      if (target < -QTY_EPSILON) throw execError('CANCEL_UNDERFLOW', `취소 후 수량이 음수가 됩니다: prodKey=${it.prodKey}`);
      return Math.max(0, target);
    },
  });
}

/** 기본 HTTP postOrder (Bearer 토큰). 토큰은 로그에 남기지 않는다. */
export function httpPostOrder({ baseUrl, token, fetchImpl = fetch }) {
  return async (body) => {
    const res = await fetchImpl(`${baseUrl.replace(/\/$/, '')}/api/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    let json = null;
    try { json = await res.json(); } catch { json = null; }
    return { status: res.status, body: json };
  };
}
