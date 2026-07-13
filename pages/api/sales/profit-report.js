// 주차별 매출이익 보고서 API — 자동열은 SQL, 수기열은 WebProfitReport 저장.
import { withAuth } from '../../../lib/auth';
import { resolveActiveOrderYear } from '../../../lib/orderUtils';
import {
  CATEGORIES, EXTRA_CATEGORY,
  salesByCategory, estimateByCategory, purchaseByCategory, forwardingByCategory,
  purchaseQtyByCategory, stockSnapshotByCategory, currencyRates, loadManual, saveManual,
  stockPriceRows, saveStockPrices, currencyCodeForCategory,
} from '../../../lib/profitReport';
import { computeAutoEndingStock } from '../../../lib/profitReportCalc';
import { computeCustomsAndForwarding } from '../../../lib/customsForwarding';

function parseMajor(raw) {
  const m = String(raw || '').trim().match(/^(\d{1,2})(-\d{2})?$/);
  return m ? m[1].padStart(2, '0') : null;
}

// GET/엑셀 공용 — 보고서 행 데이터 구성
async function loadReportData(major, orderYear) {
  const prevMajor = String(Number(major) - 1).padStart(2, '0');
  const [N, est, Q, S, rates, cur, prev, stockEnd, stockBegin, purchQty, prevQ, prevS, prevPurchQty, customs, prevCustoms] = await Promise.all([
        salesByCategory(major, orderYear),
        estimateByCategory(major, orderYear),
        purchaseByCategory(major, orderYear),
        forwardingByCategory(major, orderYear),         // 레거시 FreightCost 추정치 — 구조화 입력값 없을 때만 fallback
        currencyRates(),
        loadManual(major, orderYear),
        loadManual(prevMajor, orderYear), // 전차수 기말재고(F) 저장값 → 이번 기초(E) 기본값
        stockSnapshotByCategory(major, orderYear),      // F 재료: 이번 차수말 재고수량·최근원가·단가표평가
        stockSnapshotByCategory(prevMajor, orderYear),  // E 재료: 전차수말 스냅샷
        purchaseQtyByCategory(major, orderYear),        // F 분모: 이번 차수 매입 총수량
        purchaseByCategory(prevMajor, orderYear),       // E 자동계산용: 전차수 구매외화
        forwardingByCategory(prevMajor, orderYear),     // E 자동계산용: 전차수 포워딩USD(레거시 fallback)
        purchaseQtyByCategory(prevMajor, orderYear),    // E 자동계산용: 전차수 매입 총수량
        computeCustomsAndForwarding(major, orderYear),      // 그외통관비(H)+포워딩(S) — 그외통관비/포워딩/콜롬비아1·2차 시트 재현
        computeCustomsAndForwarding(prevMajor, orderYear),  // E 자동계산용: 전차수 H/S
      ]);

      const keys = [...CATEGORIES.map(c => c.key)];
      const extraHasData = [N, est.L, est.O, Q, S].some(m => Math.abs(Number(m?.[EXTRA_CATEGORY] || 0)) > 0.001);
      if (extraHasData) keys.push(EXTRA_CATEGORY);

      const rateByCode = Object.fromEntries((rates || []).map(r => [r.CurrencyCode, Number(r.ExchangeRate)]));
      const rows = keys.map(key => {
        const def = CATEGORIES.find(c => c.key === key) || {};
        const man = cur.manual[key] || {};
        const prevMan = prev.manual[key] || {};
        const prevF = prevMan.F;
        const curCode = currencyCodeForCategory(key);
        const autoR = curCode && rateByCode[curCode] != null ? rateByCode[curCode] : null;
        // H 그외통관비 — 그외통관비 입력/포워딩 입력 화면에서 저장한 구조화 값(2026-07-10). 미입력 카테고리는 0.
        const autoH = customs.H[key] ?? 0;
        const prevAutoH = prevCustoms.H[key] ?? 0;
        // S 포워딩 — 구조화 입력값 우선, 없으면(0) 레거시 FreightCost 추정치로 fallback
        const autoS = customs.S[key] ? customs.S[key] : Number(S[key] || 0);
        const prevAutoS = prevCustoms.S[key] ? prevCustoms.S[key] : Number(prevS[key] || 0);
        // F 재료 — 엑셀 방식: (구매+포워딩+통관비)÷매입총수량×기말수량. 클라이언트가 H/R/S 수정 시 즉시 재계산
        const stock = {
          purchQty: purchQty[key] != null ? Number(purchQty[key]) : 0,
          endQty: stockEnd.qtys[key] != null ? Number(stockEnd.qtys[key]) : 0,
          recentCost: stockEnd.recentCost[key] != null ? Number(stockEnd.recentCost[key]) : 0,
          tableF: stockEnd.values[key] != null ? stockEnd.values[key] : null,
        };
        // 서버 기준 자동 F (저장된 수기 H/R/S 반영) — placeholder·엑셀생성 기본값
        const autoF = computeAutoEndingStock(stock, {
          Q: Number(Q[key] || 0),
          S: man.S ?? autoS,
          H: man.H ?? autoH,
          R: man.R ?? autoR,
        });
        // 자동 E = 전차수 F 를 같은 방식으로 계산 (전차수 저장 수기값 반영)
        const autoE = computeAutoEndingStock({
          purchQty: prevPurchQty[key] != null ? Number(prevPurchQty[key]) : 0,
          endQty: stockBegin.qtys[key] != null ? Number(stockBegin.qtys[key]) : 0,
          recentCost: stockBegin.recentCost[key] != null ? Number(stockBegin.recentCost[key]) : 0,
          tableF: stockBegin.values[key] != null ? stockBegin.values[key] : null,
        }, {
          Q: Number(prevQ[key] || 0),
          S: prevMan.S ?? prevAutoS,
          H: prevMan.H ?? prevAutoH,
          R: prevMan.R ?? autoR,
        });
        return {
          currency: curCode,
          category: key,
          variant: def.variant || 'normal',
          stock,
          auto: {
            N: Number(N[key] || 0),
            L: Number(est.L[key] || 0),
            O: Number(est.O[key] || 0),
            Q: Number(Q[key] || 0),
            S: autoS,
            H: autoH,                                    // 그외통관비 자동값(그외통관비/포워딩 입력 화면 연동)
            E: autoE != null ? Math.round(autoE) : null, // 전차수 기말재고 자동계산(엑셀 방식)
            F: autoF != null ? Math.round(autoF) : null, // 이번 차수 기말재고 자동계산(엑셀 방식)
            R: autoR,                                    // CurrencyMaster 기본 환율
          },
          manual: {
            E: man.E ?? (prevF ?? null),   // 우선순위: 이번차수 저장값 > 전차수 저장 기말 > (auto)
            F: man.F ?? null,
            H: man.H ?? null,
            R: man.R ?? null,
            S: man.S ?? null,              // 포워딩 수기 오버라이드(있으면 auto.S 대신)
          },
          inheritedE: man.E == null && prevF != null,
        };
      });

  return { rows, note: cur.note, rates, stockWeeks: { begin: stockBegin.week, end: stockEnd.week } };
}

