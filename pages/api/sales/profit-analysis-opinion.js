// pages/api/sales/profit-analysis-opinion.js — 원인분석 탭 AI 소견 (POST 전용).
//
// GET 읽기 전용 계약이 걸린 profit-analysis.js와 분리한 이유: 이 엔드포인트는 소견 캐시
// (WebProfitAnalysisOpinion — 웹 전용 테이블, ERP 원장 아님)에 기록한다.
// 흐름: 근거팩(loadCategoryEvidence — 화면 카드와 동일 값) → 해시 → 캐시 조회 →
// (변경/강제 시) claude-haiku-4-5 소견 생성 → 캐시 저장. LLM은 근거팩에 있는 숫자만 서술하고
// 새 수치를 만들지 않도록 시스템 프롬프트로 강제한다. 키가 없으면 규칙 기반 요약으로 폴백.
import crypto from 'node:crypto';
import { withAuth } from '../../../lib/auth';
import { query, sql } from '../../../lib/db';
import { resolveActiveOrderYear } from '../../../lib/orderUtils';
import { parseMajor } from './profit-report';
import { loadCategoryEvidence } from './profit-analysis';

const ALL_CATEGORY = '(전체)';
const DRIVER_LABEL = { C: '매출액', E: '기초상품재고액', F: '기말상품재고액', P: '상품매입액', H: '그외통관비', T: '포워딩(원화)' };
const MODEL = 'claude-haiku-4-5';

const TABLE_SQL = `
IF OBJECT_ID(N'dbo.WebProfitAnalysisOpinion', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.WebProfitAnalysisOpinion (
    OrderYear NVARCHAR(4) NOT NULL,
    MajorWeek NVARCHAR(10) NOT NULL,
    Category NVARCHAR(80) NOT NULL,
    EvidenceHash NVARCHAR(64) NOT NULL,
    Opinion NVARCHAR(MAX) NOT NULL,
    Model NVARCHAR(60) NULL,
    CreatedBy NVARCHAR(100) NULL,
    CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_WebProfitAnalysisOpinion_CreatedAt DEFAULT GETDATE(),
    CONSTRAINT PK_WebProfitAnalysisOpinion PRIMARY KEY (OrderYear, MajorWeek, Category)
  );
END
`;

const SYSTEM_PROMPT = [
  '너는 네노바(꽃 수입 유통) 주차별 매출이익 보고서의 이익률 원인분석 담당이다.',
  '입력 JSON(근거팩)은 웹 화면과 동일한 확정 수치다. 규칙:',
  '- 근거팩에 있는 숫자만 인용하고 새 수치를 계산하거나 추정해 만들지 마라.',
  '- drivers의 열 의미는 label 필드가 정답이다: C=매출액, E=기초상품재고액, F=기말상품재고액, P=상품매입액, H=그외통관비, T=포워딩. profitImpact 양수=이익 개선, 음수=이익 악화. 열 의미를 절대 바꿔 해석하지 마라(예: C를 원가로, P를 판매가로 부르지 말 것).',
  '- 카테고리(품종)마다 이익률이 왜 높거나 낮은지 핵심 원인을 영향이 큰 순서로 2~4문장으로 설명하라.',
  '- 원인 유형: ①거래처 판매단가(카테고리 평균 대비 낮은 거래처와 그 매출 비중) ②저가 거래처 판매비중 확대 ③환율(rate.effect: 음수=환율 상승으로 이익 감소) ④재고 시차(stockLag: 기말 잔량 음수 = 다음 차수 입고분을 이번 차수에 선판매 — nextWeekArrival=true면 다음 차수 입고 확인됨) ⑤매입원가·통관비·포워딩 변동(drivers의 profitImpact).',
  '- cnf=true(호주·베트남)는 운임이 매입단가에 포함(CNF)이라 포워딩 부재가 정상임을 전제로 하라.',
  '- 전산(ERP)이 정답이다. 데이터 결측이 의심되면 "확인 필요"로 명시하고 단정하지 마라.',
  '- 출력은 한국어. 카테고리별로 "■ 카테고리명" 제목 뒤 서술. 금액은 만원 단위로 반올림해 말해도 된다.',
].join('\n');

