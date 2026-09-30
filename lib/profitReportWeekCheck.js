// lib/profitReportWeekCheck.js — 새 차수 자동 점검(반차수별 반복 위험 목록 + 자동 처리 결과).
//
// 사장님(2026-09-30): 문제는 나열만 하지 말고 실제로 처리돼야 한다.
// 각 행 status:
//   auto    = 전산 자동(정상 경로) — 내부 판정용, 최종 결과에서는 제외(오류만 표시)
//   input   = 입력 필요 — 정확한 화면·반차수 링크
//   review  = 확인 필요 — 자동 처리했지만 사람이 한 번 봐야 하는 것
//   ok      = 정상 — 최종 결과에서 제외
// 읽기 전용(ERP·웹 테이블 SELECT). 계산값을 바꾸지 않는다 — 자동 처리는 기존 계산 경로(PR #818/#821 Apollo GW/CW,
// 혼적 AWB 5품목 풀, 수국 기본 박스값, 0원 GW/CW 잔재 제외, GW>CW 시 CW 사용)가 이미 한 일을 근거와 함께 드러낸다.
import { query, sql } from './db.js';
import {
  isFreightItem, isGrossWeightItem, isChargeableWeightItem, freightWeightOfRow, isOrphanZeroRow, defaultBoxMetrics,
} from './freightCalc.js';
import { baseCountry } from './countryClassification.js';
import { chinaSubcategory } from './boxMetricTable.js';
import { colombiaWeekStateText, fmtNum, buildFixLink } from './profitReportAuditDetails.js';

export const STATUS = { AUTO: 'auto', INPUT: 'input', REVIEW: 'review', OK: 'ok' };
export const STATUS_LABEL = { auto: '자동처리됨', input: '입력 필요', review: '확인 필요', ok: '정상' };

const n0 = (v) => (v == null || Number.isNaN(Number(v)) ? 0 : Number(v));
const pad2 = (m) => String(Number(m)).padStart(2, '0');
const KNOWN_COLOMBIA_FLOWERS = /장미|rose|카네이션|carnation|알스트로|alstro|루스커스|ruscus|수국|hydrangea/i;
const BOX_METRIC_COUNTRIES = ['콜롬비아', '중국'];
const EXACT_RATE_SOURCES = new Set(['freight_cost_snapshot', 'saved_official_week', 'excel_historical_snapshot', 'kcs_api', 'manual_input']);

function link(label, href) { return href ? { label, href } : null; }