export default withAuth(async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const major = parseMajor(req.query.week);
      if (!major) return res.status(400).json({ success: false, error: 'week 필요 (예: 27)' });
      const orderYear = resolveActiveOrderYear(`${major}-01`, req.query.year);

      // 재고 평가단가표 (기초/기말 스냅샷에 재고 있는 품목만)
      if (req.query.stockPrices === '1') {
        const prevMajor = String(Number(major) - 1).padStart(2, '0');
        const list = await stockPriceRows(major, prevMajor, orderYear);
        return res.status(200).json({ success: true, ...list });
      }

      const data = await loadReportData(major, orderYear);

      // 엑셀 다운로드 — 원본 양식 템플릿에 값만 채워 100% 동일 구성으로
      if (req.query.excel === '1') {
        const { buildProfitReportXlsx } = await import('../../../lib/profitReportExcel');
        const visibleCols = String(req.query.cols || '').split(',').map(s => s.trim()).filter(Boolean);
        const buf = buildProfitReportXlsx({ major, rows: data.rows, note: data.note, visibleCols });
        const filename = `주차별 매출이익 보고서-${Number(major)}차.xlsx`;
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="profit-report-${major}.xlsx"; filename*=UTF-8''${encodeURIComponent(filename)}`);
        return res.status(200).send(buf);
      }

      return res.status(200).json({ success: true, major, orderYear, ...data });
    }

    if (req.method === 'POST') {
      const major = parseMajor(req.body?.week);
      if (!major) return res.status(400).json({ success: false, error: 'week 필요' });
      const orderYear = resolveActiveOrderYear(`${major}-01`, req.body?.year);
      const actor = req.user?.userName || req.user?.userId || 'user';
      if (req.body?.action === 'stockPrices') {
        await saveStockPrices(req.body?.prices || {}, actor);
        return res.status(200).json({ success: true });
      }
      await saveManual(major, orderYear, req.body?.values || {}, req.body?.note, actor);
      return res.status(200).json({ success: true });
    }

    return res.status(405).json({ success: false, error: 'Method not allowed' });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});