function truncateText(value, max = 1900) {
  return String(value || '').slice(0, max);
}

function compactEvidence(evidence, categoryFilter) {
  const cats = (evidence.categories || [])
    .filter((c) => !categoryFilter || c.category === categoryFilter)
    .map((c) => ({
      category: c.category,
      cnf: c.cnf,
      K: c.K, prevK: c.prevK, J: c.J == null ? null : Math.round(c.J), C: c.C == null ? null : Math.round(c.C),
      drivers: (c.drivers || []).slice(0, 4).map((d) => ({ col: d.column, label: DRIVER_LABEL[d.column] || d.column, delta: Math.round(d.delta || 0), profitImpact: Math.round(d.profitImpact || 0) })),
      rate: c.rate && (c.rate.current != null || c.rate.prev != null)
        ? { current: c.rate.current, prev: c.rate.prev, effect: c.rate.effect == null ? null : Math.round(c.rate.effect) }
        : null,
      lowPriceCustomers: (c.customerPrices || []).filter((x) => (x.vsCategoryAvgPct ?? 0) < -0.03).slice(0, 5)
        .map((x) => ({ cust: x.custName, price: Math.round(x.unitPrice), vsAvgPct: Math.round((x.vsCategoryAvgPct || 0) * 1000) / 10, sharePct: x.amountShare == null ? null : Math.round(x.amountShare * 100) })),
      priceDrops: (c.priceDrops || []).slice(0, 5).map((x) => ({ cust: x.custName, product: x.productName, cur: Math.round(x.currentPrice), prev: Math.round(x.priorPrice), pct: Math.round((x.pctChange || 0) * 1000) / 10 })),
      mixCandidates: (c.mixCandidates || []).slice(0, 5).map((x) => ({ cust: x.custName, product: x.productName, price: Math.round(x.currentPrice), peerAvg: Math.round(x.peerWeightedAvg), shareDeltaPp: x.shareDeltaPp })),
      stockLag: (c.stockLag || []).slice(0, 8).map((x) => ({ product: x.productName, endStock: x.endStock, nextWeekArrival: x.nextWeekArrival })),
    }));
  return { orderYear: evidence.orderYear, major: evidence.major, prevMajor: evidence.prevMajor, categories: cats };
}

// 키가 없거나 LLM 실패 시 — 근거팩만으로 만드는 규칙 기반 요약(결정론).
function ruleFallbackOpinion(compact) {
  const lines = [];
  for (const c of compact.categories) {
    const parts = [];
    const kTxt = c.K == null ? '이익률 미계산' : `이익률 ${(c.K * 100).toFixed(1)}%${c.prevK != null ? ` (직전 ${(c.prevK * 100).toFixed(1)}%)` : ''}`;
    const top = (c.drivers || [])[0];
    if (top && top.profitImpact) parts.push(`최대 변동요인 ${top.col} (이익영향 ${Math.round(top.profitImpact / 10000)}만원)`);
    if (c.rate?.effect) parts.push(`환율 영향 ${Math.round(c.rate.effect / 10000)}만원`);
    if (c.lowPriceCustomers?.length) parts.push(`평균 대비 저단가 거래처 ${c.lowPriceCustomers.map((x) => x.cust).join('·')}`);
    if (c.stockLag?.length) parts.push(`재고 시차(잔량 음수) 품목 ${c.stockLag.length}건`);
    lines.push(`■ ${c.category}: ${kTxt}. ${parts.join(' · ') || '전기 대비 특이 요인 없음.'}`);
  }
  return lines.join('\n');
}

async function llmOpinion(compact) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  try {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const { trackLLMCall } = await import('../../../lib/chat/costTracker.js');
    const client = new Anthropic({ apiKey });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25000);
    const resp = await client.messages.create({
      model: MODEL,
      max_tokens: compact.categories.length > 3 ? 1300 : 600,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: `근거팩 JSON:\n${JSON.stringify(compact)}` }],
    }, { signal: controller.signal });
    clearTimeout(timer);
    trackLLMCall({
      userId: null, model: MODEL,
      inputTokens: resp?.usage?.input_tokens || 0,
      outputTokens: resp?.usage?.output_tokens || 0,
      purpose: 'profit-analysis',
    });
    const text = (resp.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
    return text || null;
  } catch {
    return null;
  }
}

