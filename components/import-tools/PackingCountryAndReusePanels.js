import React from 'react';
import styles from '../../styles/ImportPacking.module.css';
import InvoiceReceiptComparison from './InvoiceReceiptComparison.js';
import { SUPPLEMENTAL_PACKING_ORIGINS, nzOriginComparisonDocument } from '../../lib/packingOriginEvidence.js';
import { invoiceBoxTotal } from '../../lib/invoiceAwbEvidence.js';
import { EMPTY_RECEIPT_ITEMS } from '../../lib/importPacking/packingToolSupport.js';

export function renderPackingCountryGrid({
  countryLabels,
  t,
  setScreen,
  readerVersion,
  resetResults,
  setOriginPreview,
  setNzReceiptSource,
  setChinaSheetReview,
  setCountry,
  setFile,
  setPdfBase64,
  setStatus,
  setInvoiceUploadDate,
  setAudMarketRate,
  setAudMarketRateError,
  setAwbFile,
  setAwbPdfBase64,
  setAwbSourceHash,
  setLocalAwbDocument,
  setAwbValues,
  setAwbManualFields,
  setAwbReviewed,
}) {
  return (
          <>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#526580', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>{t.selectCountry}</div>
            <div className={styles.countryGrid}>
              <button type="button" className={styles.reusePrimary} onClick={() => setScreen('hubfresh')}>중국hubfresh</button>
              {[...countryLabels, ...SUPPLEMENTAL_PACKING_ORIGINS].map((c) => (
                <button type="button" key={c.code} aria-label={c.name} onClick={() => {
                  ++readerVersion.current; resetResults(); setOriginPreview(null); setNzReceiptSource(null); setChinaSheetReview(null); setCountry(c.code); setScreen('upload'); setFile(null); setPdfBase64(null); setStatus(null);
                  setInvoiceUploadDate(''); setAudMarketRate(null); setAudMarketRateError('');
                  setAwbFile(null); setAwbPdfBase64(''); setAwbSourceHash(''); setLocalAwbDocument(null); setAwbValues(null); setAwbManualFields([]); setAwbReviewed(false);
                }}
                  style={{ border: '1px solid #dce4ef', borderRadius: 12, padding: '16px', textAlign: 'left', cursor: 'pointer', position: 'relative', background: '#fff', transition: 'all 0.15s' }}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#172b4d'; e.currentTarget.style.background = '#fafafa'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#dce4ef'; e.currentTarget.style.background = '#fff'; }}>
                  <span style={{ fontSize: 26, display: 'block', marginBottom: 7 }}>{c.flag}</span>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{c.name}</div>
                  <div style={{ fontSize: 13, color: '#526580', marginTop: 2 }}>{c.desc}</div>
                  {c.flag && <span style={{ position: 'absolute', top: 8, right: 8, fontSize: 13, padding: '2px 7px', borderRadius: 20, fontWeight: 500, background: '#e8f5ee', color: '#176039', border: '1px solid #b8e0c8' }}>{t.countryReady}</span>}
                </button>
              ))}
              {/* AWB tile — separate module, not a country */}
              <button type="button" aria-label={t.awbTitle} onClick={() => setScreen('awb')}
                style={{ border: '1px solid #c3d3fb', borderRadius: 12, padding: '16px', textAlign: 'left', cursor: 'pointer', position: 'relative', background: '#f0f4ff', transition: 'all 0.15s' }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#2457c5'; e.currentTarget.style.background = '#e6edff'; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#c3d3fb'; e.currentTarget.style.background = '#f0f4ff'; }}>
                <span style={{ fontSize: 26, display: 'block', marginBottom: 7 }}>✈️</span>
                <div style={{ fontSize: 13, fontWeight: 600 }}>AWB</div>
                <div style={{ fontSize: 13, color: '#526580', marginTop: 2 }}>{t.awbTile}</div>
                <span style={{ position: 'absolute', top: 8, right: 8, fontSize: 13, padding: '2px 7px', borderRadius: 20, fontWeight: 500, background: '#e6edff', color: '#2457c5', border: '1px solid #c3d3fb' }}>{t.awbBadge}</span>
              </button>
            </div>
          </>
  );
}

export function renderPackingSupplementalOrigin({
  country,
  t,
  readerVersion,
  setSelectingFile,
  setScreen,
  selectingFile,
  handleFile,
  status,
  originPreview,
  requestErpMatches,
  setNzReceiptSource,
  onContinue,
  setStatus,
}) {
  return (
          <section className={styles.reusePanel} aria-label="추가 원산지">
            <button type="button" onClick={() => { ++readerVersion.current; setSelectingFile(false); setScreen('country'); }}>{t.back}</button>
            <h2>{SUPPLEMENTAL_PACKING_ORIGINS.find(item => item.code === country).name}</h2>
            <p>{country === 'NZ' ? '원문을 대조한 뒤 입고 작업에서 농장·품목과 Units의 수량·가격 기준을 확인하세요. 패킹 엑셀과 이 화면에서의 원가 계산은 지원하지 않습니다.' : '국가는 선택할 수 있지만 이 메뉴에서 패킹 처리·ERP 입고·원가는 아직 지원하지 않습니다.'}</p>
            {country === 'NZ' && <>
              <label>뉴질랜드 인보이스 PDF <input type="file" accept=".pdf" disabled={selectingFile} onChange={e => { handleFile(e.target.files[0]); e.target.value = ''; }} /></label>
              {selectingFile && <p role="status">PDF 원문 확인 중…</p>}
              {status?.type === 'error' && <p role="alert">{status.msg}</p>}
              {originPreview && <div data-testid="packing-origin-preview" style={{overflowX:'auto'}}>
                <p>송장 {originPreview.invoice} · 공급처 {originPreview.supplier} · 원산지 뉴질랜드 · 통화 {originPreview.currency} · 총액 {originPreview.total}</p>
                <p>원본 총액 {originPreview.currency} {originPreview.total} · 저장 예정 총액 해당 없음 · 차이 계산 안 함</p>
                <InvoiceReceiptComparison file={originPreview.file} document={nzOriginComparisonDocument(originPreview)} sourceOnly />
                <button type="button" disabled={selectingFile} onClick={async()=>{
                  const version=readerVersion.current;
                  setSelectingFile(true);
                  try {
                    const data=await requestErpMatches();
                    if (readerVersion.current!==version) return;
                    setNzReceiptSource({country:'NZ',file:originPreview.file,invoices:[originPreview],
                      excels:EMPTY_RECEIPT_ITEMS,products:data.products,reviewConfirmed:true,truncated:false,packingActive:true});
                    onContinue?.();
                  } catch(error) {
                    if(readerVersion.current===version)setStatus({type:'error',msg:error.message});
                  } finally {
                    if(readerVersion.current===version)setSelectingFile(false);
                  }
                }}>원본 확인 · 입고 작업 열기</button>
              </div>}
            </>}
          </section>
  );
}

export function renderPackingSavedHistoryPanel({
  country,
  historyOpen,
  setHistoryOpen,
  showAnalyzedUploads,
  historySearch,
  setHistorySearch,
  historyRows,
  restoreAnalyzedUpload,
  selectingFile,
  historyError,
  processing,
  saving,
  restoringWork,
}) {
  return (
            <section className={styles.reusePanel} aria-label="저장 분석 불러오기">
              <div className={styles.reuseHeading}>
                <div><strong>이미 분석한 파일은 바로 이어서 작업</strong><p>파일을 다시 고르면 내용 해시로 확인합니다. 저장 분석 불러오기는 AI 호출 없이 최신 매칭을 적용합니다.</p></div>
                <button type="button" data-testid="packing-history-open" aria-expanded={historyOpen} disabled={processing||saving||restoringWork||selectingFile}
                  onClick={()=>historyOpen?setHistoryOpen(false):showAnalyzedUploads()}>{historyOpen?'목록 닫기':'기존 분석 불러오기'}</button>
              </div>
              {historyOpen&&<div>
                <label className={styles.reuseSearch}>보관된 파일명 검색<input aria-label="보관된 파일명 검색" value={historySearch} onChange={e=>setHistorySearch(e.target.value)}/></label>
                <div className={styles.reuseList}>
                  {historyRows.filter(r=>r.country===country&&r.fileName.toLocaleLowerCase().includes(historySearch.toLocaleLowerCase())).slice(0,30).map(row=><button type="button" key={row.id} data-testid="packing-history-resume" disabled={processing||saving||restoringWork||selectingFile} onClick={()=>restoreAnalyzedUpload(row)}>
                    <span>{row.fileName}</span><small>{row.matchingReviewed === true && '매칭 확인 · '}{Number.isFinite(Date.parse(row.at))?new Date(row.at).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'}):'저장 시각 미확인'}</small>
                  </button>)}
                </div>
                {!selectingFile&&!historyRows.some(r=>r.country===country&&r.fileName.toLocaleLowerCase().includes(historySearch.toLocaleLowerCase()))&&<p>선택한 국가에 해당하는 저장 분석이 없습니다.</p>}
              </div>}
              {selectingFile&&<p role="status">원본 해시·저장 분석 확인 중… 새 AI 분석은 실행하지 않습니다.</p>}
              {historyError&&<p role="alert">{historyError}</p>}
            </section>
  );
}

export function renderPackingFileChoicePanel({
  country,
  fileChoice,
  fileChoiceRef,
  cancelFileChoice,
  processing,
  saving,
  selectingFile,
  restoringWork,
  restoreAnalyzedUpload,
  acceptSelectedFile,
}) {
  if (!fileChoice) return null;
  return (
<section className={styles.reusePanel} aria-label="새 파일 분석 선택" data-testid="packing-file-choice" onKeyDown={e=>{if(e.key==='Escape'){e.preventDefault();cancelFileChoice();}}}>
              <h3 ref={fileChoiceRef} tabIndex={-1}>{fileChoice.previous?'내용이 변경된 파일입니다':'새 파일 분석을 선택하세요'}</h3>
              <p><strong>{fileChoice.file.name}</strong> · {(fileChoice.file.size/1024).toFixed(0)} KB</p>
              <p>{fileChoice.previous?'같은 이름의 이전 분석과 파일 내용이 다릅니다. 이전 분석을 사용하거나 선택한 새 파일만 분석할 수 있습니다.':'동일한 내용의 저장 분석을 찾지 못했습니다. 처음 올린 파일도 분석 버튼을 누르기 전에는 AI를 호출하지 않습니다.'}</p>
              <div className={styles.reuseActions}>
                {fileChoice.previous&&<button type="button" data-testid="packing-reuse-previous" disabled={processing||saving||selectingFile||restoringWork} onClick={()=>restoreAnalyzedUpload(fileChoice.previous)}>기존 분석으로 이어서 · 추가 비용 없음</button>}
                <button type="button" className={styles.reusePrimary} data-testid="packing-analyze-selected" disabled={processing||saving||selectingFile||restoringWork} onClick={()=>acceptSelectedFile(fileChoice.file,fileChoice.version)}>{country==='CN'&&/\.xlsx$/i.test(fileChoice.file.name)?'선택한 Excel 읽기 · API 호출 없음':'선택한 새 파일 분석 · API 비용 발생 가능'}</button>
                <button type="button" data-testid="packing-file-cancel" onClick={cancelFileChoice}>취소 · 기존 작업 유지</button>
              </div>
            </section>
  );
}

export function renderPackingAwbAttachmentDetails({
  awbFile,
  awbObjectUrl,
  lastExtraction,
  localAwbDocument,
  awbValues,
  setAwbValues,
  setAwbManualFields,
  awbReview,
  awbReviewed,
  setAwbReviewed,
}) {
  if (!awbFile) return null;
  return (
<div style={{ marginTop: 10, borderTop: '1px solid #dce4ef', paddingTop: 10 }}>
                <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', fontSize: 13 }}>
                  <strong>{awbFile.name}</strong><span style={{ color: '#526580' }}>{(awbFile.size / 1024).toFixed(0)} KB</span>
                  {awbObjectUrl && <a href={awbObjectUrl} target="_blank" rel="noreferrer" style={{ color: '#2457c5' }}>원본 AWB 열기</a>}
                  {lastExtraction?.result?.invoices?.length ? <span>인보이스 박스 합계: <strong>{invoiceBoxTotal(lastExtraction.result.invoices) ?? '확인 필요'}</strong></span> : <span style={{ color: '#526580' }}>인보이스 분석 후 박스 합계를 대조합니다.</span>}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: 8, marginTop: 10 }}>
                  {[
                    ['awb', 'AWB 번호', 'text', ''], ['packages', '포장 수(박스)', 'number', ''],
                    ['grossWeightKg', 'GW (kg)', 'number', 'gross_weight_kg'], ['chargeableWeightKg', 'CW (kg)', 'number', 'chargeable_weight_kg'],
                  ].map(([field, label, type, proofKey]) => {
                    const parsed = lastExtraction?.result?.awb_document || localAwbDocument || {};
                    const current = awbValues?.[field] ?? (field === 'grossWeightKg' ? parsed.gross_weight_kg : field === 'chargeableWeightKg' ? parsed.chargeable_weight_kg : parsed[field]) ?? '';
                    const proof = proofKey ? parsed.evidence?.[proofKey] : null;
                    return <label key={field} style={{ fontSize: 12, color: '#344054' }}>{label}
                      <input aria-label={label} type={type} min={type === 'number' ? '0' : undefined} step={type === 'number' ? 'any' : undefined} value={current}
                        onChange={event => {
                          setAwbValues(previous => ({ ...(previous || {}), [field]: event.target.value }));
                          setAwbManualFields(previous => previous.includes(field === 'grossWeightKg' ? 'gross_weight_kg' : field === 'chargeableWeightKg' ? 'chargeable_weight_kg' : field) ? previous : [...previous, field === 'grossWeightKg' ? 'gross_weight_kg' : field === 'chargeableWeightKg' ? 'chargeable_weight_kg' : field]);
                          setAwbReviewed(false);
                        }}
                        style={{ display: 'block', width: '100%', boxSizing: 'border-box', marginTop: 4, padding: '7px 9px', border: '1px solid #b8c7dc', borderRadius: 6, background: '#fff' }} />
                      {proof && <small style={{ display: 'block', color: '#526580', marginTop: 3 }}>p.{proof.page || '—'} · {proof.quote || '원문 위치 확인 필요'}</small>}
                    </label>;
                  })}
                </div>
                {awbReview?.issues?.length > 0 && <div role="alert" style={{ marginTop: 9, padding: 8, background: '#fff4e5', border: '1px solid #f4c990', borderRadius: 6, color: '#8a4b08', fontSize: 12 }}>
                  {awbReview.issues.map((issue, index) => <div key={index}>• {issue}</div>)}
                </div>}
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, fontSize: 13, color: awbReview?.ready ? '#176039' : '#667085' }}>
                  <input type="checkbox" checked={awbReviewed} disabled={!awbReview?.ready} onChange={event => setAwbReviewed(event.target.checked)} />
                  AWB 원문과 번호·포장 수·GW·CW 대조 완료
                </label>
                {awbReview?.ready && !awbReviewed && <small style={{ display: 'block', marginTop: 4, color: '#b42318' }}>대조 완료를 체크해야 입고 단계로 진행할 수 있습니다.</small>}
              </div>
  );
}

