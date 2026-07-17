// pages/api/raum/pnl-import.js
// 라움 견적서(거래명세표) 엑셀 업로드 → 강남/건대 파싱·합산 + 전산 참고단가 조회 (저장은 /api/raum/pnl)
import fs from 'fs';
import formidable from 'formidable';
import XLSX from 'xlsx';
import { withAuth } from '../../../lib/auth';
import { query, sql } from '../../../lib/db';
import { resolveActiveOrderYear } from '../../../lib/orderUtils';
import { parseRaumQuoteWorkbook, lookupErpRefPrices, loadLearnedCosts, DEFAULT_NENOVA_PCT } from '../../../lib/raumPnl';

export const config = {
  api: { bodyParser: false },
};

async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });

  const form = formidable({ maxFileSize: 30 * 1024 * 1024, keepExtensions: true, multiples: false });
  let files;
  try {
    [, files] = await new Promise((resolve, reject) => {
      form.parse(req, (err, flds, fls) => (err ? reject(err) : resolve([flds, fls])));
    });
  } catch (e) {
    return res.status(400).json({ success: false, error: `업로드 파싱 실패: ${e.message}` });
  }

  const file = Array.isArray(files.file) ? files.file[0] : files.file;
  if (!file) return res.status(400).json({ success: false, error: 'file 필드 필요' });

  try {
    const buf = fs.readFileSync(file.filepath);
    const workbook = XLSX.read(buf, { type: 'buffer', cellDates: true, cellNF: false, cellStyles: false });
    const parsed = parseRaumQuoteWorkbook(XLSX, workbook);
    if (!parsed.items.length) {
      return res.status(400).json({ success: false, error: parsed.warnings[0] || '파싱된 품목이 없습니다.', warnings: parsed.warnings });
    }

    const major = parsed.major;
    if (!major) parsed.warnings.push('시트명에서 차수를 찾지 못했습니다 (예: "27차강남양식"). 저장 전 차수를 직접 입력하세요.');
    const quoteYear = parsed.quoteDate ? String(parsed.quoteDate.getFullYear()) : null;
    const orderYear = quoteYear || resolveActiveOrderYear(`${major || '01'}-01`);

    // 전산 참고단가 (매칭 실패는 null — 매입단가는 어차피 수기 입력)
    let refs = {};
    if (major) {
      try {
        refs = await lookupErpRefPrices(parsed.items.map(it => ({ name: it.name, price: it.price })), major, orderYear);
      } catch (e) {
        parsed.warnings.push(`전산 참고단가 조회 실패: ${e.message}`);
      }
    }

    // 지난 차수에 입력·저장한 매입단가 자동 채움 (수정 가능 — 저장하면 다시 학습)
    let learned = {};
    try {
      learned = await loadLearnedCosts(parsed.items.map(it => it.name));
    } catch (e) {
      parsed.warnings.push(`학습 매입단가 조회 실패: ${e.message}`);
    }
    const learnKey = (s) => String(s || '').replace(/[\s ]+/g, ' ').trim().toLowerCase();

    if (refs.__arrivalError) {
      parsed.warnings.push(refs.__arrivalError);
      delete refs.__arrivalError;
    }

    const items = parsed.items.map(it => {
      const ref = refs[it.name] || null;
      const learnedCost = learned[learnKey(it.name)];
      // 매입단가 자동입력 우선순위: ① 직접 입력해 학습된 값 ② 도착원가(가장 최근, 100원 반올림)
      // 전산원가÷1.1 은 참고 표시만(자동입력 안 함)
      let costPrice = null;
      let costSource = null;
      if (it.consigned) {
        // 사입(원산지 없음) — 손익 계산 제외 대상이라 매입단가 자체가 불필요
      } else if (learnedCost != null) {
        costPrice = learnedCost;
        costSource = 'learned';
      } else if (ref?.isArrival && ref.refPrice != null) {
        costPrice = ref.refPrice;
        costSource = 'arrival';
      }
      return {
        ...it,
        costPrice,
        costSource,
        costLearned: costSource === 'learned',
        refPrice: it.consigned ? null : (ref?.refPrice ?? null),
        refSource: it.consigned ? '사입(원산지 없음) — 손익 제외' : (ref?.refSource ?? null),
        isArrival: it.consigned ? false : (ref?.isArrival ?? false),
        erpSalePrice: ref?.erpSalePrice ?? null,
        erpQty: ref?.erpQty ?? null,
        prodKey: ref?.prodKey ?? null,
        prodName: ref?.prodName ?? null,
      };
    });

    // 같은 차수 기존 저장본 존재 여부 (덮어쓰기 경고용)
    let existing = null;
    if (major) {
      try {
        const r = await query(
          `SELECT TOP 1 PnlKey, Title, UpdatedAt, CreatedAt FROM WebRaumPnl
            WHERE OrderYear=@yr AND MajorWeek=@mj AND isDeleted=0 ORDER BY PnlKey DESC`,
          {
            yr: { type: sql.NVarChar, value: String(orderYear) },
            mj: { type: sql.NVarChar, value: String(major).padStart(2, '0') },
          }
        );
        existing = r.recordset[0] || null;
      } catch { /* 테이블 미생성 등 — 첫 업로드면 없음 */ }
    }

    return res.status(200).json({
      success: true,
      fileName: file.originalFilename || 'upload.xlsx',
      major,
      orderYear,
      // toISOString 금지(루트 CLAUDE.md — 시간대 변환으로 하루 밀림). 로컬 게터로 포맷.
      quoteDate: parsed.quoteDate
        ? `${parsed.quoteDate.getFullYear()}-${String(parsed.quoteDate.getMonth() + 1).padStart(2, '0')}-${String(parsed.quoteDate.getDate()).padStart(2, '0')}`
        : null,
      nenovaPct: DEFAULT_NENOVA_PCT,
      sheets: parsed.sheets.map(s => ({
        sheetName: s.sheetName, branch: s.branch, itemCount: s.items.length,
        parsedSupply: s.parsedSupply, summarySupply: s.summarySupply, summaryTotal: s.summaryTotal,
      })),
      items,
      verification: parsed.verification || null,
      warnings: parsed.warnings,
      existing,
    });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  } finally {
    try { fs.unlinkSync(file.filepath); } catch { /* 임시파일 정리 실패 무시 */ }
  }
}

export default withAuth(handler);