/** 원천 조회 — 대차수 M 의 반차수 입고 상세 + 원가자료(환율) + 최근 5개 차수 매입 품목 + 이번 차수 출고 품목. */
export async function loadWeekCheckSources(major, orderYear) {
  const y = String(orderYear);
  const M = Number(major);
  const recentMajors = [];
  for (let m = M; m >= Math.max(1, M - 4); m -= 1) recentMajors.push(pad2(m));
  const prevMajors = [];
  for (let m = M - 1; m >= Math.max(1, M - 6); m -= 1) prevMajors.push(pad2(m));
  const params = { y: { type: sql.NVarChar, value: y }, pfx: { type: sql.NVarChar, value: `${pad2(M)}-%` } };
  recentMajors.forEach((m, i) => { params[`r${i}`] = { type: sql.NVarChar, value: m }; });
  prevMajors.forEach((m, i) => { params[`p${i}`] = { type: sql.NVarChar, value: m }; });
  const W2 = (c) => `RIGHT('0' + LEFT(${c}, CASE WHEN CHARINDEX('-', ${c}) > 0 THEN CHARINDEX('-', ${c}) - 1 ELSE LEN(${c}) END), 2)`;
  const r = await query(
    `SELECT wm.WarehouseKey, wm.OrderWeek, wm.OrderNo AS AWB, LTRIM(RTRIM(ISNULL(wm.FarmName,N''))) AS FarmName,
            LTRIM(RTRIM(ISNULL(wm.InvoiceNo,N''))) AS InvoiceNo, ISNULL(wm.GrossWeight,0) AS masterGW, ISNULL(wm.ChargeableWeight,0) AS masterCW,
            wd.WdetailKey, wd.ProdKey, wd.BoxQuantity, wd.BunchQuantity, wd.SteamQuantity, wd.OutQuantity, wd.EstQuantity, wd.TPrice,
            LTRIM(RTRIM(ISNULL(p.ProdName,N''))) AS ProdName, LTRIM(RTRIM(ISNULL(p.FlowerName,N''))) AS FlowerName,
            LTRIM(RTRIM(ISNULL(p.CounName,N''))) AS CounName, p.BoxWeight AS P_BoxWeight, p.BoxCBM AS P_BoxCBM,
            f.BoxWeight AS F_BoxWeight, f.BoxCBM AS F_BoxCBM
       FROM WarehouseMaster wm
       JOIN WarehouseDetail wd ON wd.WarehouseKey = wm.WarehouseKey
       LEFT JOIN Product p ON p.ProdKey = wd.ProdKey
       OUTER APPLY (SELECT TOP 1 fl.BoxWeight, fl.BoxCBM FROM Flower fl WHERE fl.FlowerName = p.FlowerName AND ISNULL(fl.isDeleted,0) = 0) f
      WHERE ISNULL(wm.isDeleted,0) = 0 AND wm.OrderYear = @y AND wm.OrderWeek LIKE @pfx;
     SELECT OrderWeek, LTRIM(RTRIM(ISNULL(CountryName,N''))) AS CountryName, COUNT(*) AS n,
            SUM(CASE WHEN ISNULL(ExchangeRate,0) > 0 THEN 1 ELSE 0 END) AS fxRows, MIN(ExchangeRate) AS fxMin, MAX(ExchangeRate) AS fxMax
       FROM WebArrivalCostLine WHERE OrderYear = @y AND IsCurrent = 1 AND ${W2('OrderWeek')} = RIGHT('0' + @m2, 2)
      GROUP BY OrderWeek, LTRIM(RTRIM(ISNULL(CountryName,N'')));
     SELECT DISTINCT LTRIM(RTRIM(ISNULL(CountryName,N''))) AS CountryName
       FROM WebArrivalCostLine WHERE OrderYear = @y AND IsCurrent = 1
        AND ${W2('OrderWeek')} IN (${prevMajors.length ? prevMajors.map((_, i) => `@p${i}`).join(',') : `N'--'`});
     SELECT DISTINCT wd.ProdKey
       FROM WarehouseMaster wm JOIN WarehouseDetail wd ON wd.WarehouseKey = wm.WarehouseKey
      WHERE ISNULL(wm.isDeleted,0) = 0 AND wm.OrderYear = @y AND ${W2('wm.OrderWeek')} IN (${recentMajors.map((_, i) => `@r${i}`).join(',')})
        AND wd.ProdKey IS NOT NULL;
     SELECT sd.ProdKey, LTRIM(RTRIM(ISNULL(p.ProdName,N''))) AS ProdName, LTRIM(RTRIM(ISNULL(p.CounName,N''))) AS CounName,
            SUM(ISNULL(sd.OutQuantity,0)) AS OutQty, SUM(ISNULL(sd.Amount,0)) AS Amount
       FROM ShipmentMaster sm JOIN ShipmentDetail sd ON sd.ShipmentKey = sm.ShipmentKey
       LEFT JOIN Product p ON p.ProdKey = sd.ProdKey
      WHERE ISNULL(sm.isDeleted,0) = 0 AND sm.OrderYear = @y AND sm.OrderWeek LIKE @pfx AND ISNULL(sd.OutQuantity,0) <> 0
      GROUP BY sd.ProdKey, p.ProdName, p.CounName`,
    { ...params, m2: { type: sql.NVarChar, value: pad2(M) } },
  );
  const [inbound, arrival, arrivalPrevCountries, recentPurchased, shipped] = r.recordsets;
  return {
    inbound: inbound || [],
    arrival: arrival || [],
    arrivalPrevCountries: (arrivalPrevCountries || []).map((x) => x.CountryName).filter(Boolean),
    recentPurchasedProdKeys: new Set((recentPurchased || []).map((x) => x.ProdKey)),
    shipped: shipped || [],
    recentMajors,
  };
}

const subOf = (orderWeek) => {
  const m = String(orderWeek || '').match(/^(\d{1,2})-0?(\d)/);
  return m ? `${pad2(m[1])}-0${m[2]}` : String(orderWeek || '');
};

/**
 * 순수 함수 — 점검 행 목록.
 * @param {object} input { orderYear, major, sources(loadWeekCheckSources), colombiaWeeks(computeCustomsAndForwarding.components.colombiaWeeks), report(보고서 payload) }
 */
