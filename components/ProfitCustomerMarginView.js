import { Fragment, useState } from 'react';
import {
  displayNumber as num, displayPercent as pct, displayPoints as pp, differencePoints,
  coverageText, filterMarginGroups, warningText, navigateMarginRows, closeMarginDetails, salesPhysicalAverageCost, attachGroupCostBasis, marginGroupLabel, reconciliationReason,
} from '../lib/profitCustomerMarginPresentation.mjs';

const period = p => p ? `${p.year}년 ${Number(p.major)}차` : '비교 차수 없음';
const asOf = value => value || '조회시점 미확인';
const rowName = g => marginGroupLabel(g).title;
const averageCost = salesPhysicalAverageCost;

function Warnings({ items = [] }) {
  if (!items.length) return null;
  return <ul className="pcm-warnings">{items.map((w, i) => <li key={i}>{warningText(w)}</li>)}</ul>;
}
function Cols({ widths }) { return <colgroup>{widths.map((w, i) => <col key={i} style={{ width: w }} />)}</colgroup>; }
function ScrollTable({ children, label }) { return <div className="pcm-table-wrap" role="region" aria-label={label} tabIndex={0}>{children}</div>; }

export function ReconciliationDetails({ data }) {
  const evidence=data.metadata?.reconciliationDetails;
  if(!evidence) return null;
  const labels={N:'N 출고매출',L:'L 불량차감',O:'O 운임·기타'};
  const needsAttention=evidence.summaries.some(s=>s.status!=='match');
  return <section aria-labelledby="pcm-reconciliation-title">
    <h2 id="pcm-reconciliation-title">저장본·SQL 대사 근거</h2>
    <details open={needsAttention} onKeyDown={closeMarginDetails}><summary>{evidence.summaries.map(s=>`${period(s.scope)} ${s.status==='match'?'일치':s.status==='different'?'차이 있음':'근거 부족'}`).join(' · ')} — 금액·조회범위 확인</summary>
    <p>저장 당시 보고서와 지금 SQL을 비교합니다. 차이는 원가 미확정과 별개입니다. 기존 수익률·확정본·계산 저장본은 변경하지 않습니다.</p>
    <p>현재 SQL 조회 시작: {asOf(evidence.asOf)} · 여러 SELECT의 순차·병렬 읽기이며 한 시점으로 잠근 스냅샷은 아닙니다.</p>
    {(evidence.summaries||[]).map(summary=>{
      const differences=evidence.entries.filter(r=>r.side===summary.side&&r.status!=='match');
      return <article key={summary.side} className="pcm-driver">
        <h3>{period(summary.scope)} · {summary.status==='match'?'N/L/O 일치':summary.status==='different'?'금액 차이 있음':'비교 근거 부족'}</h3>
        <p>{summary.source==='confirmed'?'확정본':summary.source==='stored'?'계산 저장본':'저장본 없음'} 기준: {asOf(summary.storedAt)}
          {summary.provenance?.versionNo!=null?` · 저장 버전 ${summary.provenance.versionNo}`:''}
          {summary.provenance?.revisionNo!=null?` · 확정 개정 ${summary.provenance.revisionNo}`:''}</p>
        <ScrollTable label={`${period(summary.scope)} N/L/O 전체금액 대사`}><table style={{minWidth:680}}>
          <caption>기존 보고서와 같은 합계 범위 · 차이 = 현재 SQL − 저장본 (원)</caption>
          <Cols widths={[140,130,130,130,180]} />
          <thead><tr><th scope="col">항목</th><th scope="col">현재 SQL</th><th scope="col">저장본</th><th scope="col">차이</th><th scope="col">다른 분류 / 미확인 분류</th></tr></thead>
          <tbody>{summary.totals.map(r=><tr key={r.column}><th scope="row">{labels[r.column]}</th><td>{num(r.sqlValue)}</td><td>{num(r.reported)}</td><td>{num(r.delta,2)}</td><td>{r.differingCategories} / {r.incompleteCategories}</td></tr>)}</tbody>
        </table></ScrollTable>
        {summary.totals.some(r=>r.excludedSqlValue!==0)&&<p>본표 합계에서 제외되는 기타(미분류)·공제·국내는 분류별 대사에는 남깁니다: {summary.totals.map(r=>`${r.column} ${num(r.excludedSqlValue)}원`).join(' · ')}. 이 금액을 본표 합계 오류로 판정하지 않습니다.</p>}
        {summary.interpretation==='CATEGORY_REDISTRIBUTION_CANDIDATE'&&<p>전체 합계는 같지만 국가·품종별 배분이 다릅니다. 분류 이동 가능성이 있으며, 과거 변경 이력까지 확인된 것은 아닙니다.</p>}
        {differences.length>0&&<ScrollTable label={`${period(summary.scope)} 분류별 대사 차이`}><table style={{minWidth:1000}}>
          <caption>차이 또는 근거가 부족한 항목만 표시</caption><Cols widths={[200,120,120,120,130,310]} /><thead><tr><th scope="col">국가·품종 / 항목</th><th scope="col">저장본</th><th scope="col">현재 SQL</th><th scope="col">차이</th><th scope="col">기본 분류 SQL</th><th scope="col">확인된 근거</th></tr></thead>
          <tbody>{differences.map(r=><tr key={`${r.category}:${r.column}`}><th scope="row">{r.category} · {labels[r.column]}</th><td>{num(r.reported)}</td><td>{num(r.sqlValue)}</td><td>{num(r.delta,2)}</td><td>{num(r.baseSqlValue)}</td><td>{reconciliationReason(r.reason)}</td></tr>)}</tbody>
        </table></ScrollTable>}
        <details><summary>SQL 조회 범위·분류 적용 근거</summary>
          <p>선택 연도 + 세부차수 접두어 + 원본 OrderYearWeek가 모두 일치하는 활성·확정 마스터가 대상입니다. 출고는 상세 확정·실출고수량 0 제외, 무게행 제외이며 견적 차감·기타는 별도로 합산합니다.</p>
          <p>대상 연도·차수의 제외 후보: 원본 연도차수 불일치 {num(summary.scopeCoverage?.yearWeekMismatchRows)}행, 미확정 {num(summary.scopeCoverage?.unconfirmedRows)}행, 실출고수량 0 {num(summary.scopeCoverage?.zeroPhysicalRows)}행 / {num(summary.scopeCoverage?.zeroPhysicalAmount)}원. 사유는 서로 중복될 수 있습니다.</p>
          <ul>{summary.observedScopes.map((s,i)=><li key={i}>{s.year}년 {s.week||'세부차수 미확인'} · raw {s.rawYearWeek||'미확인'} · {s.table||'원천 미확인'} {s.rowCount}행</li>)}</ul>
          {summary.classificationEffects.length===0?<p>현재 SQL 대상 중 기본 분류와 수동 분류가 달라지는 행은 없습니다.</p>:<ul>{summary.classificationEffects.map((e,i)=><li key={i}>{e.baseCategory} → {e.category} · {labels[e.column]} {num(e.amount)}원 · {e.productCount}품목 (ProdKey 예시 {e.sampleProdKeys.join(', ')}{e.omittedProductCount?` 외 ${e.omittedProductCount}개`:''})</li>)}</ul>}
          <p>분류 규칙 {evidence.classification?.entryCount??'미확인'}건 · 지문 {evidence.classification?.fingerprint||'미확인'}. 지문만으로 저장 당시의 규칙을 추정하지 않습니다.</p>
        </details>
      </article>;
    })}
    <p>{evidence.note}</p>
    </details>
  </section>;
}

