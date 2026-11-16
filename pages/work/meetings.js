// pages/work/meetings.js — 회의정리: 회의 내용을 넣으면 AI가 한 장의 화이트보드(쪽지·선)로 정리한다.
//   저장은 네노바웹 전용 파일(lib/meetingBoardStore.js). 전산 DB·ERP 원장과 무관하다.
//   화면 틀(왼쪽 메뉴·상단바)은 _app.js 가 만든다 — 여기서는 내용만 그린다.
import Head from 'next/head';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import WorkflowGuide from '../../components/WorkflowGuide';
import MeetingBoard from '../../components/meetings/MeetingBoard';
import { downloadBoardPng, printBoard } from '../../components/meetings/boardExport';
import { Button, EmptyState, LinkButton, Notice, PmUiStyles, Skeleton, Tabs } from '../../components/pm/ui';
import { allThemesCss } from '../../lib/pmThemes';
import { CARD_TYPES, CARD_TYPE_LABEL, LIMITS, findQuote, layoutBoard, newId } from '../../lib/meetingBoard';

const DRAFT_KEY = 'nenova.meetingBoard.draft.v1';
const EMPTY = { id: null, revision: 0, canEdit: true, title: '', date: '', attendees: '', sourceText: '', board: null, shared: false, ownerName: '' };
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

