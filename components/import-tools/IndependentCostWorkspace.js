import { useCallback, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import styles from '../../styles/ImportTools.module.css';

const Workbench = dynamic(() => import('./InvoiceReceiptWorkbench'), { ssr: false });
const Packing = dynamic(() => import('./PackingListTool'), { ssr: false });

// Cost work never shares the receipt upload's draft or navigation state.
export default function IndependentCostWorkspace({ userId, storage }) {
  const [sourceMode, setSourceMode] = useState('existing');
  const [source, setSource] = useState({});
  const [matching, setMatching] = useState(null);
  const [prepared, setPrepared] = useState(false);
  const [uploadVisited, setUploadVisited] = useState(false);
  const sourceRef = useRef(source);
  const changeSource = useCallback(next => {
    sourceRef.current = next;
    setSource(next);
    setMatching(null);
  }, []);
  const changeMatching = useCallback(snapshot => {
    const current = sourceRef.current;
    if (current.file && snapshot?.file === current.file && snapshot?.excels === current.excels
      && snapshot?.invoices === current.invoices && snapshot?.country === current.country) setMatching(snapshot);
  }, []);
  return <section aria-label="독립 도착원가 작업대">
    <nav className={styles.packingWorkModes} aria-label="도착원가 자료 선택">
      <button type="button" aria-pressed={sourceMode === 'existing'} onClick={() => setSourceMode('existing')}><strong>기존 입고 · 저장자료</strong><small>재업로드·재매칭 없이 생성하고 다운로드</small></button>
      <button type="button" aria-pressed={sourceMode === 'invoice'} onClick={() => { setUploadVisited(true); setSourceMode('invoice'); }}><strong>새 인보이스로 원가만 계산</strong><small>이 메뉴 안에서 처리 · 입고 등록 없음</small></button>
    </nav>
    <div hidden={sourceMode !== 'existing'}>
      <Workbench key={`cost-existing-${userId}`} userId={userId} workspaceMode="cost" onWorkspaceModeChange={() => {}} />
    </div>
    {uploadVisited && <div hidden={sourceMode !== 'invoice'}>
      {prepared && <button type="button" onClick={() => setPrepared(false)}>인보이스 입력·매칭 수정</button>}
      <div hidden={prepared}><Packing userId={userId} storage={storage} costOnly receiptMatchState={matching}
        onReceiptSourceChange={changeSource} onContinue={() => setPrepared(true)} /></div>
      <div id="packing-cost-stage" tabIndex={-1} hidden={!prepared && !source.excels?.length}>
        <Workbench key={`cost-invoice-${userId}`} userId={userId} {...source} workspaceMode="cost"
          onMatchStateChange={changeMatching} onWorkspaceModeChange={() => setPrepared(true)} />
      </div>
    </div>}
  </section>;
}
