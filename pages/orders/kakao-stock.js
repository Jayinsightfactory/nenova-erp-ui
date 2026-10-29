import {useEffect, useMemo, useState, useRef} from 'react';
import {calculateLedger, ledgerCopy, analyzeLedgerText, validLedgerWeek} from '../../lib/kakaoStockLedger';
import KakaoStockInbox from '../../components/orders/KakaoStockInbox';
import {stockSourceWeek} from '../../lib/kakaoStockInbox';

const PAGE='kakao-stock-ledger';
const emptyForm={customer:'',product:'',qty:'',unit:'박스',mode:'ADD',memo:''};
import {getCurrentWeek} from '../../lib/useWeekInput';
async function request(url, body) {
  const response=await fetch(url,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{});
  const data=await response.json();
  if(!response.ok || data.success===false) throw new Error(data.error || '조회·저장에 실패했습니다. 다시 시도하세요.');
  return data;
}
export default function KakaoStockPage() {
  const [week,setWeek]=useState(''),[title,setTitle]=useState('카톡방 재고장');
  const [base,setBase]=useState(''),[baseDraft,setBaseDraft]=useState(''),[events,setEvents]=useState([]),[audit,setAudit]=useState([]);
  const [raw,setRaw]=useState(''),[sources,setSources]=useState([]),[applied,setApplied]=useState([]),[review,setReview]=useState(null);
  const [form,setForm]=useState(emptyForm),[editing,setEditing]=useState(null);
  const [saved,setSaved]=useState([]),[notes,setNotes]=useState([]);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[status,setStatus]=useState(''),[dirty,setDirty]=useState(false),[includeHistory,setIncludeHistory]=useState(true);
  const lock=useRef(false),formRef=useRef(null),editReturnRef=useRef(null),analysisRef=useRef(null);
  const ledger=useMemo(()=>{try{return calculateLedger(base,events);}catch(e){return {rows:[],lines:[],error:e.message};}},[base,events]);
  const copy=ledger.error?'':ledgerCopy(ledger,includeHistory);
  const chosen=ledger.rows.find(r=>r.key===form.product);
  useEffect(()=>{setWeek(getCurrentWeek());void refreshSaved();},[]);
  useEffect(()=>{const warn=e=>{if(dirty){e.preventDefault();e.returnValue='';}};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[dirty]);
  const stamp=(action)=>({at:new Date().toISOString(),action});
  function mark(action){setDirty(true);setStatus('저장하지 않은 변경사항');setAudit(a=>[...a,stamp(action)]);setError('');}
  async function refreshSaved(){try{const d=await request(`/api/favorites?page=${PAGE}`);setSaved((d.favorites||[]).slice().reverse());}catch(e){setError(e.message);}}
  async function run(fn){if(lock.current)return;lock.current=true;setBusy(true);setError('');try{await fn();}catch(e){setError(e.message);}finally{lock.current=false;setBusy(false);}}
  function replaceEvents(next,action){try{calculateLedger(base,next);setEvents(next);mark(action);return true;}catch(e){setError(e.message);return false;}}
  function applyBase(){try{const value=calculateLedger(baseDraft,events);if(!value.rows.length)throw new Error('품목과 시작수량을 입력하세요.');setBase(baseDraft);setReview(null);mark(`시작재고 수정\n이전: ${base}\n이후: ${baseDraft}`);}catch(e){setError(e.message);}}
  function submit(e){e.preventDefault();const event={...form,id:editing||crypto.randomUUID(),at:new Date().toISOString(),name:chosen?.name};
    const next=editing?events.map(r=>r.id===editing?event:r):[...events,event];
    if(replaceEvents(next,editing?'변경내역 정정':'직접 입력')){if(editing)setAudit(a=>[...a,stamp(`정정 전: ${JSON.stringify(events.find(r=>r.id===editing))}`)]);setEditing(null);setForm({...form,qty:'',memo:''});formRef.current?.querySelector('[name=qty]')?.focus();}
  }
  function analyze(){try{if(!validLedgerWeek(week))throw new Error('연도 포함 차수를 YYYY-WW-SS로 입력하세요.');setReview({...analyzeLedgerText(raw,base,week),raw,week,base});setError('');}catch(e){setError(e.message);}}
  function applyAnalysis(){if(!review||review.raw!==raw||review.week!==week||review.base!==base)return;
    if(applied.includes(raw.trim())){setError('이미 적용한 원문입니다. 정정은 변경내역에서 진행하세요.');return;}
    const next=[...events,...review.changes.map(r=>({...r,id:crypto.randomUUID(),at:new Date().toISOString(),source:raw}))];
    if(replaceEvents(next,'원문 분석 적용')){setApplied(a=>[...a,raw.trim()]);setReview(null);setStatus('이 재고장에 적용했습니다. 저장 버튼으로 보관하세요.');}
  }
  async function save(){if(!validLedgerWeek(week))throw new Error('차수를 YYYY-WW-SS 형식으로 확인하세요.');if(base!==baseDraft)throw new Error('수정한 시작재고를 먼저 적용하세요.');if(!ledger.rows.length||ledger.error)throw new Error(ledger.error||'시작재고를 입력하세요.');
    const snapshot={version:1,title,week,base,events,audit,raw,applied,sources,savedAt:new Date().toISOString()};
    await request('/api/favorites',{page:PAGE,name:`${week} ${title}`.slice(0,100),filterData:JSON.stringify(snapshot)});
    setDirty(false);setStatus('저장했습니다. 이전 저장본도 보관됩니다.');await refreshSaved();
  }
  function load(item){if(dirty&&!window.confirm('저장하지 않은 변경사항을 버리고 저장본을 열까요?'))return;try{const d=JSON.parse(item.FilterData);if(d.version!==1||!validLedgerWeek(d.week))throw new Error('지원하지 않는 저장본입니다.');calculateLedger(d.base,d.events);setTitle(d.title);setWeek(d.week);setBase(d.base);setBaseDraft(d.base);setEvents(d.events);setAudit(d.audit||[]);setRaw(d.raw||'');setApplied(d.applied||[]);setSources(d.sources||[]);setReview(null);setEditing(null);setForm(emptyForm);setDirty(false);setStatus('저장본을 불러왔습니다.');setError('');}catch(e){setError(e.message);}}
  function analyzeSource(message){
    if(!base||base!==baseDraft){setError('기초재고를 먼저 적용하세요.');return;}
    if(stockSourceWeek(message.message,week)!==week){setError('원문과 재고장의 연도·차수를 확인하세요.');return;}
    if(raw.trim()&&raw!==message.message&&!window.confirm('현재 분석 원문을 선택한 영업방 대화로 바꿀까요? 적용한 재고내역은 유지됩니다.'))return;
    try{const next=analyzeLedgerText(message.message,base,week);setRaw(message.message);setSources([message]);setReview({...next,raw:message.message,week,base});mark('영업방 원문 선택·분석');requestAnimationFrame(()=>{analysisRef.current?.scrollIntoView({block:'start'});analysisRef.current?.focus({preventScroll:true});});}catch(e){setError(e.message);}
  }
  async function copyText(){if(base!==baseDraft)throw new Error('시작재고 수정을 적용한 뒤 복사하세요.');await navigator.clipboard.writeText(copy);setStatus('복사했습니다. 카톡에 붙여넣으세요.');}
  return <main className="stock-page">
    <header><div><h1>카톡방 재고관리</h1><p>시작재고 − 업체별 현재 수량 = 잔량 · 이 페이지에서 관리하고 카톡으로 복사합니다.</p></div><button disabled={busy} onClick={()=>run(save)}>저장본 남기기</button></header>
    <div className="toolbar"><label>재고장 이름<input value={title} disabled={busy} maxLength={70} onChange={e=>{setTitle(e.target.value);mark('이름 수정');}} /></label><label>연도·차수<input aria-label="연도·차수" value={week} disabled={busy||events.length>0} onChange={e=>{setWeek(e.target.value);setReview(null);mark('차수 수정');}} placeholder="2026-43-01" /></label><button disabled={busy} onClick={()=>{if(dirty&&!window.confirm('저장하지 않은 내용을 버리고 새 재고장을 만들까요?'))return;setBase('');setBaseDraft('');setEvents([]);setAudit([]);setRaw('');setApplied([]);setSources([]);setReview(null);setEditing(null);setForm(emptyForm);setDirty(false);setStatus('새 재고장입니다. 차수를 선택하세요.');}}>새 재고장</button></div>
    <p role="status">{busy?'처리 중…':status}{dirty?' · 미저장':''}</p>{(error||ledger.error)&&<p className="error" role="alert">{error||ledger.error}</p>}
    <KakaoStockInbox week={week} disabled={busy} canAnalyze={!!base&&base===baseDraft} applied={applied} onAnalyze={analyzeSource}/>
    <div className="workspace">
      <aside><h2>기초재고</h2><p>주문 차감 전 총수량입니다. 순서·구분선은 복사할 때 유지됩니다.</p><label>시작재고 입력<textarea aria-label="시작재고 입력" disabled={busy} rows={15} value={baseDraft} placeholder={'문라이트 3\n노비아 2\n쥬리고 1\n---------------\n화이트 10\n블루 3\n버건디 1'} onChange={e=>{setBaseDraft(e.target.value);setDirty(true);}} /></label><button disabled={busy||base===baseDraft} onClick={applyBase}>시작재고 적용·수정</button>
      <details><summary>붙여넣기 주문등록의 기초재고 가져오기</summary><button disabled={busy} onClick={()=>run(async()=>{const d=await request('/api/favorites?page=paste-stock-note');setNotes(d.favorites||[]);})}>저장 목록 조회</button>{notes.map(n=>{let d;try{d=JSON.parse(n.FilterData);}catch{return null;}return <button className="saved" key={n.FavoriteKey} onClick={()=>{if(baseDraft&&!window.confirm('기초재고 입력을 교체할까요?'))return;setBaseDraft(d.baseStockText||'');setDirty(true);}}>{n.FavName}</button>;})}</details>
      <details><summary>재고장 저장본 ({saved.length})</summary><button disabled={busy} onClick={()=>run(refreshSaved)}>새로고침</button>{saved.map(n=><button disabled={busy} className="saved" key={n.FavoriteKey} onClick={()=>load(n)}>{n.FavName} · #{n.FavoriteKey}</button>)}</details></aside>
      <section><h2>현재 재고 · 변경내역</h2><div className="table-wrap"><table><thead><tr><th>품목</th><th>잔량</th><th>시작</th><th>업체별 변경내역</th></tr></thead><tbody>{ledger.lines.map(line=>{if(!line.key)return <tr key={line.index}><td colSpan={4} className="separator">{line.raw||' '}</td></tr>;const r=ledger.rows.find(x=>x.key===line.key);return <tr key={r.key}><th>{r.name}</th><td className={r.remaining<0||r.remainingDetail<0?'error':'quantity'}>{r.remaining}{r.unit}{r.detailUnit?` + ${r.remainingDetail}${r.detailUnit}`:''}</td><td>{r.qty}{r.unit}{r.detailUnit?` + ${r.detailQty}${r.detailUnit}`:''}</td><td>{r.history.map(h=><div key={h.id}>{h.customer} {h.before}→{h.after}{h.unit} ({h.stockBefore}→{h.stockAfter}) {h.mode==='BASELINE'?'· 기존 주문':''} {h.memo}</div>)}</td></tr>;})}</tbody></table></div>{!ledger.rows.length&&<p>왼쪽에 기초재고를 입력하고 적용하세요.</p>}
      <h2>카톡 복사 미리보기</h2><label className="check"><input type="checkbox" checked={includeHistory} onChange={e=>setIncludeHistory(e.target.checked)} />변경내역 포함</label><textarea aria-label="복사 미리보기" rows={9} readOnly value={copy}/><button disabled={busy||!copy||!!ledger.error} onClick={()=>run(copyText)}>카톡용 텍스트 복사</button>
      </section>
      <section><h2>{editing?'변경내역 정정':'직접 변경 입력'}</h2><form ref={formRef} onSubmit={submit} onKeyDown={e=>{if(e.key==='Escape'&&editing){e.preventDefault();setEditing(null);setForm(emptyForm);editReturnRef.current?.focus();}}}><label>업체<input required disabled={busy} value={form.customer} onChange={e=>setForm({...form,customer:e.target.value})}/></label><label>품목<select aria-label="품목" required disabled={busy} value={form.product} onChange={e=>{const r=ledger.rows.find(r=>r.key===e.target.value);setForm({...form,product:e.target.value,unit:r?.unit||'박스'});}}><option value="">품목 선택</option>{ledger.rows.map(r=><option key={r.key} value={r.key}>{r.name}</option>)}</select></label><div className="two"><label>변경 방식<select aria-label="변경 방식" disabled={busy} value={form.mode} onChange={e=>setForm({...form,mode:e.target.value})}><option value="ADD">추가 (+)</option><option value="CANCEL">취소 (−)</option><option value="SET">최종수량 변경 (=)</option><option value="BASELINE">기존 주문 입력 (=)</option></select></label><label>수량<input name="qty" required type="number" step="any" min="0" disabled={busy} value={form.qty} onChange={e=>setForm({...form,qty:e.target.value})}/></label></div><label>단위<select aria-label="단위" disabled={busy} value={form.unit} onChange={e=>setForm({...form,unit:e.target.value})}><option>{chosen?.unit||'박스'}</option>{chosen?.detailUnit&&<option>{chosen.detailUnit}</option>}</select></label><label>변경 메모<input disabled={busy} value={form.memo} onChange={e=>setForm({...form,memo:e.target.value})}/></label><button disabled={busy||!ledger.rows.length}>{editing?'정정 적용':'재고장에 적용'}</button>{editing&&<button type="button" onClick={()=>{setEditing(null);setForm(emptyForm);}}>정정 취소</button>}</form>
      <h2 ref={analysisRef} tabIndex={-1}>카톡 원문 분석</h2><p>업체명 다음 줄에 “문라이트 1추가”, “노비아 1취소”를 입력하세요. 최종수량은 “2변경”입니다.</p><textarea aria-label="카톡 원문" rows={8} disabled={busy} value={raw} onChange={e=>{setRaw(e.target.value);setSources([]);setReview(null);setDirty(true);}}/><button disabled={busy||!base||!raw.trim()} onClick={analyze}>변경내용 분석</button>
      {review&&<div className="review"><h3>적용 전 확인</h3>{review.errors.map((s,i)=><p className="error" key={i}>{s}</p>)}{review.changes.map((r,i)=><p key={i}>{r.customer} · {r.name} · {r.mode==='ADD'?'추가':r.mode==='CANCEL'?'취소':'최종수량'} {r.qty}{r.unit}</p>)}<button disabled={busy||review.errors.length>0} onClick={applyAnalysis}>확인한 변경 적용</button><p>인식되지 않은 줄은 원문을 고치거나 직접 입력하세요.</p></div>}

      </section>
    </div>
    <details><summary>입력 이력 · 정정 ({events.length})</summary><div className="table-wrap"><table><thead><tr><th>업체·품목</th><th>입력</th><th>메모</th><th>관리</th></tr></thead><tbody>{events.map(e=><tr key={e.id}><td>{e.customer} · {e.name}</td><td>{({ADD:'추가',CANCEL:'취소',SET:'최종수량',BASELINE:'기존 주문'})[e.mode]} {e.qty}{e.unit}{e.voided?' (적용 취소됨)':''}</td><td>{e.memo}</td><td><button disabled={busy||e.voided} onClick={click=>{editReturnRef.current=click.currentTarget;setEditing(e.id);setForm(e);formRef.current?.scrollIntoView({block:'center'});formRef.current?.querySelector('input')?.focus();}}>정정</button><button disabled={busy||e.voided} onClick={()=>{if(window.confirm('이 입력의 적용을 취소하고 잔량을 다시 계산할까요?'))replaceEvents(events.map(x=>x.id===e.id?{...x,voided:true}:x),'입력 적용 취소');}}>적용 취소</button></td></tr>)}</tbody></table></div></details>
    <details><summary>관리 기록 ({audit.length})</summary>{audit.map((a,i)=><p key={i}>{new Date(a.at).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})} · {a.action}</p>)}</details>
    <style jsx>{`
      .stock-page{padding:20px;color:#203047;font-size:14px}header,.toolbar{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap}h1{font-size:25px;margin:0}h2{font-size:17px;margin:0 0 12px}h3{font-size:15px}p{line-height:1.6;color:#526176}header p{margin:8px 0 16px}.toolbar{justify-content:flex-start;margin-bottom:12px}.workspace{display:grid;grid-template-columns:minmax(210px, .8fr) minmax(380px,1.7fr) minmax(290px,1fr);gap:16px;align-items:start}aside,section{border:1px solid #d9e2ed;background:white;padding:16px;border-radius:10px;min-width:0}label{display:block;margin-bottom:10px;font-weight:600}input,select,textarea{display:block;width:100%;box-sizing:border-box;border:1px solid #bbc8d8;border-radius:5px;padding:9px;font:inherit;background:#fff;color:#203047;margin-top:5px}textarea{resize:vertical;line-height:1.6}button{padding:9px 12px;border:1px solid #b8c9da;background:#eff6ff;color:#164b7d;border-radius:6px;font:inherit;cursor:pointer;margin:4px 6px 4px 0}button:disabled{opacity:.5;cursor:default}:focus-visible{outline:3px solid #3184de;outline-offset:2px}.table-wrap{overflow-x:auto;margin-bottom:18px}table{width:100%;border-collapse:collapse}th,td{padding:10px 8px;border-bottom:1px solid #e4eaf1;text-align:left;vertical-align:top}th{font-weight:600}thead{background:#f4f7fb}.quantity{font-size:19px;font-weight:700;color:#156254}.error{color:#b42318!important;background:#fff2f0;padding:6px}.separator{white-space:pre-wrap;color:#718096}.two{display:grid;grid-template-columns:1fr 1fr;gap:8px}.check{display:flex;align-items:center;gap:8px}.check input{width:auto;margin:0}details{margin-top:16px;border-top:1px solid #d9e2ed;padding-top:12px}summary{cursor:pointer;font-weight:600;padding:5px}.saved{display:block;text-align:left;width:100%;overflow-wrap:anywhere}.review{padding:10px;background:#f1f7fd;margin-top:8px}article{border-bottom:1px solid #ddd;padding:10px 0}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit}form+h2{margin-top:24px}@media(max-width:1200px){.workspace{grid-template-columns:minmax(200px,.8fr) minmax(350px,1.5fr)}.workspace>section:last-child{grid-column:1/-1}}@media(max-width:700px){.workspace{display:block}aside,section{margin-bottom:12px}.stock-page{padding:10px}.toolbar>*{max-width:100%}}
    `}</style>
  </main>;
}