export function CostCoverageSummary({ coverage, current, previous }) {
  const periods = [['previous', '비교', previous], ['current', '조회', current]];
  return <section className="pcm-coverage" aria-labelledby="pcm-cost-coverage-title">
    <h2 id="pcm-cost-coverage-title">원가 확인범위 (승인 추정 포함)</h2>
    <p><b>일부 품목의 높은 판매마진을 전체 확정 영업마진으로 해석하지 마세요.</b> 원가가 일부만 확인되면 전체 판매마진은 미확정입니다.</p>
    <ScrollTable label="두 차수 원가 확인범위"><table><caption>전체 조회 범위 · 검색·품종 펼치기와 무관</caption><Cols widths={[170, 115, 115, 240, 120]} />
      <thead><tr>{['차수', '원가 확인 품목', '원가 미확정 품목', '원가 확인 매출 / 대상 매출(원)', '매출액 기준 확인률'].map(h => <th scope="col" key={h}>{h}</th>)}</tr></thead>
      <tbody>{periods.map(([key, label, scope]) => { const c = coverage?.[key]; return <tr key={key}><th scope="row">{label} · {period(scope)}</th><td>{num(c?.knownProducts)}</td><td>{num(c?.unknownProducts)}</td><td>{num(c?.knownSales)} / {num(c?.totalSales)}</td><td><b>{pct(c?.salesCoverage)}</b></td></tr>; })}</tbody>
    </table></ScrollTable>
    <p className="pcm-note">확인률은 양수 판매 대상의 매출액 기준이며 순판매액·영업이익 확정률이 아닙니다. 승인 추정 비용이 포함될 수 있으며 실제 청구 확정과 다릅니다. 자료가 없으면 0%가 아닌 미확정으로 표시합니다.</p>
    <details onKeyDown={closeMarginDetails}><summary>원가 미확정 사유별 품목·매출 보기</summary>
      <p>같은 품목에 사유가 여러 개일 수 있습니다. 사유별 품목 수와 매출은 중복될 수 있으므로 합산하지 마세요.</p>
      {periods.map(([key, label, scope]) => { const reasons = coverage?.[key]?.reasons; return <div key={key}><h3>{label} · {period(scope)}</h3>{Array.isArray(reasons) && reasons.length > 0 ? <ScrollTable label={`${label}차수 원가 미확정 사유`}><table><caption>사유별 중복 집계 · 합산 금지</caption><Cols widths={[420, 100, 160]} /><thead><tr><th scope="col">사유</th><th scope="col">품목 수</th><th scope="col">관련 매출(원)</th></tr></thead><tbody>{reasons.map((r, i) => <tr key={i}><th scope="row">{warningText(r.reason)}</th><td>{num(r.productCount)}</td><td>{num(r.sales)}</td></tr>)}</tbody></table></ScrollTable> : <p className="pcm-note">표시할 사유 자료가 없습니다. 원가 검증 완료를 뜻하지 않습니다.</p>}</div>; })}
    </details>
  </section>;
}

