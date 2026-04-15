// lib/chat/handlers/order.js — 주문 조회 (선택지 기반)
//
// 흐름:
//  1) 차수 + 거래처 모두 확정되면 → 최종 조회 (품목별/합계)
//  2) 차수 대차수만 (예: "16차") → 해당 대차수의 세부차수 목록을 선택지로
//  3) 거래처 미확정 or 복수 후보 ("네덜란드") → 후보 목록을 선택지로
//  4) 차수/거래처 둘 다 없음 → 안내
//
// payload 예시 (선택지 버튼에서 재진입):
//   { intent:'order', week:'16-01', custKey:5, mode:'byItem'|'total' }
import { query, sql } from '../../db';
import { extractWeek, extractWeekDetail } from '../router';
import { findCustomer, findCustomersMulti } from '../entities';
import { findAmbiguousTokens } from '../catalog';
import { buildDisambiguationForText } from '../disambiguation';

export async function handleOrderLookup(text, user, payload = null) {
  // ── 1) payload 우선 (선택지에서 재진입)
  const wkDetail = extractWeekDetail(text);
  const weekStr  = payload?.week || (wkDetail?.exact ? wkDetail.week : null);
  const majorWk  = payload?.major || wkDetail?.major || null;
  const custKey  = payload?.custKey || null;
  const country  = payload?.country || null;          // 원산지 (Product.CounName)
  const mode     = payload?.mode || null;
  const scope    = payload?.scope || null;            // 'customer' | 'origin' | null

  // ── 0) 디스앰비기에이션 — payload 가 없을 때만 (첫 진입)
  //    "네덜란드" 같은 토큰이 거래처/원산지/지역 등 여러 의미일 때 객관식 먼저
  if (!payload) {
    const disambig = await buildDisambiguationForText(text, { intent: 'order' });
    if (disambig) return disambig;

    // 모호하지 않지만 단일 매칭은 자동 scope 결정
    const ambig = await findAmbiguousTokens(text);
    const clear = ambig.find(a => a.ambiguityCount === 1);
    if (clear && clear.asProductCountry && !clear.asCustomerName.length) {
      return await runOriginLookup(clear.asProductCountry.name, weekStr, majorWk, mode);
    }
  }

  // payload 의 scope 이 'origin' 이면 원산지 흐름
  if (scope === 'origin' && country) {
    return await runOriginLookup(country, weekStr, majorWk, mode);
  }

  // ── 2) 거래처 결정
  let cust = null;
  if (custKey) {
    const r = await query(
      `SELECT TOP 1 CustKey, CustName, CustArea FROM Customer
        WHERE CustKey=@ck AND ISNULL(isDeleted,0)=0`,
      { ck: { type: sql.Int, value: custKey } }
    );
    cust = r.recordset[0] || null;
  }

  // 거래처가 없고 차수도 미지정이면 → 안내
  if (!cust && !weekStr && !majorWk && !custKey) {
    const single = await findCustomer(text);
    if (!single) {
      return {
        messages: [
          { type: 'text', content: '어느 거래처의 주문을 조회할까요?\n예시: "꽃길 15-01 주문", "16차 네덜란드 주문"' },
        ],
      };
    }
    cust = single;
  } else if (!cust) {
    // 텍스트에서 거래처 후보 찾기 (국가/이름)
    const { country, candidates } = await findCustomersMulti(text);
    if (candidates.length === 0) {
      // 완전 매칭 1건 시도
      const single = await findCustomer(text);
      if (single) {
        cust = single;
      } else {
        // 차수 정보라도 있으면 최근 주문한 거래처 중 해당 차수 거래처 안내
        return {
          messages: [
            {
              type: 'text',
              content: country
                ? `🌍 "${country}" 거래처를 찾지 못했습니다.\n거래처 이름을 직접 입력해 주세요.`
                : '어느 거래처의 주문을 조회할까요?\n예시: "꽃길 15-01 주문", "16차 네덜란드 주문"',
            },
          ],
        };
      }
    } else if (candidates.length === 1) {
      cust = candidates[0];
    } else {
      // 복수 후보 → 선택지 제시
      const promptParts = [];
      if (country) promptParts.push(`🌍 ${country}`);
      if (majorWk) promptParts.push(`${majorWk}차`);
      if (weekStr) promptParts.push(weekStr);
      return {
        messages: [
          {
            type: 'text',
            content: `🔎 ${country ? `${country} 관련 ` : ''}거래처가 ${candidates.length}곳 있습니다.\n어느 거래처를 조회할까요?`,
          },
          {
            type: 'choices',
            prompt: promptParts.length ? `조건: ${promptParts.join(' · ')}` : '거래처 선택',
            choices: candidates.map(c => ({
              label: c.CustName,
              sub: c.CustArea || '',
              text: `${c.CustName} ${majorWk ? `${majorWk}차` : (weekStr || '')} 주문`.trim(),
              payload: {
                intent: 'order',
                custKey: c.CustKey,
                ...(weekStr ? { week: weekStr } : {}),
                ...(majorWk && !weekStr ? { major: majorWk } : {}),
                ...(mode ? { mode } : {}),
              },
            })),
          },
        ],
      };
    }
  }

  // ── 3) 차수 결정
  // 대차수만 지정 ("16차") → 해당 대차수의 세부차수 목록 선택지
  if (!weekStr && majorWk) {
    const wks = await query(
      `SELECT OrderWeek, COUNT(*) AS Cnt
         FROM OrderMaster
        WHERE CustKey=@ck AND ISNULL(isDeleted,0)=0
          AND OrderWeek LIKE @mj
        GROUP BY OrderWeek
        ORDER BY OrderWeek`,
      {
        ck: { type: sql.Int, value: cust.CustKey },
        mj: { type: sql.NVarChar, value: `${majorWk}-%` },
      }
    );
    if (wks.recordset.length === 0) {
      return {
        messages: [
          { type: 'text', content: `📭 ${cust.CustName} · ${majorWk}차 주문 내역이 없습니다.` },
        ],
      };
    }
    if (wks.recordset.length === 1) {
      // 세부차수 1개뿐 → 바로 조회
      return await runFinalLookup(cust, wks.recordset[0].OrderWeek, mode);
    }
    return {
      messages: [
        {
          type: 'text',
          content: `📅 ${cust.CustName} · ${majorWk}차에 세부차수가 ${wks.recordset.length}개 있습니다.\n어느 세부차수를 조회할까요?`,
        },
        {
          type: 'choices',
          prompt: `${cust.CustName} · ${majorWk}차 세부차수 선택`,
          choices: wks.recordset.map(w => ({
            label: `${w.OrderWeek}차`,
            sub: `주문 ${w.Cnt}건`,
            text: `${cust.CustName} ${w.OrderWeek} 주문`,
            payload: { intent: 'order', custKey: cust.CustKey, week: w.OrderWeek, ...(mode ? { mode } : {}) },
          })),
        },
      ],
    };
  }

  // 차수 미지정 → 최근 차수 (기존 로직 유지)
  let finalWeek = weekStr;
  if (!finalWeek) {
    const last = await query(
      `SELECT TOP 1 OrderWeek FROM OrderMaster
        WHERE CustKey=@ck AND ISNULL(isDeleted,0)=0
        ORDER BY OrderWeek DESC`,
      { ck: { type: sql.Int, value: cust.CustKey } }
    );
    if (!last.recordset[0]) {
      return { messages: [{ type: 'text', content: `📭 ${cust.CustName}의 주문 내역이 없습니다.` }] };
    }
    finalWeek = last.recordset[0].OrderWeek;
  }

  // ── 4) 조회 모드 선택 (품목별 vs 합계만)
  if (!mode) {
    return {
      messages: [
        {
          type: 'text',
          content: `✅ ${cust.CustName} · ${finalWeek}차\n어떻게 보여드릴까요?`,
        },
        {
          type: 'actions',
          actions: [
            {
              label: '📋 품목별 상세',
              primary: true,
              text: `${cust.CustName} ${finalWeek} 주문 품목별`,
              payload: { intent: 'order', custKey: cust.CustKey, week: finalWeek, mode: 'byItem' },
            },
            {
              label: '📊 합계만',
              text: `${cust.CustName} ${finalWeek} 주문 합계`,
              payload: { intent: 'order', custKey: cust.CustKey, week: finalWeek, mode: 'total' },
            },
          ],
        },
      ],
    };
  }

  // ── 5) 최종 조회
  return await runFinalLookup(cust, finalWeek, mode);
}

