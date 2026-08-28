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
  '- 근거팩의 금액·비율은 이미 단위가 붙은 문자열이다(만원/원/%). 그 문자열을 그대로 인용하고, 단위 환산·재계산·새 수치 생성을 절대 하지 마라.',
  '- 이익영향은 양수(+)=이익 개선, 음수(-)=이익 악화다. 부호와 반대로 서술하지 마라.',
  '- 변동요인의 항목명(매출액/기초상품재고액/기말상품재고액/상품매입액/그외통관비/포워딩)을 그대로 쓰고 다른 이름으로 바꿔 부르지 마라.',
  '- 카테고리(품종)마다 이익률이 왜 높거나 낮은지 핵심 원인을 영향이 큰 순서로 2~4문장으로 설명하라.',
  '- 원인 유형: ①거래처 판매단가(저단가거래처: 카테고리 평균 대비 낮은 거래처와 매출비중) ②저가비중확대·단가하락 ③환율(환율.이익영향) ④재고시차(기말잔량 음수 = 다음 차수 입고분을 이번 차수에 선판매) ⑤변동요인(매입·통관비·포워딩·재고).',
  '- cnf=true(호주·베트남)는 운임이 매입단가에 포함(CNF)이라 포워딩 부재가 정상임을 전제로 하라.',
  '- 전산(ERP)이 정답이다. 데이터 결측이 의심되면 "확인 필요"로 명시하고 단정하지 마라.',
  '- 출력은 한국어. 카테고리별로 "■ 카테고리명" 제목 뒤 서술. 금액은 만원 단위로 반올림해 말해도 된다.',
].join('\n');

function truncateText(value, max = 1900) {
  return String(value || '').slice(0, max);
}

// LLM의 산수 환각을 차단한다 — 금액·비율을 서버가 미리 문자열로 포맷해 전달하고,
// 프롬프트는 "그 문자열을 그대로 인용"만 허용한다.
const fmtMan = (v) => {
  if (v == null || Number.isNaN(Number(v))) return null;
  const man = Math.round(Number(v) / 10000);
  return `${man > 0 ? '+' : ''}${man.toLocaleString()}만원`;
};
const fmtPct = (v) => (v == null || Number.isNaN(Number(v)) ? null : `${(Number(v) * 100).toFixed(1)}%`);

function compactEvidence(evidence, categoryFilter) {
  const cats = (evidence.categories || [])
    .filter((c) => !categoryFilter || c.category === categoryFilter)
    .map((c) => ({
      category: c.category,
      cnf: c.cnf,
      이번이익률: fmtPct(c.K), 직전이익률: fmtPct(c.prevK), 매출이익: fmtMan(c.J), 매출액: fmtMan(c.C),
      변동요인: (c.drivers || []).slice(0, 4).map((d) => ({ 항목: DRIVER_LABEL[d.column] || d.column, 이번대비직전증감: fmtMan(d.delta), 이익영향: fmtMan(d.profitImpact) })),
      환율: c.rate && (c.rate.current != null || c.rate.prev != null)
        ? { 이번: c.rate.current, 직전: c.rate.prev, 이익영향: fmtMan(c.rate.effect) }
        : null,
      저단가거래처: (c.customerPrices || []).filter((x) => (x.vsCategoryAvgPct ?? 0) < -0.03).slice(0, 5)
        .map((x) => ({ 거래처: x.custName, 단가: `${Math.round(x.unitPrice).toLocaleString()}원`, 평균대비: fmtPct(x.vsCategoryAvgPct), 매출비중: fmtPct(x.amountShare) })),
      단가하락: (c.priceDrops || []).slice(0, 5).map((x) => ({ 거래처: x.custName, 품목: x.productName, 이번: `${Math.round(x.currentPrice).toLocaleString()}원`, 직전: `${Math.round(x.priorPrice).toLocaleString()}원`, 변화: fmtPct(x.pctChange) })),
      저가비중확대: (c.mixCandidates || []).slice(0, 5).map((x) => ({ 거래처: x.custName, 품목: x.productName, 단가: `${Math.round(x.currentPrice).toLocaleString()}원`, 품목평균: `${Math.round(x.peerWeightedAvg).toLocaleString()}원`, 비중변화: `+${x.shareDeltaPp}%p` })),
      재고시차: (c.stockLag || []).slice(0, 8).map((x) => ({ 품목: x.productName, 기말잔량: x.endStock, 다음차수입고확인: x.nextWeekArrival })),
    }));
  return { orderYear: evidence.orderYear, major: evidence.major, prevMajor: evidence.prevMajor, categories: cats };
}

// 키가 없거나 LLM 실패 시 — 근거팩만으로 만드는 규칙 기반 요약(결정론).
function ruleFallbackOpinion(compact) {
  const lines = [];
  for (const c of compact.categories) {
    const parts = [];
    const kTxt = c.이번이익률 == null ? '이익률 미계산' : `이익률 ${c.이번이익률}${c.직전이익률 != null ? ` (직전 ${c.직전이익률})` : ''}`;
    const top = (c.변동요인 || [])[0];
    if (top && top.이익영향) parts.push(`최대 변동요인 ${top.항목} (이익영향 ${top.이익영향})`);
    if (c.환율?.이익영향) parts.push(`환율 영향 ${c.환율.이익영향}`);
    if (c.저단가거래처?.length) parts.push(`평균 대비 저단가 거래처 ${c.저단가거래처.map((x) => x.거래처).join('·')}`);
    if (c.재고시차?.length) parts.push(`재고 시차(잔량 음수) 품목 ${c.재고시차.length}건`);
    lines.push(`■ ${c.category}: ${kTxt}. ${parts.join(' · ') || '전기 대비 특이 요인 없음.'}`);
  }
  return lines.join('
');
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