export function MarginDrivers({ drivers, current, previous }) {
  if (!drivers) return <p>차이 원인 분석 근거가 없습니다.</p>;
  return <section className="pcm-drivers">
    <h4>수익 차이 원인 · 비교차수 → 조회차수</h4>
    <p>전체 판매이익 차이 <b>{num(drivers.profitDelta)}원</b> · 전체 판매마진율 차이 <b>{pp(differencePoints(current?.marginPct, previous?.marginPct))}</b></p>
    <p className="pcm-note">아래 기여도는 두 차수 공통 품목·업체 범위입니다. 공통 {num(drivers.coverage?.commonPairs)}쌍 중 원가 확인 {num(drivers.coverage?.pricedCommonPairs)}쌍. 전체 차이를 설명한다고 단정하지 않습니다.</p>
    <p className="pcm-note">원가 확인 공통대상 안에서의 판매이익 차이 {num(drivers.commonCohort?.profitDelta)}원 · 해당 공통대상의 마진율 차이 {pp(drivers.commonCohort?.marginDeltaPp)}. 전체 판매마진과 구분합니다.</p>
    <ScrollTable label="차이 원인 기여도"><table><caption>원가 확인 공통대상의 판매이익 기여 · 전체 범위가 일치할 때만 %p 표시</caption><Cols widths={[270, 150, 130]} />
      <thead><tr><th scope="col">원인</th><th scope="col">판매이익 영향(원)</th><th scope="col">마진율 영향</th></tr></thead>
      <tbody>{(drivers.contributions ?? []).map((c, i) => <tr key={`${c.key}-${i}`}><th scope="row">{c.label}</th><td>{num(c.amount)}</td><td>{pp(c.percentagePoints)}</td></tr>)}
        <tr><th scope="row">남은 차이 · 신규·이탈·차감·반품·청구/실물 수량차이 포함</th><td>{num(drivers.residual)}</td><td>별도 확인</td></tr></tbody>
    </table></ScrollTable>
    {(drivers.revenueDrivers?.length > 0) && <>
      <h4>판매 구성·단가 영향 · 원가 없이 확인 가능한 매출 변화</h4>
      <p>공통 품목·업체 매출 차이 {num(drivers.commonCohort?.revenueDelta)}원. 판매이익 영향이 아닌 매출 영향입니다.</p>
      <ScrollTable label="공통 품목 업체 매출 변화"><table><caption>공통 판매대상의 매출 변화 · 원가 효과와 별도</caption><Cols widths={[270, 150]} /><thead><tr><th scope="col">원인</th><th scope="col">매출 영향(원)</th></tr></thead>
        <tbody>{drivers.revenueDrivers.map((d, i) => <tr key={`${d.key}-${i}`}><th scope="row">{d.label}</th><td>{num(d.amount)}</td></tr>)}</tbody></table></ScrollTable>
    </>}
    {drivers.remainder && <p>신규 대상 이익 {num(drivers.remainder.newPairsProfit)}원 · 이탈 대상 이익 {num(drivers.remainder.exitedPairsProfit)}원 · 차감·반품·청구/실물 수량차이·기타 {num(drivers.remainder.deductionsReturnsAndOther)}원</p>}
    <p>평균판매가는 청구수량 기준, 판매원가는 실물 출고를 같은 기준단위로 환산한 소모량 기준입니다. 청구 반올림이나 수량 차이는 위 남은 차이에 포함될 수 있으며 자동 보정하지 않습니다.</p>
    <p>환율·운임이 원가 영향에 포함된 경우 다시 더하지 않습니다. 신규·이탈 및 비교 불가 범위는 0으로 간주하지 않습니다.</p>
    <Warnings items={drivers.warnings} />
  </section>;
}