// ── 실제 DB 조회 + 카드 렌더
async function runFinalLookup(cust, week, mode = 'byItem') {
  const rows = await query(
    `SELECT om.OrderWeek, p.ProdName, p.OutUnit, od.OrderQuantity
       FROM OrderMaster om
       JOIN OrderDetail od ON od.OrderKey = om.OrderKey
       JOIN Product p ON p.ProdKey = od.ProdKey
      WHERE om.CustKey=@ck AND ISNULL(om.isDeleted,0)=0
        AND om.OrderWeek = @wk
      ORDER BY p.ProdName`,
    {
      ck: { type: sql.Int, value: cust.CustKey },
      wk: { type: sql.NVarChar, value: week },
    }
  );

  if (rows.recordset.length === 0) {
    return {
      messages: [{ type: 'text', content: `📭 ${cust.CustName} · ${week}차 주문 내역이 없습니다.` }],
    };
  }

  const totalQty = rows.recordset.reduce((s, r) => s + (r.OrderQuantity || 0), 0);

  if (mode === 'total') {
    // 단위별 합계
    const byUnit = {};
    for (const r of rows.recordset) {
      const u = r.OutUnit || '';
      byUnit[u] = (byUnit[u] || 0) + (r.OrderQuantity || 0);
    }
    return {
      messages: [
        { type: 'text', content: `📊 ${cust.CustName} · ${week}차 합계` },
        {
          type: 'card',
          card: {
            title: `${cust.CustName} · ${week}`,
            subtitle: `총 ${rows.recordset.length}품목`,
            rows: Object.entries(byUnit).map(([u, q]) => ({
              label: u || '단위미지정',
              value: q.toLocaleString(),
            })),
            footer: `전체 합계 ${totalQty.toLocaleString()}`,
          },
        },
      ],
    };
  }

  // 기본: 품목별
  return {
    messages: [
      { type: 'text', content: `📋 ${cust.CustName} · ${week}차 주문 (${rows.recordset.length}품목)` },
      {
        type: 'card',
        card: {
          title: `${cust.CustName} · ${week}`,
          rows: rows.recordset.slice(0, 20).map(r => ({
            label: r.ProdName,
            value: `${r.OrderQuantity} ${r.OutUnit || ''}`,
          })),
          footer: `총 ${rows.recordset.length}품목 · 합계 ${totalQty.toLocaleString()}${rows.recordset.length > 20 ? ' (상위 20개만 표시)' : ''}`,
        },
      },
    ],
  };
}

