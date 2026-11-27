import React, { useState, useRef, useEffect } from 'react';
import styles from '../../styles/ImportPacking.module.css';
import { parsePrintedDate } from '../../lib/importAwbFields.js';
import { PACKING_PDF_MAX_BYTES } from '../../lib/importPackingState.js';
import { AWB_DEFAULT_COMPANIES, writeAWBWorkbook, parseWeekFromFilename } from '../../lib/importPacking.js';
import { I18N, packingText, parseAWBPdf } from '../../lib/importPacking/packingToolSupport.js';

// =============================================================================
// AWBPanel — the AWB screen.  Self-contained UI.
// All state lives here; nothing leaks into the farm flow.
// =============================================================================
function AWBPanel({ xlsxLib, lang = 'ko', onBack, readAwbPdf }) {
  const t = { ...I18N[lang] || I18N.ko, ...packingText(lang) };
  // --- Form state ----------------------------------------------------------
  // Note: storage key is versioned (v2) so we don't read stale company lists
  // from earlier prototypes (those had EXCEL/FREIGHTWISE/DHL/CATHAY).
  // Carrier preferences are session-local; only catalog/matches use team records.
  const [companies, setCompanies] = useState([...AWB_DEFAULT_COMPANIES]);
  const [company, setCompany]   = useState(companies[0] || 'EXCEL');
  const [weekend, setWeekend]   = useState('');
  const [awb, setAwb]           = useState('');
  const [invoice, setInvoice]   = useState('');
  const [date, setDate]         = useState('');
  const [gw, setGw]             = useState('');
  const [cw, setCw]             = useState('');
  const [total, setTotal]       = useState('');
  const [uPrice1, setUPrice1]   = useState('');   // U.PRICE for line 1 (운송료)
  const [total1, setTotal1]     = useState('');   // T.PRICE = uPrice1 × cw
  const [total2, setTotal2]     = useState('');   // T.PRICE for line 2

  const [pdfFile, setPdfFile]   = useState(null);
  const [pdfBase64, setPdfBase64] = useState(null);
  const [parseStatus, setParseStatus] = useState(null);
  const [newCompany, setNewCompany] = useState('');
  const [showCompanyMgr, setShowCompanyMgr] = useState(false);
  const pdfRef = useRef(null);
  const awbReaderVersion = useRef(0);
  useEffect(() => () => { ++awbReaderVersion.current; }, []);
  const [pdfDragOver, setPdfDragOver] = useState(false);

  // --- Derived: keep T1 = uPrice1 × cw, T2 = total - T1 ---------------------
  const cwNum     = parseFloat(cw)     || 0;
  const totalNum  = parseFloat(total)  || 0;
  const uPrice1Num = parseFloat(uPrice1) || 0;
  const t1 = +(uPrice1Num * cwNum).toFixed(2);
  const t2 = +(totalNum - t1).toFixed(2);
  const uPrice2 = t2;  // line 2 has J=1, so uPrice2 = t2



  // --- PDF handler ---------------------------------------------------------
  const onPdfFile = async (f) => {
    if (!f) return;
    const version = ++awbReaderVersion.current;
    setPdfFile(null); setPdfBase64(null);
    if (f.size > PACKING_PDF_MAX_BYTES) {
      setParseStatus({ kind: 'err', msg: t.pdfLimit });
      return;
    }
    if (!/\.pdf$/i.test(f.name) || (f.type && f.type !== 'application/pdf')) {
      setParseStatus({ kind: 'err', msg: t.pdfOnly });
      return;
    }
    setPdfFile(f);
    setAwb(''); setDate(''); setGw(''); setCw(''); setTotal(''); setUPrice1(''); setInvoice(''); setWeekend('');
    setParseStatus({ kind: 'loading', msg: t.pdfReading });
    const reader = new FileReader();
    reader.onload = async () => {
      if (awbReaderVersion.current !== version) return;
      try {
        const b64 = reader.result.split(',')[1];
        setPdfBase64(b64);
        const parsed = await parseAWBPdf(b64, readAwbPdf, t);
        if (awbReaderVersion.current !== version) return;
        if (parsed._error) {
          // Even if PDF text extraction failed, we can still pull the week
          // from the filename — that doesn't need a text layer.
          const wk = parseWeekFromFilename(f.name);
          if (wk) {
            setWeekend(`${wk.week}-${wk.num}`);
            setParseStatus({ kind: 'warn', msg: `${parsed._error} (${t.weekFromFile}: ${wk.week}-${wk.num})` });
          } else {
            setParseStatus({ kind: 'warn', msg: parsed._error });
          }
          return;
        }
        let filled = [];
        // Week — read from the filename (works even when the PDF is scanned)
        const wk = parseWeekFromFilename(f.name);
        if (wk) {
          setWeekend(`${wk.week}-${wk.num}`);
          filled.push(t.week);
        }
        if (parsed.awb)     { setAwb(parsed.awb);                  filled.push('AWB'); }
        if (parsed.date)    { setDate(parsed.date);                filled.push(t.date); }
        if (parsed.gw)      { setGw(String(parsed.gw));            filled.push('GW'); }
        if (parsed.cw)      { setCw(String(parsed.cw));            filled.push('CW'); }
        if (parsed.uPrice1) { setUPrice1(String(parsed.uPrice1));  filled.push(t.unitPrice); }
        if (parsed.total)   { setTotal(parsed.total.toFixed(2));   filled.push(t.total); }
        // Only auto-set company if it matches one already in our list
        if (parsed.company && companies.includes(parsed.company)) {
          setCompany(parsed.company);
          filled.push(t.company);
        }
        if (filled.length === 0) {
          setParseStatus({ kind: 'warn', msg: t.noFields });
        } else {
          setParseStatus({ kind: 'ok', msg: `${t.autoFilled}: ${filled.join(', ')}` });
        }
      } catch (e) {
        if (awbReaderVersion.current === version) setParseStatus({ kind: 'err', msg: `${t.pdfReadError} ${e.message}` });
      }
    };
    reader.onerror = () => {
      if (awbReaderVersion.current === version) setParseStatus({ kind: 'err', msg: t.pdfReadError });
    };
    reader.readAsDataURL(f);
  };

  // --- Validation ----------------------------------------------------------
  const errors = [];
  if (!company)       errors.push(t.companyRequired);
  if (!weekend.trim()) errors.push(t.weekRequired);
  if (!awb.trim())     errors.push(t.awbRequired);
  if (!parsePrintedDate(date)) errors.push(t.dateRequired);
  if (gw === '' || cwNum < 0 || isNaN(parseFloat(gw))) errors.push(t.gwRequired);
  if (cw === '' || isNaN(cwNum))   errors.push(t.cwRequired);
  if (total === '' || isNaN(totalNum)) errors.push(t.totalRequired);
  if (uPrice1 === '' || isNaN(uPrice1Num)) errors.push(t.priceRequired);
  // Total must match: (uPrice1 × cw) + uPrice2 = total  (uPrice2 is auto)
  const computed = +(t1 + t2).toFixed(2);
  const totalMatches = Math.abs(computed - totalNum) < 0.01;
  if (!totalMatches && total !== '') {
    errors.push(`${t.totalMismatch}: ${computed.toFixed(2)} / ${totalNum.toFixed(2)}.`);
  }
  if (t2 < 0) {
    errors.push(t.negativeCharge);
  }
  const canDownload = errors.length === 0;

  // --- Company manager actions ---------------------------------------------
  const addCompany = () => {
    const n = newCompany.trim().toUpperCase();
    if (!n) return;
    if (companies.includes(n)) { setNewCompany(''); return; }
    setCompanies([...companies, n]);
    setCompany(n);
    setNewCompany('');
  };
  const removeCompany = (c) => {
    const next = companies.filter(x => x !== c);
    setCompanies(next.length > 0 ? next : [...AWB_DEFAULT_COMPANIES]);
    if (company === c) setCompany((next[0] || AWB_DEFAULT_COMPANIES[0]));
  };

  // --- Download ------------------------------------------------------------
  const onDownload = () => {
    if (!canDownload || !xlsxLib) return;
    const blob = writeAWBWorkbook(xlsxLib, {
      company,
      weekend,
      invoice: invoice.trim(),
      awb: awb.trim(),
      date,
      gw: parseFloat(gw),
      cw: cwNum,
      uPrice1: uPrice1Num,
      uPrice2,
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const safeAwb = (awb || 'awb').replace(/[^a-zA-Z0-9_-]/g, '_');
    a.download = `${weekend}_${company}_AWB_${safeAwb}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  // --- UI -------------------------------------------------------------------
  const fieldLabel = { fontSize: 13, fontWeight: 600, color: '#526580', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4, display: 'block' };
  const fieldInput = { width: '100%', padding: '8px 10px', fontSize: 14, border: '1px solid #ccd6e5', borderRadius: 6, boxSizing: 'border-box', fontFamily: 'inherit' };
  const grid2 = { display: 'grid', gap: 12, marginBottom: 12 };

  return (
    <>
      <button onClick={onBack} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 13, color: '#526580', cursor: 'pointer', border: 'none', background: 'none', padding: 0, marginBottom: '1.25rem' }}>
        {t.back}
      </button>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <span style={{ fontSize: 24 }}>✈️</span>
        <div>
          <div style={{ fontSize: 18, fontWeight: 600 }}>{t.awbTitle}</div>
          <div style={{ fontSize: 13, color: '#526580' }}>{t.awbSub}</div>
        </div>
      </div>

      {/* Optional PDF upload */}
      <div style={{ fontSize: 13, fontWeight: 600, color: '#526580', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>
        {t.awbUpload}
      </div>
      <div
        role="button" tabIndex={0} aria-label={t.awbUpload}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pdfRef.current?.click(); } }}
        onClick={() => pdfRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setPdfDragOver(true); }}
        onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); setPdfDragOver(true); }}
        onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setPdfDragOver(false); }}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setPdfDragOver(false);
          const f = e.dataTransfer.files && e.dataTransfer.files[0];
          if (f) onPdfFile(f);
        }}
        style={{
          border: `1.5px dashed ${pdfDragOver ? '#2457c5' : '#ccc'}`,
          borderRadius: 10,
          padding: '1.25rem 1.5rem',
          textAlign: 'center',
          cursor: 'pointer',
          background: pdfDragOver ? '#e6edff' : '#f8fafc',
          marginBottom: 12,
          transition: 'all 0.15s',
        }}>
        <input ref={pdfRef} type="file" accept=".pdf" style={{ display: 'none' }} onChange={(e) => { onPdfFile(e.target.files[0]); e.target.value = ''; }} />
        <div style={{ fontSize: 22, marginBottom: 4 }}>📄</div>
        <div style={{ fontSize: 13, color: '#526580' }}>
          {pdfFile ? (
            <><strong style={{ color: '#172b4d' }}>{pdfFile.name}</strong> · {(pdfFile.size/1024).toFixed(0)} KB</>
          ) : (
            <><strong style={{ color: '#172b4d' }}>{t.uploadClick}</strong> {t.awbDrop}</>
          )}
        </div>
        <div style={{ fontSize: 13, color: '#526580', marginTop: 4 }}>{t.pdfLimit}</div>
      </div>
      {parseStatus && (
        <div role={parseStatus.kind === 'err' ? 'alert' : 'status'} style={{
          marginTop: -4, marginBottom: 12, padding: '8px 12px', borderRadius: 6, fontSize: 13,
          background: parseStatus.kind === 'ok'   ? '#e8f5ee' : parseStatus.kind === 'warn'   ? '#fff8e6' : parseStatus.kind === 'err' ? '#fde8e8' : '#f0f4ff',
          color:      parseStatus.kind === 'ok'   ? '#057a55' : parseStatus.kind === 'warn'   ? '#92400e' : parseStatus.kind === 'err' ? '#9b1c1c' : '#2457c5',
          border:     `1px solid ${parseStatus.kind === 'ok' ? '#b8e0c8' : parseStatus.kind === 'warn' ? '#f5d97a' : parseStatus.kind === 'err' ? '#f8b4b4' : '#c3d3fb'}`,
        }}>{parseStatus.msg}</div>
      )}

      {/* Form */}
      <div style={{ fontSize: 13, fontWeight: 600, color: '#526580', textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: 8, marginBottom: 10 }}>
        {t.awbForm}
      </div>

      <div className={styles.formGrid} style={grid2}>
        <div>
          <label style={fieldLabel}>{t.company}</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            <select aria-label={t.company} value={company} onChange={(e) => setCompany(e.target.value)} style={{ ...fieldInput, flex: 1 }}>
              {companies.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <button onClick={() => setShowCompanyMgr(v => !v)} style={{ padding: '0 10px', fontSize: 13, borderRadius: 6, border: '1px solid #ccd6e5', background: '#fff', cursor: 'pointer' }} title={t.manageCompanies} aria-label={t.manageCompanies} aria-expanded={showCompanyMgr}>
              ⚙
            </button>
          </div>
        </div>
        <div>
          <label style={fieldLabel}>{t.week}</label>
          <input aria-label={t.week} value={weekend} onChange={(e) => setWeekend(e.target.value)} placeholder="21-01" style={fieldInput} />
        </div>
      </div>

      {showCompanyMgr && (
        <div style={{ border: '1px solid #dce4ef', borderRadius: 8, padding: '10px 12px', marginBottom: 12, background: '#f8fafc' }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>{t.manageCompanies}</div>
          <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
            <input value={newCompany} onChange={(e) => setNewCompany(e.target.value)} placeholder={t.newCompany} aria-label={t.newCompany} style={{ ...fieldInput, flex: 1 }}
              onKeyDown={(e) => { if (e.key === 'Enter') addCompany(); }} />
            <button onClick={addCompany} style={{ padding: '0 14px', fontSize: 13, borderRadius: 6, border: '1px solid #2457c5', background: '#2457c5', color: '#fff', cursor: 'pointer' }}>{t.add}</button>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {companies.map(c => (
              <span key={c} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 8px', fontSize: 13, borderRadius: 20, background: '#fff', border: '1px solid #ccd6e5' }}>
                {c}
                {companies.length > 1 && (
                  <button aria-label={`${t.aliasManagerDelete} ${c}`} onClick={() => removeCompany(c)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#c81e1e', padding: 0, fontSize: 13, lineHeight: 1 }}>×</button>
                )}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className={styles.formGrid} style={grid2}>
        <div>
          <label style={fieldLabel}>AWB #</label>
          <input aria-label={t.awbRequired} value={awb} onChange={(e) => setAwb(e.target.value)} placeholder="217-08953641" style={fieldInput} />
        </div>
        <div>
          <label style={fieldLabel}>{t.invoice}</label>
          <input aria-label={t.invoice} value={invoice} onChange={(e) => setInvoice(e.target.value)} placeholder="217-08953641" style={fieldInput} />
        </div>
      </div>

      <div className={styles.formGrid} style={grid2}>
        <div>
          <label style={fieldLabel}>{t.date}</label>
          <input aria-label={t.date} value={date} onChange={(e) => setDate(e.target.value)} placeholder="2026/05/10" style={fieldInput} />
        </div>
        <div></div>
      </div>

      <div style={{ fontSize: 13, fontWeight: 600, color: '#526580', textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: 8, marginBottom: 10 }}>
        {t.weights}
      </div>

      <div className={styles.formGrid} style={grid2}>
        <div>
          <label style={fieldLabel}>{t.gwLabel}</label>
          <input aria-label={t.gwLabel} value={gw} onChange={(e) => setGw(e.target.value)} placeholder="138" inputMode="decimal" style={fieldInput} />
        </div>
        <div>
          <label style={fieldLabel}>{t.cwLabel}</label>
          <input aria-label={t.cwLabel} value={cw} onChange={(e) => setCw(e.target.value)} placeholder="190" inputMode="decimal" style={fieldInput} />
        </div>
      </div>

      <div className={styles.formGrid} style={grid2}>
        <div>
          <label style={fieldLabel}>{t.priceLabel}</label>
          <input aria-label={t.priceLabel} value={uPrice1} onChange={(e) => setUPrice1(e.target.value)} placeholder="1.85" inputMode="decimal" style={fieldInput} />
        </div>
        <div>
          <label style={fieldLabel}>{t.totalLabel}</label>
          <input aria-label={t.totalLabel} value={total} onChange={(e) => setTotal(e.target.value)} placeholder="676.13" inputMode="decimal" style={fieldInput} />
        </div>
      </div>

      {/* Live preview of the two 운송료 lines */}
      {(total !== '' && cw !== '' && uPrice1 !== '') && (
        <div style={{ background: '#f4f7fb', border: '1px solid #dce4ef', borderRadius: 8, padding: '10px 14px', marginBottom: 12, fontSize: 13 }}>
          <div style={{ fontWeight: 600, marginBottom: 6, color: '#526580' }}>{t.previewCharges}</div>
          <div className={styles.chargesScroll} style={{ display: 'grid', minWidth: 0, gridTemplateColumns: 'auto minmax(120px, 1fr) auto', gap: '4px 12px', fontVariant: 'tabular-nums' }}>
            <span style={{ color: '#526580' }}>{t.charge1}</span>
            <span>J={cwNum} × K={uPrice1Num}</span>
            <span style={{ fontWeight: 600 }}>= {t1.toFixed(2)} USD</span>
            <span style={{ color: '#526580' }}>{t.charge2}</span>
            <span>J=1 × K={uPrice2.toFixed(2)}</span>
            <span style={{ fontWeight: 600, color: t2 < 0 ? '#c81e1e' : 'inherit' }}>= {t2.toFixed(2)} USD</span>
            <span style={{ color: '#526580', borderTop: '1px solid #ccd6e5', paddingTop: 4 }}>{t.total}</span>
            <span style={{ borderTop: '1px solid #ccd6e5', paddingTop: 4 }}></span>
            <span style={{ fontWeight: 700, borderTop: '1px solid #ccd6e5', paddingTop: 4, color: totalMatches ? '#057a55' : '#c81e1e' }}>
              {computed.toFixed(2)} {totalMatches ? '✓' : `≠ ${totalNum.toFixed(2)}`}
            </span>
          </div>
        </div>
      )}

      {/* Validation errors */}
      {errors.length > 0 && (
        <div style={{ background: '#fde8e8', border: '1px solid #f8b4b4', borderRadius: 8, padding: '10px 14px', marginBottom: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#9b1c1c', marginBottom: 4 }}>{t.validationTitle}</div>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: '#9b1c1c' }}>
            {errors.map((e, i) => <li key={i}>{e}</li>)}
          </ul>
        </div>
      )}

      <button onClick={onDownload} disabled={!canDownload || !xlsxLib}
        style={{
          padding: '10px 20px', borderRadius: 8, fontSize: 14, fontWeight: 500,
          cursor: canDownload && xlsxLib ? 'pointer' : 'not-allowed',
          border: '1px solid #2457c5',
          background: canDownload && xlsxLib ? '#2457c5' : '#ccc',
          color: '#fff', opacity: canDownload && xlsxLib ? 1 : 0.5,
        }}>
        {t.generate} ⬇
      </button>
    </>
  );
}

export default AWBPanel;
export { AWBPanel };