export function ProductCostDetails({ product }) {
  const basis = product.costBasis ?? {};
  const fields = [
    ['openingQuantity', '기초수량'], ['openingAmount', '기초원가액'], ['receiptQuantity', '입고수량'],
    ['receiptAmount', '입고 도착원가'], ['unitCost', '이월 포함 평균 도착원가'],
  ];
  return <div className="pcm-cost">
    <b>{product.productName} · ProdKey {product.prodKey} · {product.unit || '단위 미확정'}</b>
    <p>같은 품목·같은 단위의 (기초원가액 + 당차수 도착원가) ÷ (기초수량 + 입고수량). 업체별 판매단가로 원가를 대신하지 않습니다.</p>
    <dl>{fields.map(([key, label]) => <Fragment key={key}><dt>{label}</dt><dd>{num(basis[key], 3)}</dd></Fragment>)}
      <dt>근거 상태</dt><dd>{{ MISSING: '미확정', ESTIMATED: '승인 추정 비용 포함 · 실제 청구 확정 아님', VERIFIED: '계산 근거 확인' }[basis.status] ?? basis.status ?? '미확정'}</dd><dt>원가 출처</dt><dd>{basis.source === 'PRODUCT_PERIOD_WEIGHTED_AVERAGE' ? '품목별 이월 포함 차수 가중평균 도착원가' : typeof basis.source === 'string' ? basis.source : '상세 원천 확인 필요'}</dd></dl>
    <p>실물 출고 소모량 {num(product.current?.physicalQuantity, 3)} {product.unit || ''} · 청구수량 {num(product.current?.quantity, 3)} {product.unit || ''}</p>
    {basis.reason && <p>{warningText(basis.reason)}</p>}
    <Warnings items={basis.reasons ?? basis.warnings} />
    <Warnings items={product.current?.warnings} />
    <p>{coverageText(product.current)}</p>
    {product.previousCostBasis && <details onKeyDown={closeMarginDetails}><summary>비교차수 원가 근거</summary><dl>{fields.map(([key, label]) => <Fragment key={key}><dt>{label}</dt><dd>{num(product.previousCostBasis[key], 3)}</dd></Fragment>)}</dl><Warnings items={product.previousCostBasis.reasons ?? product.previousCostBasis.warnings} /></details>}
    <details onKeyDown={closeMarginDetails}><summary>원천 식별값 · 상태 원문 보기</summary><dl>
      <dt>상태 원문</dt><dd>{basis.status ?? '없음'}</dd><dt>원천 구분 원문</dt><dd>{basis.source ?? '없음'}</dd>
      <dt>수량 대사</dt><dd>{basis.balanced === true ? '산식 일치' : basis.balanced === false ? '산식 불일치' : '미확인'}</dd>
      <dt>승인 추정 포함</dt><dd>{basis.estimated === true ? '포함 · 실제 청구 확정과 다름' : basis.estimated === false ? '미포함' : '미확인'}</dd>
    </dl><ul>{(basis.sourceRefs ?? []).map((ref, i) => <li key={i}>{typeof ref === 'string' ? ref : warningText(ref)}</li>)}</ul></details>
  </div>;
}