// ── 디스앰비기에이션 응답 생성
// 모호 토큰 (예: "네덜란드") 을 어떤 의미로 해석할지 객관식으로 묻는다.
function buildDisambiguationResponse(ambig, ctx) {
  const { token, asCustomerName, asCustomerArea, asProductCountry, asProductFlower } = ambig;
  const { weekStr, majorWk, mode } = ctx || {};

  const weekTag = weekStr || (majorWk ? `${majorWk}차` : null);
  const choices = [];

  // 1) 거래처 이름 매칭
  if (asCustomerName.length > 0) {
    choices.push({
      label: `🏢 거래처 "${token}" 의 주문`,
      sub:   `이름에 "${token}" 포함된 거래처 ${asCustomerName.length}곳`,
      text:  `${token} ${weekTag || ''} 주문 거래처`,
      payload: {
        intent: 'order',
        scope:  'customer',
        ...(weekStr ? { week: weekStr } : {}),
        ...(majorWk && !weekStr ? { major: majorWk } : {}),
        ...(mode ? { mode } : {}),
        // 거래처 후보는 다음 단계에서 findCustomersMulti 로 다시 제시
        // (여기서는 텍스트 그대로 재진입시키면 기존 흐름이 처리)
      },
    });
  }
  // 2) 거래처 지역 매칭
  if (asCustomerArea.length > 0 && asCustomerName.length === 0) {
    choices.push({
      label: `📍 지역 "${token}" 거래처들의 주문`,
      sub:   `소재지=${token} 거래처 ${asCustomerArea.length}곳`,
      text:  `${token} 지역 ${weekTag || ''} 주문`,
      payload: {
        intent: 'order',
        scope:  'customer',
        ...(weekStr ? { week: weekStr } : {}),
        ...(majorWk && !weekStr ? { major: majorWk } : {}),
        ...(mode ? { mode } : {}),
      },
    });
  }
  // 3) 꽃 원산지 (Product.CounName)
  if (asProductCountry) {
    choices.push({
      label: `🌍 원산지 "${token}" 인 꽃의 주문 (전 거래처 합계)`,
      sub:   `해당 원산지 품목 ${asProductCountry.productCount}종`,
      text:  `${token}산 꽃 ${weekTag || ''} 주문 합계`,
      payload: {
        intent:  'order',
        scope:   'origin',
        country: asProductCountry.name,
        ...(weekStr ? { week: weekStr } : {}),
        ...(majorWk && !weekStr ? { major: majorWk } : {}),
        ...(mode ? { mode } : {}),
      },
    });
  }
  // 4) 꽃 종류 (FlowerName)
  if (asProductFlower) {
    choices.push({
      label: `🌸 꽃 종류 "${token}" 의 주문`,
      sub:   `해당 꽃 종류 품목 ${asProductFlower.productCount}종`,
      text:  `${token} ${weekTag || ''} 꽃 주문`,
      payload: {
        intent: 'order',
        scope:  'flower',
        flower: asProductFlower.name,
        ...(weekStr ? { week: weekStr } : {}),
        ...(majorWk && !weekStr ? { major: majorWk } : {}),
      },
    });
  }

  const promptParts = [];
  if (weekTag) promptParts.push(weekTag);
  promptParts.push(`"${token}" 의 의미`);

  return {
    messages: [
      {
        type: 'text',
        content: `🤔 "${token}" 가 여러 의미로 해석됩니다.\n어떤 데이터를 보여드릴까요?`,
      },
      {
        type: 'choices',
        prompt: promptParts.join(' · '),
        choices,
      },
    ],
  };
}