async function api(body, query = '') {
  let response;
  try {
    response = await fetch('/api/work/meetings' + query, body
      ? { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
      : { credentials: 'same-origin' });
  } catch { throw new Error('서버에 닿지 못했습니다. 인터넷 연결을 확인하고 다시 눌러 주세요.'); }
  let data = null;
  try { data = await response.json(); } catch {}
  if (!response.ok || !data?.success) throw Object.assign(new Error(data?.error || '요청을 처리하지 못했습니다. 잠시 뒤 다시 눌러 주세요.'), { code: data?.code, status: response.status });
  return data;
}
// 저장 시각은 세계 표준시라 그대로 자르면 오전 9시 전에는 하루 전으로 보인다 → 보는 사람 시간으로 바꿔 날짜만.
const localDay = iso => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const countText = counts => ['topic', 'decision', 'action', 'question'].filter(type => counts?.[type]).map(type => `${CARD_TYPE_LABEL[type]} ${counts[type]}`).join(' · ');

export default function MeetingsPage() {
  const themeCss = useMemo(() => allThemesCss(), []);
  const [view, setView] = useState('list');
  // 목록
  const [tab, setTab] = useState('active'), [q, setQ] = useState(''), [rows, setRows] = useState(null), [listError, setListError] = useState('');
  const [listNote, setListNote] = useState(null), [purgeAsk, setPurgeAsk] = useState(null), [rowBusy, setRowBusy] = useState('');
  // 한 건
  const [doc, setDoc] = useState(EMPTY), [dirty, setDirty] = useState(false);
  const [organizing, setOrganizing] = useState(false), [saving, setSaving] = useState(false), [opening, setOpening] = useState(false);
  const [notice, setNotice] = useState(null), [selectedId, setSelectedId] = useState(null), [undo, setUndo] = useState(null);
  const [sourceView, setSourceView] = useState(null), [addType, setAddType] = useState('point'), [autoEditId, setAutoEditId] = useState(null);
  const [pendingTidy, setPendingTidy] = useState(false), [redoAsk, setRedoAsk] = useState(false), [showSource, setShowSource] = useState(false);
  const boardRef = useRef(null), sourceClose = useRef(null), sourceReturn = useRef(null), markRef = useRef(null), listSeq = useRef(0);
  const readOnly = !doc.canEdit;

  const loadList = useCallback(async (nextTab = tab, nextQ = q) => {
    const seq = ++listSeq.current; setListError('');
    try {
      const params = new URLSearchParams(); if (nextQ.trim()) params.set('q', nextQ.trim()); if (nextTab === 'deleted') params.set('deleted', '1');
      const data = await api(null, params.toString() ? `?${params}` : '');
      if (seq === listSeq.current) setRows(data.meetings);
    } catch (error) { if (seq === listSeq.current) { setRows(null); setListError(error.message); } }
  }, [tab, q]);
  useEffect(() => { if (view !== 'list') return undefined; const timer = setTimeout(() => loadList(tab, q), q ? 250 : 0); return () => clearTimeout(timer); }, [view, tab, q]); // eslint-disable-line react-hooks/exhaustive-deps

  // 저장 전 새 회의의 글은 이 브라우저에만 임시로 남긴다(AI 실패·새로고침에도 원문을 잃지 않게).
  useEffect(() => {
    if (view !== 'edit' || doc.id || readOnly) return;
    try {
      if (doc.sourceText || doc.title || doc.attendees) window.localStorage.setItem(DRAFT_KEY, JSON.stringify({ title: doc.title, date: doc.date, attendees: doc.attendees, sourceText: doc.sourceText }));
      else window.localStorage.removeItem(DRAFT_KEY);
    } catch {}
  }, [view, doc.id, doc.title, doc.date, doc.attendees, doc.sourceText, readOnly]);

  const leaveOk = useCallback(() => !dirty || window.confirm('저장하지 않은 내용이 있습니다. 저장하지 않고 나갈까요?'), [dirty]);
  const goList = useCallback(() => { if (!leaveOk()) return; setView('list'); setDirty(false); setNotice(null); setUndo(null); setSourceView(null); setSelectedId(null); setRedoAsk(false); }, [leaveOk]);
  useEffect(() => {
    const back = event => { if (view === 'edit') { event.preventDefault(); goList(); } };
    const unload = event => { if (dirty) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('nenova:menu-back-request', back); window.addEventListener('beforeunload', unload);
    return () => { window.removeEventListener('nenova:menu-back-request', back); window.removeEventListener('beforeunload', unload); };
  }, [view, dirty, goList]);

  const change = patch => { setDoc(current => ({ ...current, ...patch })); setDirty(true); };
  const changeBoard = fn => { setDoc(current => ({ ...current, board: fn(current.board || { cards: [], links: [] }) })); setDirty(true); };
  const resetEdit = next => { setDoc(next); setDirty(false); setNotice(null); setUndo(null); setSelectedId(null); setSourceView(null); setRedoAsk(false); setAutoEditId(null); setShowSource(!next.board); setView('edit'); };

  const startNew = () => {
    let draft = null;
    try { draft = JSON.parse(window.localStorage.getItem(DRAFT_KEY) || 'null'); } catch {}
    resetEdit({ ...EMPTY, date: today(), ...(draft && typeof draft === 'object' ? { title: String(draft.title || ''), date: String(draft.date || today()), attendees: String(draft.attendees || ''), sourceText: String(draft.sourceText || '') } : {}) });
    if (draft?.sourceText) setNotice({ tone: 'info', title: '쓰던 글을 다시 불러왔습니다', text: '저장하지 않고 닫았던 회의 내용입니다.' });
  };
  const openMeeting = async id => {
    setOpening(true); setListNote(null);
    try {
      const { meeting } = await api(null, `?id=${encodeURIComponent(id)}`);
      resetEdit({ ...EMPTY, ...meeting, board: meeting.board?.cards?.length ? meeting.board : null });
    } catch (error) { setListNote({ tone: 'error', title: '회의를 열지 못했습니다', text: error.message }); } finally { setOpening(false); }
  };

  const organize = async () => {
    setOrganizing(true); setNotice(null); setRedoAsk(false); setUndo(null);
    try {
      const data = await api({ action: 'organize', title: doc.title, date: doc.date, attendees: doc.attendees, sourceText: doc.sourceText });
      setDoc(current => ({ ...current, board: data.board, title: current.title || data.suggestedTitle || '' }));
      setDirty(true); setSelectedId(null); setPendingTidy(true); setShowSource(false);
      const blank = data.board.cards.filter(card => card.type === 'action' && (!card.owner || !card.due)).length;
      setNotice({ tone: 'ok', title: `쪽지 ${data.board.cards.length}장으로 정리했습니다`, text: `${blank ? `담당·기한이 분명하지 않은 할 일 ${blank}건은 "확인 필요"로 표시했습니다. ` : ''}내용을 확인하고 고친 뒤 저장해 주세요.` });
    } catch (error) {
      setNotice({ tone: 'error', title: 'AI 정리를 하지 못했습니다', text: error.message, retry: true });
    } finally { setOrganizing(false); }
  };
  useEffect(() => {
    if (!pendingTidy || !doc.board) return undefined;
    const timer = setTimeout(() => { setDoc(current => (current.board ? { ...current, board: layoutBoard(current.board, boardRef.current?.sizes || {}) } : current)); setPendingTidy(false); }, 120);
    return () => clearTimeout(timer);
  }, [pendingTidy, doc.board]);
  const tidy = () => changeBoard(board => layoutBoard(board, boardRef.current?.sizes || {}));

  const save = async () => {
    setSaving(true); setNotice(null);
    try {
      const { meeting } = await api({ action: 'save', id: doc.id || undefined, expectedRevision: doc.revision, title: doc.title, date: doc.date, attendees: doc.attendees, sourceText: doc.sourceText, board: doc.board || { cards: [], links: [] }, shared: doc.shared });
      setDoc(current => ({ ...current, id: meeting.id, revision: meeting.revision, title: meeting.title, canEdit: true }));
      setDirty(false); setUndo(null);
      try { window.localStorage.removeItem(DRAFT_KEY); } catch {}
      setNotice({ tone: 'ok', title: '저장했습니다', text: '회의 목록에서 언제든 다시 열 수 있습니다.' });
    } catch (error) { setNotice({ tone: 'error', title: '저장하지 못했습니다', text: error.message }); } finally { setSaving(false); }
  };

  const addCard = () => {
    const wrap = boardRef.current?.canvas?.parentElement; const id = newId('c');
    const count = doc.board?.cards.length || 0;
    changeBoard(board => ({ ...board, cards: [...board.cards, { id, type: addType, text: '새 쪽지', owner: '', due: '', quote: '', origin: 'user', x: Math.round((wrap?.scrollLeft || 0) + 40 + (count % 5) * 24), y: 24 + (count % 5) * 24 }] }));
    setSelectedId(id); setAutoEditId(id);
  };
  const removeCard = id => {
    const board = doc.board; const card = board?.cards.find(row => row.id === id); if (!card) return;
    setUndo({ card, links: board.links.filter(link => link.from === id || link.to === id) });
    changeBoard(current => ({ cards: current.cards.filter(row => row.id !== id), links: current.links.filter(link => link.from !== id && link.to !== id) }));
    setSelectedId(null);
  };
  const undoRemove = () => { if (!undo) return; changeBoard(board => ({ cards: [...board.cards, undo.card], links: [...board.links, ...undo.links] })); setSelectedId(undo.card.id); setUndo(null); };
  const exportArgs = () => ({ board: doc.board, canvasNode: boardRef.current?.canvas, meta: { title: doc.title || '회의정리', date: doc.date, attendees: doc.attendees } });
  const settle = async () => { setSelectedId(null); await new Promise(resolve => setTimeout(resolve, 80)); }; // 고르기 표시를 걷고 난 모습으로 내보낸다
  const savePng = async () => {
    await settle();
    try { await downloadBoardPng(exportArgs(), `회의정리_${(doc.title || '보드').replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 40)}_${doc.date || today()}.png`); setNotice({ tone: 'ok', title: '그림 파일로 받았습니다', text: '내려받기 폴더에서 확인해 주세요.' }); }
    catch { setNotice({ tone: 'error', title: '그림을 만들지 못했습니다', text: '다시 눌러 주세요.' }); }
  };
  const print = async () => { await settle(); try { printBoard(exportArgs()); } catch { setNotice({ tone: 'error', title: '인쇄 화면을 열지 못했습니다', text: '다시 눌러 주세요.' }); } };

  const openSource = (card, element) => { sourceReturn.current = element; setSourceView(card); };
  const closeSource = () => { setSourceView(null); sourceReturn.current?.focus?.(); };
  useEffect(() => { if (!sourceView) return; sourceClose.current?.focus(); markRef.current?.scrollIntoView({ block: 'center' }); }, [sourceView]);
  const sourceHit = useMemo(() => (sourceView ? findQuote(doc.sourceText, sourceView.quote) : null), [sourceView, doc.sourceText]);

  const rowAction = async (action, row) => {
    setRowBusy(row.id + action); setPurgeAsk(null);
    try {
      await api({ action, id: row.id });
      setListNote(action === 'trash' ? { tone: 'ok', title: `"${row.title}" 회의를 지웠습니다`, text: '지운 회의 칸에서 되살릴 수 있습니다.', undoRow: row }
        : action === 'restore' ? { tone: 'ok', title: `"${row.title}" 회의를 되살렸습니다` } : { tone: 'ok', title: `"${row.title}" 회의를 완전히 지웠습니다` });
      await loadList();
    } catch (error) { setListNote({ tone: 'error', title: '처리하지 못했습니다', text: error.message }); } finally { setRowBusy(''); }
  };

  const shell = children => (
    <div className="pm mt-page" data-theme="B">
      <Head><title>회의정리 · 네노바웹</title></Head>
      <PmUiStyles />
      <style dangerouslySetInnerHTML={{ __html: themeCss }} />
      {children}
      <style jsx global>{pageCss}</style>
    </div>
  );

  if (view === 'list') return shell(
    <>
      <header className="mt-head">
        <div><h1>회의정리</h1><p>회의 내용을 붙여 넣으면 주제 · 결정 · 할 일 · 남은 질문을 한 장의 보드로 정리해 드립니다.</p></div>
        <Button variant="primary" data-act="new" onClick={startNew}>새 회의 정리하기</Button>
      </header>
      <WorkflowGuide workflowId="work-meetings" />
      <div className="mt-bar">
        <Tabs label="회의 목록 구분" value={tab} onChange={value => { setRows(null); setTab(value); setListNote(null); }} items={[['active', '회의 목록'], ['deleted', '지운 회의']]} />
        <label className="mt-search">찾기<input className="mt-input" type="search" value={q} placeholder="제목 · 참석자 · 내용으로 찾기" onChange={event => setQ(event.target.value)} /></label>
      </div>
      {listNote && <Notice tone={listNote.tone} title={listNote.title} action={listNote.undoRow ? <Button size="sm" onClick={() => rowAction('restore', listNote.undoRow)}>되돌리기</Button> : undefined}>{listNote.text}</Notice>}
      {listError ? <Notice tone="error" title="회의 목록을 불러오지 못했습니다" action={<Button size="sm" onClick={() => loadList()}>다시 불러오기</Button>}>{listError}</Notice>
        : !rows ? <div aria-busy="true"><Skeleton card rows={3} /><Skeleton card rows={3} /></div>
        : !rows.length ? (
          <EmptyState title={q.trim() ? '찾는 회의가 없습니다' : tab === 'deleted' ? '지운 회의가 없습니다' : '아직 정리한 회의가 없습니다'}
            action={q.trim() ? <Button onClick={() => setQ('')}>찾는 말 지우기</Button> : tab === 'deleted' ? undefined : <Button onClick={startNew}>첫 회의 정리하기</Button>}>
            {q.trim() ? '다른 말로 찾아 보거나 찾는 말을 지워 주세요.' : tab === 'deleted' ? '지운 회의는 여기에 모이고, 되살릴 수 있습니다.' : '회의록이나 메모, 카톡으로 오간 회의 내용을 붙여 넣어 시작해 보세요.'}
          </EmptyState>
        ) : (
          <ul className="mt-list" aria-busy={opening || undefined}>
            {rows.map(row => (
              <li key={row.id} className="mt-row" data-meeting={row.id}>
                <div className="mt-row-main">
                  <b>{row.title}</b>
                  <span>{[row.date, row.attendees && `참석 ${row.attendees}`, countText(row.counts)].filter(Boolean).join(' · ') || '쪽지 없음'}</span>
                  <small>{row.mine ? (row.shared ? '직원 모두와 함께 보는 회의' : '나만 보는 회의') : `${row.ownerName || '다른 직원'} 님이 함께 보기로 연 회의`} · 고친 때 {localDay(row.updatedAt)}{row.counts?.needCheck ? ` · 확인 필요 ${row.counts.needCheck}` : ''}</small>
                </div>
                <div className="mt-row-acts">
                  {tab === 'active' ? (
                    <>
                      <Button size="sm" data-act="open" onClick={() => openMeeting(row.id)}>열기</Button>
                      {row.canEdit && <Button size="sm" variant="ghost" data-act="trash" loading={rowBusy === row.id + 'trash'} onClick={() => rowAction('trash', row)}>지우기</Button>}
                    </>
                  ) : purgeAsk === row.id ? (
                    <>
                      <span className="mt-ask">되돌릴 수 없습니다.</span>
                      <Button size="sm" variant="danger" data-act="purge-yes" loading={rowBusy === row.id + 'purge'} onClick={() => rowAction('purge', row)}>완전히 지우기</Button>
                      <Button size="sm" variant="ghost" onClick={() => setPurgeAsk(null)}>그만두기</Button>
                    </>
                  ) : (
                    <>
                      <Button size="sm" data-act="restore" loading={rowBusy === row.id + 'restore'} onClick={() => rowAction('restore', row)}>되살리기</Button>
                      <Button size="sm" variant="ghost" data-act="purge" onClick={() => setPurgeAsk(row.id)}>완전히 지우기</Button>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
    </>
  );

  const hasBoard = !!doc.board;
  const canOrganize = doc.sourceText.trim().length >= 20;
  return shell(
    <>
      <header className="mt-head">
        <div><h1>{doc.id ? '회의 보드' : '새 회의 정리'}</h1><p>{readOnly ? `${doc.ownerName || '다른 직원'} 님이 함께 보기로 연 회의입니다. 만든 사람만 고칠 수 있습니다.` : doc.id ? '쪽지를 옮기거나 고친 뒤 저장하기를 누르세요.' : '회의 내용을 넣고 정리하기를 누르세요. 원문에 있는 내용만 쪽지로 만듭니다.'}</p></div>
        <Button variant="ghost" data-act="back" onClick={goList}>목록으로 가기</Button>
      </header>
      <div className="mt-meta">
        <label>회의 제목<input className="mt-input" data-field="title" value={doc.title} maxLength={LIMITS.title} disabled={readOnly} placeholder="비워 두면 AI가 제안합니다" onChange={event => change({ title: event.target.value })} /></label>
        <label>날짜<input className="mt-input" data-field="date" type="date" value={doc.date} disabled={readOnly} onChange={event => change({ date: event.target.value })} /></label>
        <label>참석자<input className="mt-input" data-field="attendees" value={doc.attendees} maxLength={LIMITS.attendees} disabled={readOnly} placeholder="예: 영업 · 수입 · 관리 담당" onChange={event => change({ attendees: event.target.value })} /></label>
      </div>

      {(!hasBoard || showSource) && (
        <section className="mt-source" aria-label="회의 내용">
          <label htmlFor="mt-source-text">회의 내용 <small>회의록 · 메모 · 카톡으로 오간 이야기를 그대로 붙여 넣으세요 ({doc.sourceText.length.toLocaleString('ko-KR')} / {LIMITS.source.toLocaleString('ko-KR')}자)</small></label>
          <textarea id="mt-source-text" className="mt-input" data-field="source" rows={hasBoard ? 8 : 14} maxLength={LIMITS.source} value={doc.sourceText} disabled={readOnly || organizing}
            placeholder={'예)\n김 과장: 다음 주 콜롬비아 장미 입고가 하루 늦어질 것 같습니다.\n이 대리: 그럼 수요일 출고분은 목요일로 미루겠습니다. 거래처 안내는 제가 금요일까지 하겠습니다.'} onChange={event => change({ sourceText: event.target.value })} />
        </section>
      )}

      {notice && (
        <Notice tone={notice.tone} title={notice.title} data-notice={notice.tone}
          action={notice.retry ? <Button size="sm" loading={organizing} disabled={!canOrganize} onClick={organize}>다시 정리하기</Button> : undefined}>{notice.text}</Notice>
      )}
      {undo && <Notice tone="info" title="쪽지를 지웠습니다" action={<Button size="sm" data-act="undo" onClick={undoRemove}>되돌리기</Button>}>잘못 지웠으면 되돌릴 수 있습니다.</Notice>}

      {!readOnly && !hasBoard && (
        <div className="mt-tools">
          <Button variant="primary" data-act="organize" loading={organizing} disabled={!canOrganize} onClick={organize}>{organizing ? '정리하는 중' : '정리하기'}</Button>
          <Button data-act="blank" disabled={organizing} onClick={() => { change({ board: { cards: [], links: [] } }); setShowSource(false); }}>빈 보드로 시작</Button>
          <Button data-act="save" loading={saving} disabled={organizing || !doc.sourceText.trim()} onClick={save}>글만 저장하기</Button>
          {!canOrganize && <span className="mt-ask">회의 내용을 20자 이상 넣으면 정리할 수 있습니다.</span>}
          {organizing && <span className="mt-ask" role="status">AI가 읽고 있습니다. 보통 10~40초 걸립니다.</span>}
        </div>
      )}

      {hasBoard && (
        <>
          <div className="mt-tools" role="toolbar" aria-label="보드 도구">
            {!readOnly && <Button variant="primary" data-act="save" loading={saving} disabled={organizing} onClick={save}>저장하기</Button>}
            {!readOnly && (
              <span className="mt-add">
                <label className="mt-sr" htmlFor="mt-add-type">더할 쪽지 종류</label>
                <select id="mt-add-type" className="mt-input" value={addType} onChange={event => setAddType(event.target.value)}>{CARD_TYPES.map(type => <option key={type} value={type}>{CARD_TYPE_LABEL[type]}</option>)}</select>
                <Button data-act="add" onClick={addCard}>쪽지 더하기</Button>
              </span>
            )}
            {!readOnly && <Button data-act="tidy" disabled={!doc.board.cards.length} onClick={tidy}>가지런히 놓기</Button>}
            <Button data-act="png" disabled={!doc.board.cards.length} onClick={savePng}>그림으로 받기</Button>
            <Button data-act="print" disabled={!doc.board.cards.length} onClick={print}>인쇄하기</Button>
            <Button variant="ghost" data-act="source-toggle" aria-expanded={showSource} onClick={() => setShowSource(value => !value)}>{showSource ? '회의 내용 접기' : '회의 내용 펴기'}</Button>
            {!readOnly && (redoAsk ? (
              <>
                <span className="mt-ask">지금 보드를 버리고 새로 정리합니다.</span>
                <Button variant="danger" size="sm" loading={organizing} onClick={organize}>새로 정리하기</Button>
                <Button variant="ghost" size="sm" onClick={() => setRedoAsk(false)}>그만두기</Button>
              </>
            ) : <Button variant="ghost" data-act="redo" loading={organizing} disabled={!canOrganize} onClick={() => setRedoAsk(true)}>AI로 다시 정리</Button>)}
            {!readOnly && <label className="mt-share"><input type="checkbox" checked={doc.shared} onChange={event => change({ shared: event.target.checked })} />직원 모두와 함께 보기</label>}
          </div>
          <p className="mt-legend" aria-label="쪽지 색 안내">
            {CARD_TYPES.map(type => <span key={type} className={`mt-chip mtb-${type}`}>{CARD_TYPE_LABEL[type]}</span>)}
            <span>쪽지를 끌어 옮기고, 눌러서 고치기 · 원문 보기 · 잇기 · 지우기를 할 수 있습니다. 키보드는 방향키로 옮기고 Enter로 고칩니다.</span>
          </p>
          {doc.board.cards.length ? (
            <MeetingBoard board={doc.board} readOnly={readOnly} selectedId={selectedId} onSelect={setSelectedId} boardRef={boardRef} autoEditId={autoEditId}
              onMove={(id, x, y) => changeBoard(board => ({ ...board, cards: board.cards.map(card => (card.id === id ? { ...card, x, y } : card)) }))}
              onEdit={(id, patch) => { changeBoard(board => ({ ...board, cards: board.cards.map(card => (card.id === id ? { ...card, ...patch } : card)) })); setAutoEditId(null); }}
              onRemove={removeCard}
              onAddLink={(from, to) => changeBoard(board => (board.links.some(link => (link.from === from && link.to === to) || (link.from === to && link.to === from)) ? board : { ...board, links: [...board.links, { id: newId('l'), from, to, label: '' }] }))}
              onRemoveLink={id => changeBoard(board => ({ ...board, links: board.links.filter(link => link.id !== id) }))}
              onShowSource={openSource} />
          ) : <EmptyState title="아직 쪽지가 없습니다" action={readOnly ? undefined : <Button onClick={addCard}>첫 쪽지 더하기</Button>}>쪽지를 직접 더하거나, 회의 내용을 넣고 AI로 다시 정리해 보세요.</EmptyState>}
        </>
      )}

      {sourceView && (
        <aside className="mt-drawer" role="dialog" aria-label="원문에서 나온 자리" onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); closeSource(); } }}>
          <div className="mt-drawer-head"><b>원문에서 나온 자리</b><button ref={sourceClose} type="button" className="btn pmk pmk-btn pmk-secondary pmk-sm" data-act="source-close" onClick={closeSource}>닫기</button></div>
          <p className="mt-drawer-card"><small>{CARD_TYPE_LABEL[sourceView.type]} 쪽지</small>{sourceView.text}</p>
          {sourceHit ? (
            <div className="mt-drawer-text">{doc.sourceText.slice(0, sourceHit.start)}<mark ref={markRef}>{sourceHit.text}</mark>{doc.sourceText.slice(sourceHit.end)}</div>
          ) : (
            <><Notice tone="warn" title="회의 내용이 바뀌어 자리를 찾지 못했습니다">쪽지를 만들 때 근거가 된 문장만 보여 드립니다.</Notice><div className="mt-drawer-text"><mark>{sourceView.quote}</mark></div></>
          )}
        </aside>
      )}
    </>
  );
}

const pageCss = `
.mt-page { padding: 16px 24px 48px; color: var(--pm-ink); font-size: 14px; line-height: 1.5; }
.mt-page h1 { margin: 0; font-size: 22px; font-weight: 700; }
.mt-page .mt-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; flex-wrap: wrap; margin-bottom: 12px; }
.mt-page .mt-head p { margin: 4px 0 0; color: var(--pm-muted); }
.mt-page .mt-input { font: inherit; color: var(--pm-ink); background: var(--pm-surface); border: 1px solid var(--pm-line); border-radius: var(--pm-radius, 8px); padding: 6px 8px; box-sizing: border-box; min-height: 32px; }
.mt-page .mt-input:focus-visible { outline: 2px solid var(--pm-accent); outline-offset: 1px; }
.mt-page textarea.mt-input { width: 100%; resize: vertical; line-height: 1.6; }
.mt-page .mt-bar { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; margin: 12px 0; }
.mt-page .mt-search { display: flex; align-items: center; gap: 8px; color: var(--pm-muted); }
.mt-page .mt-search input { width: 320px; max-width: 70vw; }
.mt-page .mt-list { list-style: none; margin: 12px 0 0; padding: 0; display: grid; gap: 8px; }
.mt-page .mt-row { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; padding: 12px 16px; background: var(--pm-surface); border: 1px solid var(--pm-line); border-radius: var(--pm-radius, 8px); }
.mt-page .mt-row-main { display: grid; gap: 4px; min-width: 0; flex: 1 1 320px; }
.mt-page .mt-row-main b { font-size: 16px; overflow-wrap: anywhere; }
.mt-page .mt-row-main span { overflow-wrap: anywhere; }
.mt-page .mt-row-main small { color: var(--pm-muted); font-size: 12px; }
.mt-page .mt-row-acts, .mt-page .mt-tools { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.mt-page .mt-tools { margin: 12px 0; }
.mt-page .mt-ask { color: var(--pm-muted); font-size: 13px; }
.mt-page .mt-meta { display: grid; grid-template-columns: minmax(200px, 2fr) 170px minmax(200px, 2fr); gap: 12px; margin-bottom: 12px; max-width: 1100px; }
.mt-page .mt-meta label, .mt-page .mt-source > label { display: grid; gap: 4px; font-weight: 700; font-size: 13px; }
.mt-page .mt-meta input { width: 100%; font-weight: 400; }
.mt-page .mt-source { margin-bottom: 12px; display: grid; gap: 4px; max-width: 1100px; }
.mt-page .mt-source small { font-weight: 400; color: var(--pm-muted); }
.mt-page .mt-add { display: inline-flex; gap: 4px; align-items: center; }
.mt-page .mt-share { display: inline-flex; gap: 4px; align-items: center; margin-left: 8px; }
.mt-page .mt-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
.mt-page .mt-legend { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin: 0 0 8px; color: var(--pm-muted); font-size: 12px; }
.mt-page .mt-chip { padding: 2px 8px; border-radius: 4px; border: 1px solid var(--mtb-edge); background: var(--mtb-fill); color: var(--pm-ink); font-weight: 700; }
.mt-page .mtb-topic { --mtb-fill: color-mix(in srgb, var(--pm-accent) 20%, var(--pm-surface)); --mtb-edge: color-mix(in srgb, var(--pm-accent) 60%, var(--pm-line)); }
.mt-page .mtb-point { --mtb-fill: var(--pm-surface); --mtb-edge: var(--pm-line); }
.mt-page .mtb-decision { --mtb-fill: color-mix(in srgb, var(--pm-accent2, var(--pm-accent)) 22%, var(--pm-surface)); --mtb-edge: color-mix(in srgb, var(--pm-accent2, var(--pm-accent)) 60%, var(--pm-line)); }
.mt-page .mtb-action { --mtb-fill: color-mix(in srgb, var(--pm-link) 14%, var(--pm-surface)); --mtb-edge: color-mix(in srgb, var(--pm-link) 55%, var(--pm-line)); }
.mt-page .mtb-question { --mtb-fill: color-mix(in srgb, var(--pm-err) 11%, var(--pm-surface)); --mtb-edge: color-mix(in srgb, var(--pm-err) 45%, var(--pm-line)); }
.mt-page .mtb-wrap { overflow-x: auto; border: 1px solid var(--pm-line); border-radius: var(--pm-radius, 8px); background: var(--pm-surface2); }
.mt-page .mtb-hint { position: sticky; left: 0; margin: 0; padding: 8px 12px; background: var(--pm-surface); border-bottom: 1px solid var(--pm-line); }
.mt-page .mtb-canvas { position: relative; color: var(--pm-ink); background-color: var(--pm-surface2); background-image: radial-gradient(var(--pm-line) 1px, transparent 1px); background-size: 24px 24px; touch-action: pan-y; }
.mt-page .mtb-lines { position: absolute; left: 0; top: 0; }
.mt-page .mtb-line { stroke: var(--pm-muted); stroke-width: 1.5; opacity: .55; }
.mt-page .mtb-line.on { stroke: var(--pm-accent); stroke-width: 3; opacity: 1; }
.mt-page .mtb-line-hit { stroke: transparent; stroke-width: 14; cursor: pointer; pointer-events: stroke; }
.mt-page .mtb-line-label { fill: var(--pm-muted); font-size: 12px; paint-order: stroke; stroke: var(--pm-surface2); stroke-width: 4px; }
.mt-page .mtb-line-act { position: absolute; z-index: 4; }
.mt-page .mtb-card { position: absolute; box-sizing: border-box; padding: 8px 12px 12px; background: var(--mtb-fill); border: 1px solid var(--mtb-edge); border-radius: 8px; box-shadow: 0 1px 3px color-mix(in srgb, var(--pm-ink) 16%, transparent); cursor: grab; touch-action: none; user-select: none; z-index: 1; }
.mt-page .mtb-card:focus-visible, .mt-page .mtb-card.on { outline: 2px solid var(--pm-accent); outline-offset: 2px; z-index: 2; }
.mt-page .mtb-card.drag { cursor: grabbing; z-index: 3; box-shadow: 0 8px 16px color-mix(in srgb, var(--pm-ink) 24%, transparent); }
.mt-page .mtb-card.linking { outline: 2px dashed var(--pm-accent); outline-offset: 2px; }
.mt-page .mtb-kind { font-size: 12px; font-weight: 700; color: var(--pm-muted); margin-bottom: 4px; }
.mt-page .mtb-text { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.5; }
.mt-page .mtb-topic .mtb-text { font-weight: 700; font-size: 15px; }
.mt-page .mtb-meta { display: flex; gap: 4px 8px; flex-wrap: wrap; margin-top: 8px; font-size: 12px; color: var(--pm-muted); }
.mt-page .mtb-flag { padding: 0 6px; border-radius: 4px; font-size: 12px; font-weight: 700; color: var(--pm-err); border: 1px solid color-mix(in srgb, var(--pm-err) 45%, var(--pm-line)); background: var(--pm-surface); }
.mt-page .mtb-acts { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 8px; padding-top: 8px; border-top: 1px dashed var(--mtb-edge); }
.mt-page .mtb-edit { display: grid; gap: 8px; cursor: auto; user-select: text; }
.mt-page .mtb-edit .mtb-input { width: 100%; font: inherit; color: var(--pm-ink); background: var(--pm-surface); border: 1px solid var(--pm-line); border-radius: 4px; padding: 4px 8px; box-sizing: border-box; }
.mt-page .mtb-edit-row { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.mt-page .mtb-edit-row label { display: grid; gap: 4px; font-size: 12px; color: var(--pm-muted); }
.mt-page .mtb-edit .mtb-acts { border-top: 0; margin-top: 0; padding-top: 0; }
.mt-page .mt-drawer { position: fixed; top: 64px; right: 16px; bottom: 16px; width: min(440px, calc(100vw - 32px)); z-index: 50; display: flex; flex-direction: column; gap: 12px; padding: 16px; background: var(--pm-surface); border: 1px solid var(--pm-line); border-radius: var(--pm-radius, 8px); box-shadow: 0 12px 32px color-mix(in srgb, var(--pm-ink) 28%, transparent); }
.mt-page .mt-drawer-head { display: flex; justify-content: space-between; align-items: center; font-size: 16px; }
.mt-page .mt-drawer-card { margin: 0; padding: 8px 12px; background: var(--pm-surface2); border-radius: 8px; display: grid; gap: 4px; }
.mt-page .mt-drawer-card small { color: var(--pm-muted); font-weight: 700; }
.mt-page .mt-drawer-text { flex: 1; overflow-y: auto; white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.7; padding: 8px 12px; border: 1px solid var(--pm-line); border-radius: 8px; }
.mt-page .mt-drawer-text mark { background: color-mix(in srgb, var(--pm-accent) 35%, var(--pm-surface)); color: var(--pm-ink); padding: 2px 0; border-radius: 2px; }
@media (max-width: 760px) {
  .mt-page { padding: 12px 12px 40px; }
  .mt-page .mt-meta { grid-template-columns: 1fr; }
  .mt-page .mt-search input { width: 100%; }
  .mt-page .mt-search { width: 100%; }
}
`;