export function MarginProducts({ products = [] }) {
  if (!products.length) return <p>품목별 비교 근거가 없습니다.</p>;
  return <ScrollTable label="품목별 판매 및 원가"><table><caption>품목별 확인 · 기준 단위를 섞지 않습니다</caption><Cols widths={[280, 65, 100, 100, 115, 115, 115, 115, 100]} />
    <thead><tr>{['품목 / 원가 근거', '단위', '조회 청구수량', '조회 실물소모량', '비교 평균판매가', '조회 평균판매가', '조회 실물소모 평균원가', '조회 판매이익', '판매마진율'].map(h => <th scope="col" key={h}>{h}</th>)}</tr></thead>
    <tbody>{products.map((p, i) => <tr key={`${p.prodKey}-${p.unit}-${i}`}>
      <th scope="row"><details onKeyDown={closeMarginDetails}><summary data-margin-row onKeyDown={navigateMarginRows}>{p.productName} <small>#{p.prodKey}</small></summary><ProductCostDetails product={p} /></details></th>
      <td>{p.unit || '미확정'}</td><td>{num(p.current?.quantity, 3)}</td><td>{num(p.current?.physicalQuantity, 3)}</td><td>{num(p.previous?.avgNetPrice, 2)}</td><td>{num(p.current?.avgNetPrice, 2)}</td><td>{num(averageCost(p.current), 2)}</td><td>{num(p.current?.marginAmount)}</td><td>{pct(p.current?.marginPct)}</td>
    </tr>)}</tbody>
  </table></ScrollTable>;
}

export function MarginGroupDetails({ group }) {
  const [openCustomer, setOpenCustomer] = useState(null);
  return <section className="pcm-detail">
    <h3>{rowName(group)} · {group.unit || '단위 미확정'} 업체별 판매비중</h3>
    {marginGroupLabel(group).sourceLabel && <p className="pcm-note">{marginGroupLabel(group).sourceLabel}</p>}
    <p>수량비중은 같은 품종·단위의 양수 판매수량 기준입니다. 반품·음수·수량 0 금액 조정은 순판매액에 남으며, 재고조정을 업체별 원가에 임의 배부하지 않습니다.</p>
    <p>{coverageText(group.current)}. 원가가 일부만 확인되면 전체 판매마진은 미확정입니다.</p>
    <Warnings items={group.current?.warnings} /><Warnings items={group.previous?.warnings} />
    <ScrollTable label={`${rowName(group)} 업체별 판매비중`}><table><caption>업체별 비교 · 단위 {group.unit || '미확정'} · 금액 원</caption><Cols widths={[210, 90, 90, 90, 90, 110, 110, 115, 115, 100, 120]} />
      <thead><tr>{['업체 / 품목 펼치기', '청구수량', '수량비중', '비중 증감', '매출비중', '평균판매가 VAT제외', '분배단가 VAT포함', '순판매액 VAT제외', '판매원가', '판매마진율', '원가 확인범위'].map(h => <th scope="col" key={h}>{h}</th>)}</tr></thead>
      <tbody>{(group.customers ?? []).map((c, i) => {
        const open = openCustomer === c.custKey; const id = `pcm-customer-${encodeURIComponent(group.key)}-${c.custKey}-${i}`;
        return <Fragment key={`${c.custKey}-${i}`}><tr>
          <th scope="row"><button type="button" data-margin-row aria-expanded={open} aria-controls={id} onKeyDown={navigateMarginRows} onClick={() => setOpenCustomer(open ? null : c.custKey)}>{open ? '▾' : '▸'} {c.custName}</button><small>비교 비중 {pct(c.previous?.quantityShare)}</small></th>
          <td>{num(c.current?.quantity, 3)}</td><td>{pct(c.current?.quantityShare)}</td><td>{pp(differencePoints(c.current?.quantityShare, c.previous?.quantityShare))}</td><td>{pct(c.current?.revenueShare)}</td><td>{num(c.current?.avgNetPrice, 2)}</td><td>{num(c.current?.avgGrossPrice, 2)}</td><td>{num(c.current?.netSales)}</td><td>{num(c.current?.costAmount)}</td><td>{pct(c.current?.marginPct)}</td><td className="pcm-note">{coverageText(c.current)}</td>
        </tr><tr hidden={!open} id={id}><td colSpan={11} onKeyDown={e => {
          if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpenCustomer(null); e.currentTarget.closest('tr')?.previousElementSibling?.querySelector('button')?.focus(); }
        }}>{open && <><Warnings items={c.current?.warnings} /><MarginProducts products={attachGroupCostBasis(c.products, group.products)} /></>}</td></tr></Fragment>;
      })}</tbody>
    </table></ScrollTable>
    <MarginDrivers drivers={group.drivers} current={group.current} previous={group.previous} />
    <details onKeyDown={closeMarginDetails}><summary>품목별 원가 근거 전체 ({group.products?.length ?? 0}개)</summary><MarginProducts products={group.products} /></details>
    <p className="pcm-note">업체 전체 평균 차이에는 판매 품목 구성이 섞입니다. 업체를 펼쳐 동일 품목·단위를 확인한 뒤 저가 판매 영향을 판단하세요.</p>
  </section>;
}