export function buildWeekCheck({ orderYear, major, sources = {}, colombiaWeeks = [], report = {} } = {}) {
  const rows = [];
  const add = (sub, topic, status, text, extra = {}) => rows.push({ subWeek: sub, topic, status, statusLabel: STATUS_LABEL[status], text, ...extra });
  const wk = pad2(major);
  const customsHref = (focus) => buildFixLink('customs', { orderYear, major: wk, focus })?.href;
  const inbound = sources.inbound || [];
  const bySub = new Map();
  for (const row of inbound) {
    const sub = subOf(row.OrderWeek);
    if (!bySub.has(sub)) bySub.set(sub, []);
    bySub.get(sub).push(row);
  }
  const subs = [...new Set([...bySub.keys(), ...colombiaWeeks.map((w) => subOf(w.orderWeek))])].sort();

  for (const sub of subs) {
    const list = bySub.get(sub) || [];
    const flowerRows = list.filter((r) => !isFreightItem(r.ProdName) && !isOrphanZeroRow(r));
    const countriesIn = new Set(flowerRows.map((r) => baseCountry(r.CounName)).filter(Boolean));

    // 1) 박스당 무게/CBM — 단일 원천 = 원가자료 엑셀 표(lib/boxMetricTable.js, PR #822). 콜롬비아 박스당·중국 단당(차수별).
    //    표에 있으면 자동, 중국 '기타'는 GW/CW 잔여 역산(자동), 표에도 마스터에도 없는 콜롬비아 꽃만 입력 필요.
    for (const country of BOX_METRIC_COUNTRIES) {
      const cRows = flowerRows.filter((r) => baseCountry(r.CounName) === country && n0(r.BoxQuantity) > 0);
      if (!cRows.length) continue;
      const table = new Map();
      const residual = new Map();
      const master = new Map();
      const missing = new Map();
      for (const r of cRows) {
        const key = (country === '중국' ? chinaSubcategory(r.ProdName || r.FlowerName) : null) || r.FlowerName || r.ProdName || `ProdKey ${r.ProdKey}`;
        const t = defaultBoxMetrics(r.FlowerName, r.CounName, sub, r.ProdName);
        if (t && n0(t.boxWeight) > 0) { table.set(key, t); continue; }
        if (country === '중국') { residual.set(key, n0(residual.get(key)) + n0(r.BoxQuantity)); continue; }
        const w = r.P_BoxWeight ?? r.F_BoxWeight;
        const c = r.P_BoxCBM ?? r.F_BoxCBM;
        if (n0(w) > 0 && n0(c) > 0) master.set(key, { boxWeight: w, boxCBM: c });
        else missing.set(key, { boxes: n0(missing.get(key)?.boxes) + n0(r.BoxQuantity), weight: w, cbm: c });
      }
      const topic = country === '중국' ? '중국 박스(단)당 무게' : '박스당 무게/CBM';
      const fmtMap = (m) => [...m.entries()].map(([k, v]) => `${k} ${fmtNum(v.boxWeight)}/${fmtNum(v.boxCBM)}`).join(', ');
      if (missing.size) {
        add(sub, topic, STATUS.INPUT,
          `${country} ${[...missing.entries()].map(([k, v]) => `${k}(${fmtNum(v.boxes)}박스)`).join(', ')} — 원가자료 표·품종 마스터 모두 박스당 무게/CBM 없음(운임·통관 배분 0)`,
          { link: link('품목 마스터 열기', '/master/products') });
      }
      if (table.size) add(sub, topic, STATUS.AUTO, `${country} 원가자료 표 적용(무게/CBM): ${fmtMap(table)}`);
      if (residual.size) {
        add(sub, topic, STATUS.AUTO,
          `중국 ${[...residual.entries()].map(([k, v]) => `${k}(${fmtNum(v)})`).join(', ')} — 표에 없는 '기타'는 GW/CW 잔여 역산(잔여 없으면 평균값, 운임 0원 없음)`);
      }
      if (master.size) add(sub, topic, STATUS.REVIEW, `${country} ${fmtMap(master)} — 원가자료 표에 없어 품종 마스터 값 사용, 표 값 확인`);
    }

    // 2) 그외통관비(콜롬비아 4품목 공유) — Apollo GW/CW 자동(PR #818/#821)
    const cw = colombiaWeeks.find((w) => subOf(w.orderWeek) === sub);
    if (cw) {
      const isMissing = cw.inbound !== false && !(n0(cw.gw) > 0) && cw.gwSource === 'missing';
      const text = colombiaWeekStateText(cw, isMissing);
      if (cw.inbound === false && !(n0(cw.gw) > 0)) add(sub, '그외통관비(콜롬비아)', STATUS.OK, text);
      else if (isMissing) add(sub, '그외통관비(콜롬비아)', STATUS.INPUT, text, { link: link(`그외통관비 입력 열기 (${sub})`, customsHref(sub)) });
      else if (cw.gwSource === 'erp_inbound') add(sub, '그외통관비(콜롬비아)', STATUS.AUTO, `${text} → H ${fmtNum(cw.total, 0)}원`);
      else if (cw.gwSource === 'manual' && cw.erpWeight && n0(cw.erpWeight.GW) > 0
        && Math.abs(n0(cw.gw) - n0(cw.erpWeight.GW)) > 1) {
        add(sub, '그외통관비(콜롬비아)', STATUS.REVIEW,
          `수기 GW ${fmtNum(cw.gw)} ≠ 전산 입고 GW ${fmtNum(cw.erpWeight.GW)} — 어느 값이 맞는지 확인`,
          { link: link(`그외통관비 입력 열기 (${sub})`, customsHref(sub)) });
      } else add(sub, '그외통관비(콜롬비아)', STATUS.OK, `${text} → H ${fmtNum(cw.total, 0)}원`);
    }

    // 3) 입고 입력 형태 이상
    const estZero = flowerRows.filter((r) => n0(r.BoxQuantity) > 0 && !(n0(r.EstQuantity) > 0));
    if (estZero.length) {
      add(sub, '입고 입력 형태', STATUS.REVIEW,
        `박스는 있는데 EstQuantity(금액기준 수량)=0 인 행 ${estZero.length}건: ${estZero.slice(0, 6).map((r) => `${r.ProdName || r.ProdKey}(${fmtNum(r.BoxQuantity)}박스, AWB ${r.AWB || '-'})`).join(', ')}${estZero.length > 6 ? ' 외' : ''} — 구매수량(재고 평가 분모)에서 빠짐`,
        { link: link('입고관리 열기', `/warehouse?week=${encodeURIComponent(sub)}`) });
    }
    const orphan = list.filter((r) => isOrphanZeroRow(r));
    if (orphan.length) {
      add(sub, '입고 입력 형태', STATUS.AUTO,
        `품목 없는 0원 상세행 ${orphan.length}건(GW/CW 중복 입력 잔재 추정, AWB ${[...new Set(orphan.map((r) => r.AWB || '-'))].join(', ')}) — 꽃 행에서 제외하고 계산`);
    }
    // GW>CW, 반복 GW (AWB 단위)
    const byWh = new Map();
    for (const r of list) {
      const e = byWh.get(r.WarehouseKey) || { awb: r.AWB, farm: r.FarmName, gw: 0, cw: 0, masterGW: n0(r.masterGW), masterCW: n0(r.masterCW) };
      if (isGrossWeightItem(r.ProdName)) e.gw += freightWeightOfRow(r);
      if (isChargeableWeightItem(r.ProdName)) e.cw += freightWeightOfRow(r);
      byWh.set(r.WarehouseKey, e);
    }
    const whs = [...byWh.values()].map((e) => ({ ...e, GW: e.gw > 1 ? e.gw : e.masterGW, CW: e.cw > 1 ? e.cw : e.masterCW }));
    const gwGtCw = whs.filter((e) => e.GW > 1 && e.CW > 1 && e.GW > e.CW + 0.001);
    if (gwGtCw.length) {
      // 콜롬비아 그외통관비 경로(PR #818)는 GW>CW 면 CW 를 쓴다(자동). 그 밖의 AWB 는 값 자체를 사람이 확인해야 한다.
      const clamped = new Set((cw?.erpWeight?.sources || []).filter((x) => x.gwClampedToCw).map((x) => String(x.awb || '')));
      const auto = gwGtCw.filter((e) => clamped.has(String(e.awb || '')));
      const manual = gwGtCw.filter((e) => !clamped.has(String(e.awb || '')));
      const fmt = (arr) => arr.map((e) => `AWB ${e.awb || '-'}(${e.farm || '-'}) GW ${fmtNum(e.GW)} > CW ${fmtNum(e.CW)}`).join(', ');
      if (auto.length) {
        add(sub, '입고 입력 형태', STATUS.REVIEW, `GW > CW ${fmt(auto)} — 값 오입력 의심(계산은 CW 사용 중), 인보이스 확인`,
          { link: link('입고관리 열기', `/warehouse?week=${encodeURIComponent(sub)}`) });
      }
      if (manual.length) {
        add(sub, '입고 입력 형태', STATUS.REVIEW, `GW > CW ${fmt(manual)} — CW 가 GW 보다 작을 수 없음(CBM·단위 오입력 의심), 인보이스 확인`,
          { link: link('입고관리 열기', `/warehouse?week=${encodeURIComponent(sub)}`) });
      }
    }
    const gwCount = new Map();
    for (const e of whs) if (e.GW > 1) {
      const k = Math.round(e.GW * 100) / 100;
      const set = gwCount.get(k) || new Set();
      set.add(e.awb || `WH${e.farm}`);
      gwCount.set(k, set);
    }
    const repeated = [...gwCount.entries()].filter(([, set]) => set.size >= 2);
    if (repeated.length) {
      add(sub, '입고 입력 형태', STATUS.REVIEW,
        `같은 GW 값이 여러 AWB에 반복: ${repeated.map(([gw, set]) => `${fmtNum(gw)}kg × ${set.size}건(${[...set].slice(0, 4).join(', ')})`).join(' · ')} — 고정값 복사 입력 의심, 인보이스 GW 확인`,
        { link: link('입고관리 열기', `/warehouse?week=${encodeURIComponent(sub)}`) });
    }

    // 4) 혼적 AWB 구성 (콜롬비아 수국 + 다른 꽃)
    const awbFlowers = new Map();
    for (const r of flowerRows) {
      if (baseCountry(r.CounName) !== '콜롬비아' || !r.AWB) continue;
      const s = awbFlowers.get(r.AWB) || new Set();
      s.add(r.FlowerName || r.ProdName);
      awbFlowers.set(r.AWB, s);
    }
    for (const [awb, set] of awbFlowers) {
      const flowers = [...set];
      const hasHyd = flowers.some((f) => /수국|hydrangea/i.test(f));
      if (!hasHyd || flowers.length < 2) continue;
      const unknown = flowers.filter((f) => !KNOWN_COLOMBIA_FLOWERS.test(f));
      if (unknown.length) {
        add(sub, '혼적 AWB 구성', STATUS.REVIEW,
          `AWB ${awb}: ${flowers.join('·')} — 새 구성(${unknown.join('·')})은 5품목 배분표에 없는 꽃, 박스당 무게·배분 기준 확인 필요`,
          { link: link(`그외통관비 입력 열기 (${sub})`, customsHref(sub)) });
      } else {
        add(sub, '혼적 AWB 구성', STATUS.AUTO, `AWB ${awb}: ${flowers.join('·')} — 콜카장수국 혼적, AWB 전체 GW/CW 를 수국 포함 5품목 한 풀로 배분`);
      }
    }

    // 5) 원가자료(도착원가 환율) 업로드 — 직전 6개 차수에 원가자료가 있던 국가가 이번 반차수에 입고됐는데 없으면 입력 필요
    const arrivalHere = (sources.arrival || []).filter((a) => subOf(a.OrderWeek) === sub);
    const expected = new Set((sources.arrivalPrevCountries || []).map((c) => baseCountry(c) || c));
    for (const country of countriesIn) {
      const lines = arrivalHere.filter((a) => (baseCountry(a.CountryName) || a.CountryName) === country);
      if (lines.length) {
        const fxMissing = lines.reduce((s, a) => s + (n0(a.n) - n0(a.fxRows)), 0);
        const fx = [...new Set(lines.flatMap((a) => [a.fxMin, a.fxMax]).filter((v) => n0(v) > 0).map((v) => fmtNum(v)))].join('~');
        if (fxMissing > 0) add(sub, '환율(원가자료)', STATUS.INPUT, `${country} 원가자료 ${fxMissing}행 환율 없음`, { link: link('원가자료 열기', '/arrival-cost') });
        else add(sub, '환율(원가자료)', STATUS.AUTO, `${country} 원가자료 환율 ${fx} 적용`);
      } else if (expected.has(country)) {
        add(sub, '환율(원가자료)', STATUS.INPUT, `${country} 입고는 있는데 이 반차수 원가자료 업로드 없음(도착원가 환율 미확정)`, { link: link('원가자료 업로드 열기', '/arrival-cost') });
      }
    }
  }

  // 6) 과세환율 R (대차수 단위) — 보고서 행 원천
  const exactRates = [];
  for (const r of report.rows || []) {
    const q = n0(r.auto?.Q ?? r.calc?.Q);
    if (!(q > 0)) continue;
    const src = r.source?.R || 'missing';
    const rate = r.calc?.R ?? r.auto?.R;
    if (EXACT_RATE_SOURCES.has(src)) exactRates.push(`${r.category} ${fmtNum(rate)}${src === 'kcs_api' ? '' : `(${src})`}`);
    else if (!(n0(rate) > 0) || src === 'missing') add('대차수', '과세환율(R)', STATUS.INPUT, `${r.category} 구매 ${fmtNum(q)} 있는데 과세환율 없음`, { link: link('보고서 R 입력칸', null), action: 'rate', focus: r.category });
    else add('대차수', '과세환율(R)', STATUS.REVIEW, `${r.category} R ${fmtNum(rate)} — ${src === 'carried_taxable_rate' ? '전차수 이월값' : src === 'approximate_currency_master' ? '통화마스터 근사값' : src}, 관세청 고시값 확인`, { action: 'rate', focus: r.category });
  }

  if (exactRates.length) add('대차수', '과세환율(R)', STATUS.AUTO, `구매 있는 ${exactRates.length}개 카테고리 과세환율 자동(관세청 고시·입고 스냅샷): ${exactRates.join(', ')}`);

  // 7) 보고서 경고(PR #815 상세) — 항공료 전표 누락·국가 그외통관비·재고 단가 등, 위에서 다루지 않은 것
  for (const issue of report.audit?.issues || []) {
    if (issue.code === 'CUSTOMS_INCOMPLETE' && /콜롬비아 4품목/.test(issue.category || '')) continue; // 반차수 행으로 이미 표시
    if (issue.code === 'TAXABLE_RATE_MISSING' || issue.code === 'RATE_APPROXIMATED') continue; // 6) 에서 표시
    const fix = issue.detail?.fix || null;
    const topic = /FORWARDING/.test(issue.code) ? '항공료 전표' : /CUSTOMS/.test(issue.code) ? '그외통관비(국가)' : /STOCK/.test(issue.code) ? '재고' : issue.code === 'UNCLASSIFIED_DATA' ? '미분류' : '보고서 경고';
    add('대차수', topic, issue.severity === 'error' ? STATUS.INPUT : STATUS.REVIEW,
      `${issue.category ? `${issue.category}: ` : ''}${issue.detail?.summary || issue.message}`,
      { link: fix?.href ? link(fix.label, fix.href) : null, action: fix?.href ? null : fix?.action || null, focus: fix?.focus || null, code: issue.code });
  }

  // 8) 최근 4주 매입 없는 출고 품목(원가가 과거 단가/재고단가로 평가됨)
  const noPurchase = (sources.shipped || []).filter((s) => s.ProdKey != null && !isFreightItem(s.ProdName)
    && baseCountry(s.CounName) && !sources.recentPurchasedProdKeys?.has(s.ProdKey));
  if (noPurchase.length) {
    const top = [...noPurchase].sort((a, b) => n0(b.Amount) - n0(a.Amount));
    add('대차수', '최근 4주 매입 없음', STATUS.REVIEW,
      `출고는 있는데 ${sources.recentMajors?.at(-1) || ''}~${wk}차 매입이 없는 수입 품목 ${noPurchase.length}건: ${top.slice(0, 8).map((s) => `${s.ProdName}(${fmtNum(s.OutQty)})`).join(', ')}${noPurchase.length > 8 ? ' 외' : ''} — 재고 이월분 판매, 기말재고 단가는 최근 매입·재고단가로 평가`,
      { items: top.slice(0, 40).map((s) => ({ prodKey: s.ProdKey, name: s.ProdName, outQty: n0(s.OutQty), amount: n0(s.Amount) })) });
  }

  // 사장님(2026-09-30): "오류가 없으면 표시할 게 없는 거고 오류만 표시되게". 전산 자동(정상 경로)·정상 행은 내보내지 않는다.
  const problems = rows.filter((r) => r.status === STATUS.INPUT || r.status === STATUS.REVIEW);
  rows.length = 0;
  rows.push(...problems);
  const order = { input: 0, review: 1, auto: 2, ok: 3 };
  rows.sort((a, b) => (a.subWeek === '대차수') - (b.subWeek === '대차수') || String(a.subWeek).localeCompare(String(b.subWeek)) || order[a.status] - order[b.status]);
  const summary = rows.reduce((s, r) => ({ ...s, [r.status]: (s[r.status] || 0) + 1 }), { input: 0, review: 0 });
  return { orderYear: String(orderYear), major: wk, rows, summary };
}
