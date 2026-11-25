import React, { useEffect, useRef, useState } from 'react';
import { parseAwbFields } from '../../lib/importAwbFields.js';
import ledger from '../../styles/ArrivalCostLedger.module.css';

// Reuse the official local PDF reader. Extracted numbers remain hints until reviewed.
export default function CostAwbEvidence({ onApply, label = 'AWB 원문', initialAwb = '' }) {
  const [draft, setDraft] = useState({ awb: initialAwb, sourceId: '', gw: '', cw: '', freightAmount: '' });
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fileUrl, setFileUrl] = useState('');
  useEffect(() => () => { if (fileUrl) URL.revokeObjectURL(fileUrl); }, [fileUrl]);
  const generation = useRef(0);
  useEffect(() => () => { generation.current++; }, []);
  const edit = (key, value) => {
    generation.current++;
    setBusy(false);
    setDraft(d => ({ ...d, [key]: value }));
    setConfirmed(false);
  };

  async function read(file) {
    const token = ++generation.current;
    setConfirmed(false);
    setError('');
    if (!file) return;
    setFileUrl('');
    setDraft({ awb: initialAwb, sourceId: '', gw: '', cw: '', freightAmount: '' });
    if (!/\.pdf$/i.test(file.name) || file.size <= 0 || file.size > 20 * 1024 * 1024) {
      setError('20MiB 이하 AWB PDF를 선택하세요. 직접 입력도 가능합니다.');
      return;
    }
    setBusy(true);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (new TextDecoder().decode(bytes.slice(0, 5)) !== '%PDF-') throw Error('올바른 PDF 파일이 아닙니다.');
      if (token !== generation.current) return;
      setFileUrl(URL.createObjectURL(file));
      const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), n => n.toString(16).padStart(2, '0')).join('');
      let text = '';
      for (let i = 0; i < bytes.length; i += 32768) text += String.fromCharCode(...bytes.subarray(i, i + 32768));
      const { readAwbPdf } = await import('../../lib/importAwbPdf.js');
      const parsed = parseAwbFields(await readAwbPdf(btoa(text)));
      if (token !== generation.current) return;
      setDraft(d => ({
        ...d,
        awb: parsed.awb ?? '',
        gw: parsed.gw ?? '',
        cw: parsed.cw ?? '',
        freightAmount: parsed.total ?? '',
        sourceId: `${file.name} · SHA256 ${hash}`,
      }));
      if (parsed._error) setError('텍스트를 확인하지 못했습니다. 원문을 보고 직접 입력하세요.');
    } catch (e) {
      if (token === generation.current) setError(e.message || 'AWB 읽기 실패 · 직접 입력할 수 있습니다.');
    } finally {
      if (token === generation.current) setBusy(false);
    }
  }

  const ready = /^\d{11}$/.test(draft.awb.replace(/[\s-]/g, '')) && draft.sourceId.trim() && confirmed && !busy;

  return (
    <fieldset className={ledger.awbFieldset} aria-label={label}>
      <legend>{label} · PDF 업로드 또는 직접 확인</legend>
      <p className={ledger.awbDesc}>
        파일 없이도 아래 비용 초안을 먼저 입력할 수 있습니다. 원문 AWB 번호·중량·운임과 대상 입고를 대조한 뒤 적용하세요. PDF는 이 브라우저에서만 읽습니다.
      </p>
      <div className={ledger.awbGrid}>
        <label className={`${ledger.field} ${ledger.awbWide}`}>
          <span>AWB PDF 선택</span>
          <input
            aria-label={`${label} PDF 선택`}
            type="file"
            accept=".pdf,application/pdf"
            onChange={e => { read(e.target.files?.[0]); e.target.value = ''; }}
          />
        </label>
        {[
          ['awb', 'AWB 번호', '예: 160-17338005', false],
          ['sourceId', '원문 근거', '파일명 또는 AWB 청구서 번호', true],
          ['gw', 'GW kg', '실중량 kg', false],
          ['cw', 'CW kg', '청구중량 kg', false],
          ['freightAmount', '운임 합계 USD', '총 운임 USD', false],
        ].map(([k, t, ph, wide]) => (
          <label key={k} className={`${ledger.field} ${wide ? ledger.awbWide : ''}`}>
            <span>{t}</span>
            <input
              aria-label={`${label} ${t}`}
              value={draft[k]}
              placeholder={ph}
              onChange={e => edit(k, e.target.value)}
              inputMode={['gw', 'cw', 'freightAmount'].includes(k) ? 'decimal' : undefined}
            />
          </label>
        ))}
      </div>
      <div className={ledger.awbFooter}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <label className={ledger.checkLabel}>
            <input
              aria-label={`${label} 대조 확인`}
              type="checkbox"
              checked={confirmed}
              onChange={e => setConfirmed(e.target.checked)}
            />
            <span>원문·선택 입고·AWB 전체 적용 범위를 대조했습니다.</span>
          </label>
          {fileUrl && (
            <a className={ledger.awbSourceLink} href={fileUrl} target="_blank" rel="noreferrer">
              원본 AWB 보기
            </a>
          )}
        </div>
        <button
          type="button"
          className={ledger.btnPrimary}
          disabled={!ready}
          onClick={() => onApply({ ...draft, awb: draft.awb.replace(/[\s-]/g, ''), confirmed: true })}
        >
          확인한 AWB 적용
        </button>
      </div>
      {busy && <p className={ledger.statusNotice} role="status">AWB 원문 읽는 중…</p>}
      {error && <p className={ledger.alertError} role="alert">{error}</p>}
    </fieldset>
  );
}