export function ReportedMarginTable({ rows = [], current, previous }) {
  return <section className="pcm-reported"><h2>기존 보고서 수익률 · 별도 지표</h2>
    <p>기존 보고서는 재고평가·손익조정을 포함합니다. 일반 품종행은 매출이익 ÷ 매출액, 기존 noEnding 유형과 전체 합계는 매출이익 ÷ (매출액 + 기말재고액)입니다. 기존 보고서의 저장된 이익률을 그대로 표시하며, 새 판매마진율과 분모·원가 범위가 다르므로 같은 숫자로 맞추지 않습니다.</p>
    <ScrollTable label="기존 보고서 수익률 비교"><table><caption>{period(previous)} → {period(current)} · 기존 분류별 1행, 단위별 복제 합산 없음</caption><Cols widths={[190, 95, 95, 100, 110, 110, 110, 110, 110, 140]} />
      <thead><tr>{['기존 보고서 분류', '비교 이익률', '조회 이익률', '차이', '조회 매출액', '조회 기초재고액', '조회 기말재고액', '조회 매출이익', '조회 손익조정', '자료 기준'].map(h => <th scope="col" key={h}>{h}</th>)}</tr></thead>
      <tbody>{rows.map((r, i) => <Fragment key={`${r.category}-${i}`}><tr><th scope="row">{r.isTotal ? '전체 합계' : r.category}</th><td>{pct(r.previous?.K)}</td><td>{pct(r.current?.K)}</td><td>{pp(differencePoints(r.current?.K, r.previous?.K))}</td><td>{num(r.current?.C)}</td><td>{num(r.current?.E)}</td><td>{num(r.current?.F)}</td><td>{num(r.current?.J)}</td><td>{num(r.current?.AJ)}</td><td className="pcm-note">조회: {r.current?.source || '미확인'} · {asOf(r.current?.asOf)}<br />비교: {r.previous?.source || '미확인'} · {asOf(r.previous?.asOf)}</td></tr>
        {(r.drivers?.length > 0 || r.adjustments?.length > 0 || r.bridge) && <tr><td colSpan={10}><details onKeyDown={closeMarginDetails}><summary>{r.isTotal ? '전체 합계' : r.category} 수익률 차이 근거 · 재고조정 {r.adjustments?.length ?? 0}건</summary>
          {(r.drivers?.length > 0) && <ScrollTable label={`${r.category} 기존 수익률 변화 기여`}><table><caption>기존 보고서 금액·분모 변화 기여</caption><Cols widths={[260, 140, 130]} /><thead><tr><th scope="col">원인</th><th scope="col">금액 영향(원)</th><th scope="col">수익률 영향</th></tr></thead><tbody>{r.drivers.map((d, j) => <tr key={`${d.key}-${j}`}><th scope="row">{d.label}</th><td>{num(d.amount)}</td><td>{pp(d.percentagePoints)}</td></tr>)}</tbody></table></ScrollTable>}
          {r.bridge && <div className="pcm-bridge"><p>기존 매출이익 차이 {num(r.bridge.profitDelta)}원 · 미설명 금액 {num(r.bridge.residual)}원</p><p>기존 수익률 차이 {pp(r.bridge.marginDeltaPp)} · 미설명 수익률 차이 {pp(r.bridge.rateResidual)}</p><p className="pcm-note">기존 수익률 분모: 비교 {num(r.bridge.denominator?.previous)}원 → 조회 {num(r.bridge.denominator?.current)}원. 이 검산은 저장 보고서 항목 간 산술 대사이며 원천자료 전체 확인 완료를 뜻하지 않습니다.</p><Warnings items={r.bridge.warnings} /></div>}
          {(r.adjustments?.length > 0) && <><p className="pcm-note">재고조정 수량은 SQL 이력 근거입니다. 아래 수량에 임의 단가를 곱해 손익 영향으로 단정하지 않습니다.</p><ScrollTable label={`${r.category} 재고조정 이력`}><table><caption>실제 재고조정 수량 · 금액 기여와 구분</caption><Cols widths={[100, 80, 100, 70, 280, 180]} /><thead><tr>{['연도', '차수', '조정수량', '단위', '사유', '기록시각'].map(h => <th scope="col" key={h}>{h}</th>)}</tr></thead><tbody>{r.adjustments.map((a, j) => <tr key={j}><td>{a.year}</td><td>{a.week}</td><td>{num(a.quantity, 3)}</td><td>{a.unit || '미확정'}</td><td className="pcm-note">{a.reason || '사유 미기록 · 목적 확인 필요'}</td><td className="pcm-note">{asOf(a.recordedAt)}</td></tr>)}</tbody></table></ScrollTable></>}
        </details></td></tr>}</Fragment>)}</tbody>
    </table></ScrollTable>
    {!rows.length && <p>기존 보고서가 없어 비교하지 못했습니다. 이 화면에서 저장본을 만들거나 새로 계산하지 않습니다.</p>}
  </section>;
}

