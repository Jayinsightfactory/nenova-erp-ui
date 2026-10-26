import { useEffect, useState } from 'react';
import { CHINA_GUIDE_KEY, chinaGuideEnabled, chinaGuideStep } from '../lib/chinaVolumeGuide';

export default function ChinaVolumeGuide({ state, onNext }) {
  const [enabled, setEnabled] = useState(true);
  const step = chinaGuideStep(state);
  useEffect(() => { try { setEnabled(chinaGuideEnabled(localStorage.getItem(CHINA_GUIDE_KEY))); } catch {} }, []);
  useEffect(() => {
    if (!enabled || !step.target) return;
    const target = document.querySelector(`[data-china-guide="${step.target}"]`);
    if (!target) return;
    const previous = target.getAttribute('aria-describedby');
    target.setAttribute('data-china-guide-active', 'true');
    target.setAttribute('aria-describedby', [previous, 'china-guide-message'].filter(Boolean).join(' '));
    return () => { target.removeAttribute('data-china-guide-active'); if (previous == null) target.removeAttribute('aria-describedby'); else target.setAttribute('aria-describedby', previous); };
  }, [enabled, step.target, state.scopeCurrent, state.preview]);
  const toggle = () => { const next = !enabled; setEnabled(next); try { localStorage.setItem(CHINA_GUIDE_KEY, String(next)); } catch {} };
  const locate = () => {
    const target = document.querySelector(`[data-china-guide="${step.target}"]`);
    target?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    const control = target?.matches('button,input,select') ? target : target?.querySelector('button:not(:disabled),input:not(:disabled),select:not(:disabled)');
    (control || target)?.focus({ preventScroll: true });
  };
  return <section className="china-guide" aria-label="중국 물량표 단계별 작업 가이드">
    {enabled && <div className="bubble" id="china-guide-message" role="status"><span>{step.text}</span>{step.target && <button type="button" onClick={locate}>위치로 이동</button>}{step.next && <button type="button" disabled={step.id === 'scope' && !state.week} onClick={() => onNext(step.id)}>{step.next}</button>}</div>}
    <button type="button" aria-pressed={enabled} onClick={toggle}>{enabled ? '가이드 끄기' : '가이드 켜기'}</button>
    <style jsx>{`.china-guide{display:flex;align-items:center;gap:8px;flex-wrap:wrap;flex:none;padding:7px 8px;min-width:0}.bubble{position:relative;background:#fff8df;border:1px solid #d5a925;border-radius:9px;padding:7px 10px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:13px;color:#493807;max-width:100%;overflow-wrap:anywhere}.bubble:before{content:'';position:absolute;top:-6px;left:20px;width:10px;height:10px;background:#fff8df;border-left:1px solid #d5a925;border-top:1px solid #d5a925;transform:rotate(45deg)}button{font:inherit;border:1px solid #a5b6cb;border-radius:4px;background:#fff;padding:5px 9px;cursor:pointer}button:focus-visible{outline:3px solid #1763db;outline-offset:2px}`}</style>
    <style jsx global>{`[data-china-guide-active="true"]{outline:3px solid #e9a300!important;outline-offset:3px;scroll-margin:80px}`}</style>
  </section>;
}