export default withAuth(async function handler(req, res) {
  try {
    if (req.method !== 'POST') return res.status(405).json({ ok: false, message: 'Method not allowed' });
    await query(TABLE_SQL);

    const body = req.body || {};
    const major = parseMajor(body.week);
    if (!major) return res.status(400).json({ ok: false, message: 'week 필요 (예: 31)' });
    const orderYear = resolveActiveOrderYear(`${major}-01`, body.year);
    const category = String(body.category || ALL_CATEGORY).slice(0, 80);
    const force = Boolean(body.force);
    const actor = req.user?.userName || req.user?.userId || 'user';

    const evidence = await loadCategoryEvidence(orderYear, major);
    const categoryFilter = category === ALL_CATEGORY ? null : category;
    if (categoryFilter && !evidence.categories.some((c) => c.category === categoryFilter)) {
      return res.status(404).json({ ok: false, message: `${categoryFilter} 카테고리가 이 차수에 없습니다.` });
    }
    const compact = compactEvidence(evidence, categoryFilter);
    const hash = crypto.createHash('sha256').update(JSON.stringify(compact)).digest('hex');

    const cached = await query(
      `SELECT TOP (1) EvidenceHash, Opinion, Model, CreatedAt FROM dbo.WebProfitAnalysisOpinion
        WHERE OrderYear=@yr AND MajorWeek=@mw AND Category=@cat`,
      {
        yr: { type: sql.NVarChar(4), value: String(orderYear) },
        mw: { type: sql.NVarChar(10), value: String(major) },
        cat: { type: sql.NVarChar(80), value: category },
      },
    );
    const row = cached.recordset?.[0];
    if (row && row.EvidenceHash === hash && !force) {
      return res.status(200).json({
        ok: true, orderYear, major, category, cached: true,
        opinion: row.Opinion, model: row.Model,
        createdAt: row.CreatedAt?.toISOString?.() || row.CreatedAt || null,
      });
    }

    const llmText = await llmOpinion(compact);
    const opinion = llmText || ruleFallbackOpinion(compact);
    const model = llmText ? MODEL : 'rule-fallback';

    await query(
      `MERGE dbo.WebProfitAnalysisOpinion AS t
       USING (SELECT @yr AS OrderYear, @mw AS MajorWeek, @cat AS Category) AS s
          ON t.OrderYear=s.OrderYear AND t.MajorWeek=s.MajorWeek AND t.Category=s.Category
       WHEN MATCHED THEN UPDATE SET EvidenceHash=@hash, Opinion=@opinion, Model=@model, CreatedBy=@actor, CreatedAt=GETDATE()
       WHEN NOT MATCHED THEN INSERT (OrderYear, MajorWeek, Category, EvidenceHash, Opinion, Model, CreatedBy)
            VALUES (@yr, @mw, @cat, @hash, @opinion, @model, @actor);`,
      {
        yr: { type: sql.NVarChar(4), value: String(orderYear) },
        mw: { type: sql.NVarChar(10), value: String(major) },
        cat: { type: sql.NVarChar(80), value: category },
        hash: { type: sql.NVarChar(64), value: hash },
        opinion: { type: sql.NVarChar(sql.MAX), value: String(opinion).slice(0, 100000) },
        model: { type: sql.NVarChar(60), value: model },
        actor: { type: sql.NVarChar(100), value: truncateText(actor, 100) },
      },
    );

    return res.status(200).json({ ok: true, orderYear, major, category, cached: false, opinion, model, createdAt: new Date().toISOString() });
  } catch (e) {
    console.error('[sales/profit-analysis-opinion]', e);
    return res.status(e?.statusCode || 500).json({ ok: false, message: e?.message || 'AI 소견 생성 중 오류가 발생했습니다.' });
  }
});