export function renderPackingExistingDuplicatesPanel({
  existingMatchesList,
  excludedDuplicateIndexes,
  activeInvoices,
  saving,
  processing,
  toggleDuplicateExclusion,
}) {
  if (!existingMatchesList.length) return null;
  return (
                  <section
                    data-testid="packing-existing-duplicates"
                    aria-label="기입고 완료 송장 자동 제외"
                    style={{
                      marginBottom: 14,
                      border: '1px solid #cbd5e1',
                      borderLeft: '4px solid #b45309',
                      borderRadius: 8,
                      background: '#fffbeb',
                      padding: '12px 14px',
                      color: '#0f172a',
                      fontSize: 13.5,
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
                      <strong style={{ fontSize: 14, color: '#0f172a' }}>
                        기입고 완료 송장 {existingMatchesList.length}건 감지 · {excludedDuplicateIndexes.size}건 자동 제외 / 신규 {activeInvoices.length}건 진행 가능
                      </strong>
                      <span style={{ fontSize: 12.5, fontWeight: 600, color: '#92400e', background: '#fef3c7', border: '1px solid #f59e0b', borderRadius: 4, padding: '2px 8px' }}>
                        중복 입고 자동 방지
                      </span>
                    </div>
                    <p style={{ margin: '0 0 10px', fontSize: 13.5, color: '#334155' }}>
                      전산 입고 원장에 이미 등록된 송장은 중복 입고를 막기 위해 매칭·엑셀 다운로드·입고 준비 대상에서 기본 제외했습니다. 신규 송장만 안전하게 진행하세요.
                    </p>
                    <div style={{ overflowX: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5, background: '#ffffff', border: '1px solid #e2e8f0' }}>
                        <thead>
                          <tr style={{ background: '#f8fafc', color: '#334155', textAlign: 'left', borderBottom: '1px solid #cbd5e1' }}>
                            <th style={{ padding: '6px 10px' }}>상태</th>
                            <th style={{ padding: '6px 10px' }}>송장번호</th>
                            <th style={{ padding: '6px 10px' }}>농장명</th>
                            <th style={{ padding: '6px 10px' }}>기존 입고번호</th>
                            <th style={{ padding: '6px 10px' }}>기존 차수</th>
                            <th style={{ padding: '6px 10px' }}>입고일</th>
                            <th style={{ padding: '6px 10px', textAlign: 'right' }}>처리</th>
                          </tr>
                        </thead>
                        <tbody>
                          {existingMatchesList.map(item => {
                            const isExcluded = excludedDuplicateIndexes.has(item.index);
                            return (
                              <tr key={`${item.index}-${item.warehouseKey}`} style={{ borderBottom: '1px solid #e2e8f0', color: '#0f172a' }}>
                                <td style={{ padding: '6px 10px' }}>
                                  <span style={{
                                    display: 'inline-block',
                                    fontSize: 12.5,
                                    fontWeight: 600,
                                    padding: '2px 7px',
                                    borderRadius: 4,
                                    background: isExcluded ? '#ecfdf5' : '#fef2f2',
                                    color: isExcluded ? '#065f46' : '#991b1b',
                                    border: `1px solid ${isExcluded ? '#6ee7b7' : '#fca5a5'}`,
                                  }}>
                                    {isExcluded ? '기입고 제외됨' : '재포함 (중복 주의)'}
                                  </span>
                                </td>
                                <td style={{ padding: '6px 10px', fontWeight: 600 }}>{item.extractedInvoiceNo || item.invoiceNo}</td>
                                <td style={{ padding: '6px 10px' }}>{item.farmName || item.extractedSupplier}</td>
                                <td style={{ padding: '6px 10px', fontWeight: 600 }}>#{item.warehouseKey}</td>
                                <td style={{ padding: '6px 10px' }}>{item.orderYear}/{item.orderWeek}</td>
                                <td style={{ padding: '6px 10px' }}>{item.inputDate || '—'}</td>
                                <td style={{ padding: '6px 10px', textAlign: 'right' }}>
                                  <button
                                    type="button"
                                    disabled={saving || processing}
                                    onClick={() => toggleDuplicateExclusion(item.index)}
                                    style={{
                                      padding: '4px 10px',
                                      fontSize: 13,
                                      fontWeight: 600,
                                      borderRadius: 6,
                                      border: '1px solid #94a3b8',
                                      background: '#ffffff',
                                      color: '#0f172a',
                                      cursor: 'pointer',
                                    }}
                                  >
                                    {isExcluded ? '예외 재포함' : '다시 제외'}
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </section>
  );
}

export default function PackingCountryAndReusePanels(props) {
  return renderPackingCountryGrid(props);
}