// ── 원산지(Product.CounName) 기반 주문 합계 조회
// 거래처와 무관하게, 해당 차수에서 원산지가 country 인 꽃의 주문 합계.
async function runOriginLookup(country, weekStr, majorWk, mode = 'total') {
  // 차수 미지정 → 전체 거래처 통틀어 가장 최근 차수 사용
  let finalWeek = weekStr;
  let weekFilterClause = '';
  const params = { co: { type: sql.NVarChar, value: country } };

  if (finalWeek) {
    weekFilterClause = ' AND om.OrderWeek = @wk';
    params.wk = { type: sql.NVarChar, value: finalWeek };
  } else if (majorWk) {
    // 대차수만 지정 → 해당 대차수의 세부차수 목록 선택지 반환
    const wks = await query(
      `SELECT DISTINCT om.OrderWeek
         FROM OrderMaster om
         JOIN OrderDetail od ON od.OrderKey = om.OrderKey
         JOIN Product p      ON p.ProdKey  = od.ProdKey
        WHERE ISNULL(om.isDeleted,0)=0 AND p.CounName=@co
          AND om.OrderWeek LIKE @mj
        ORDER BY om.OrderWeek`,
      { co: { type: sql.NVarChar, value: country },
        mj: { type: sql.NVarChar, value: `${majorWk}-%` } }
    );
    if (wks.recordset.length === 0) {
      return { messages: [{ type: 'text', content: `📭 ${majorWk}차에 원산지 "${country}" 주문이 없습니다.` }] };
    }
    if (wks.recordset.length === 1) {
      finalWeek = wks.recordset[0].OrderWeek;
      weekFilterClause = ' AND om.OrderWeek = @wk';
      params.wk = { type: sql.NVarChar, value: finalWeek };
    } else {
      return {
        messages: [
          { type: 'text', content: `📅 원산지 "${country}" · ${majorWk}차에 세부차수가 ${wks.recordset.length}개입니다.\n어느 세부차수를 조회할까요?` },
          {
            type: 'choices',
            prompt: `원산지 ${country} · ${majorWk}차 세부차수`,
            choices: wks.recordset.map(w => ({
              label: `${w.OrderWeek}차`,
              text: `${country}산 ${w.OrderWeek} 주문`,
              payload: { intent:'order', scope:'origin', country, week: w.OrderWeek, mode },
            })),
          },
        ],
      };
    }
  }

  const rows = await query(
    `SELECT p.ProdName, p.CounName, p.FlowerName, p.OutUnit,
            SUM(od.OrderQuantity)    AS Qty,
            COUNT(DISTINCT om.CustKey) AS CustCnt
       FROM OrderMaster om
       JOIN OrderDetail od ON od.OrderKey = om.OrderKey
       JOIN Product p      ON p.ProdKey  = od.ProdKey
      WHERE ISNULL(om.isDeleted,0)=0 AND p.CounName=@co ${weekFilterClause}
      GROUP BY p.ProdName, p.CounName, p.FlowerName, p.OutUnit
      ORDER BY SUM(od.OrderQuantity) DESC`,
    params
  );

  if (rows.recordset.length === 0) {
    return {
      messages: [{
        type: 'text',
        content: `📭 원산지 "${country}" · ${finalWeek || '전체 차수'} 주문 내역이 없습니다.`,
      }],
    };
  }

  const totalQty = rows.recordset.reduce((s, r) => s + (r.Qty || 0), 0);
  const totalCusts = await query(
    `SELECT COUNT(DISTINCT om.CustKey) AS CustCnt
       FROM OrderMaster om
       JOIN OrderDetail od ON od.OrderKey = om.OrderKey
       JOIN Product p      ON p.ProdKey  = od.ProdKey
      WHERE ISNULL(om.isDeleted,0)=0 AND p.CounName=@co ${weekFilterClause}`,
    params
  );

  // 합계 모드 (단위별)
  if (mode === 'total') {
    const byUnit = {};
    for (const r of rows.recordset) {
      const u = r.OutUnit || '';
      byUnit[u] = (byUnit[u] || 0) + (r.Qty || 0);
    }
    return {
      messages: [
        { type: 'text', content: `🌍 원산지 "${country}" · ${finalWeek || '전체'}차 합계` },
        {
          type: 'card',
          card: {
            title: `${country}산 · ${finalWeek || '전체'}`,
            subtitle: `${rows.recordset.length}품목 · ${totalCusts.recordset[0].CustCnt}개 거래처`,
            rows: Object.entries(byUnit).map(([u, q]) => ({
              label: u || '단위미지정',
              value: q.toLocaleString(),
            })),
            footer: `전체 합계 ${totalQty.toLocaleString()}`,
          },
        },
        {
          type: 'actions',
          actions: [
            {
              label: '📋 품목별 보기',
              text: `${country}산 ${finalWeek || ''} 품목별`,
              payload: { intent:'order', scope:'origin', country, week: finalWeek, mode: 'byItem' },
            },
          ],
        },
      ],
    };
  }

  // 품목별 모드
  return {
    messages: [
      { type: 'text', content: `🌍 원산지 "${country}" · ${finalWeek || '전체'}차 (${rows.recordset.length}품목)` },
      {
        type: 'card',
        card: {
          title: `${country}산 · ${finalWeek || '전체'}`,
          subtitle: `${totalCusts.recordset[0].CustCnt}개 거래처 합산`,
          rows: rows.recordset.slice(0, 20).map(r => ({
            label: `${r.FlowerName || ''} ${r.ProdName}`.trim(),
            value: `${(r.Qty || 0).toLocaleString()} ${r.OutUnit || ''}`,
          })),
          footer: `총 ${rows.recordset.length}품목 · 합계 ${totalQty.toLocaleString()}${rows.recordset.length > 20 ? ' (상위 20개)' : ''}`,
        },
      },
    ],
  };
}