export default function ProfitCustomerMarginView({ data }) {
  const [search, setSearch] = useState('');
  const [openGroup, setOpenGroup] = useState(null);
  const groups = data.groups ?? [];
  const visible = filterMarginGroups(groups, search);
  return <div className="pcm-view">
    <h2>{period(data.previous)} → {period(data.current)}</h2>
    <p className="pcm-note">현재 SQL 조회시점: {asOf(data.current?.asOf)} · 비교 SQL 조회시점: {asOf(data.previous?.asOf)}. 저장 보고서와 SQL의 기준시점이 다를 수 있습니다.</p>
    <CostCoverageSummary coverage={data.metadata?.costCoverage} current={data.current} previous={data.previous} />
    <Warnings items={data.warnings} />
    <ReconciliationDetails data={data} />
    <section className="pcm-intro"><b>판매마진 = (순판매액 − 실제 판매분 원가) ÷ 순판매액</b><p>원가는 같은 품목의 이월재고와 당차수 입고를 함께 고려한 가중평균 도착원가입니다. 판매가와 VAT는 원가에 섞지 않습니다. 물량·업체 구성과 재고평가·조정 영향을 나누어 확인합니다.</p></section>
    <section><h2>모든 품종 · 업체비중과 판매마진</h2>
      <label className="pcm-search">국가·품종·업체·품목 찾기 <input value={search} onChange={e => setSearch(e.target.value)} placeholder="예: 카네이션, 주광" /></label>
      <p role="status">표시 {visible.length} / 전체 {groups.length}개 품종·단위 그룹 · 검색해도 각 행의 비중·합계·원가 확인범위는 전체 기준을 유지합니다.</p>
      <p className="pcm-note">품종 버튼에서 ↑↓로 이동, Enter/Space로 펼치기, 상세에서 Escape로 접기. 표가 넓으면 가로로 이동하세요.</p>
      <ScrollTable label="전체 품종 요약"><table><caption>품종·단위별 요약 · 판매단가/원가는 VAT제외, 금액 원</caption><Cols widths={[210, 65, 90, 110, 110, 110, 110, 100, 100, 165]} />
        <thead><tr>{['국가·품종 / 업체 펼치기', '기준단위', '청구수량', '순판매액', '평균판매가', '실물소모 평균원가', '판매이익', '비교 판매마진율', '조회 판매마진율', '원가 확인범위'].map(h => <th scope="col" key={h}>{h}</th>)}</tr></thead>
        <tbody>{visible.map((g, i) => {
          const open = openGroup === g.key; const id = `pcm-group-${encodeURIComponent(g.key)}-${i}`;
          return <Fragment key={g.key}><tr><th scope="row"><button type="button" data-margin-row aria-expanded={open} aria-controls={id} onClick={() => setOpenGroup(open ? null : g.key)} onKeyDown={navigateMarginRows}>{open ? '▾' : '▸'} {rowName(g)}</button>{marginGroupLabel(g).sourceLabel && <small>{marginGroupLabel(g).sourceLabel}</small>}</th><td>{g.unit || '미확정'}</td><td>{num(g.current?.quantity, 3)}</td><td>{num(g.current?.netSales)}</td><td>{num(g.current?.avgNetPrice, 2)}</td><td>{num(averageCost(g.current), 2)}</td><td>{num(g.current?.marginAmount)}</td><td>{pct(g.previous?.marginPct)}</td><td>{pct(g.current?.marginPct)}</td><td className="pcm-note">{coverageText(g.current)}</td></tr>
            <tr hidden={!open} id={id}><td colSpan={10} onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); setOpenGroup(null); e.currentTarget.closest('tr')?.previousElementSibling?.querySelector('button')?.focus(); } }}>{open && <MarginGroupDetails group={g} />}</td></tr></Fragment>;
        })}</tbody>
      </table></ScrollTable>
      {!visible.length && <p>{groups.length ? '검색 결과가 없습니다. 검색어를 지우면 전체 품종이 표시됩니다.' : '해당 범위의 판매 자료가 없습니다. 조회 실패나 원가 미확정을 0원 매출로 해석하지 마세요.'}</p>}
    </section>
    <ReportedMarginTable rows={data.reported} current={data.current} previous={data.previous} />
    <style>{`
      .pcm-view { min-width: 0; color: #17324d; font-size: 14px; line-height: 1.55; }
      .pcm-view h2 { font-size: 19px; margin: 22px 0 10px; } .pcm-view h3 { font-size: 17px; margin: 4px 0 10px; } .pcm-view h4 { font-size: 15px; margin: 14px 0 8px; }
      .pcm-view p { margin: 8px 0; } .pcm-view small { display: block; font-size: 12px; font-weight: 400; color: #52657c; }
      .pcm-intro { background: #edf5ff; border-left: 4px solid #2865ab; padding: 12px 16px; margin: 16px 0; }
      .pcm-coverage { background: #fffbeb; border: 1px solid #e4c779; border-left: 4px solid #b88018; padding: 12px 16px; margin: 16px 0; } .pcm-coverage h2 { margin-top: 0; } .pcm-coverage table { background: #fff; }
      .pcm-table-wrap { max-width: 100%; overflow-x: auto; margin: 10px 0; }
      .pcm-view table { width: auto; table-layout: fixed; border-collapse: collapse; font-size: 14px; }
      .pcm-view caption { text-align: left; padding: 8px 0; font-weight: 600; }
      .pcm-view th, .pcm-view td { border: 1px solid #d3dfec; padding: 9px 10px; vertical-align: top; }
      .pcm-view thead th { background: #eaf1f8; text-align: center; font-weight: 600; }
      .pcm-view tbody th { text-align: left; font-weight: 500; } .pcm-view td { text-align: right; font-variant-numeric: tabular-nums; }
      .pcm-view tr:nth-child(4n+3) > th, .pcm-view tr:nth-child(4n+3) > td { background: #f8fafc; }
      .pcm-view .pcm-note { font-size: 12px; color: #52657c; text-align: left; overflow-wrap: anywhere; }
      .pcm-view button { padding: 3px 0; border: 0; color: #1d4e8c; background: transparent; text-align: left; font: inherit; cursor: pointer; overflow-wrap: anywhere; }
      .pcm-view button:focus-visible, .pcm-view summary:focus-visible, .pcm-view input:focus-visible, .pcm-table-wrap:focus-visible { outline: 3px solid #2563eb; outline-offset: 3px; }
      .pcm-view summary { cursor: pointer; padding: 6px 0; text-align: left; }
      .pcm-search { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; } .pcm-search input { width: 280px; max-width: 100%; border: 1px solid #94a3b8; padding: 8px; border-radius: 4px; }
      .pcm-detail { text-align: left; padding: 12px; background: #f4f8fc; min-width: 0; }
      .pcm-cost { font-weight: 400; text-align: left; min-width: 240px; } .pcm-cost dl { display: grid; grid-template-columns: minmax(100px, 1fr) minmax(90px, 1fr); gap: 6px; } .pcm-cost dt, .pcm-cost dd { margin: 0; overflow-wrap: anywhere; }
      .pcm-warnings { color: #854d0e; background: #fffbeb; border-left: 3px solid #d6a332; padding: 8px 10px 8px 30px; text-align: left; margin: 10px 0; overflow-wrap: anywhere; }
      .pcm-reported { border-top: 2px solid #b8cada; margin-top: 28px; }
    `}</style>
  </div>;
}
