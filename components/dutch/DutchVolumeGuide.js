import { useEffect, useState } from 'react';
import { DUTCH_GUIDE_KEY, dutchGuideEnabled, dutchGuideStep } from '../../lib/dutchVolumeGuide';

export default function DutchVolumeGuide({ state, onNext }) {
  const [enabled, setEnabled] = useState(true);
  const step = dutchGuideStep(state);
  useEffect(() => { try { setEnabled(dutchGuideEnabled(localStorage.getItem(DUTCH_GUIDE_KEY))); } catch {} }, []);
  useEffect(() => {
    if (!enabled || !step.target) return;
    const target = document.querySelector(`[data-volume-guide="${step.target}"]`);
    if (!target) return;
    target.setAttribute('data-guide-active', 'true');
    target.setAttribute('aria-describedby', 'dutch-guide-message');
    return () => { target.removeAttribute('data-guide-active'); target.removeAttribute('aria-describedby'); };
  }, [enabled, step.target, state.hasWork]);
  const toggle = () => {
    const next = !enabled; setEnabled(next);
    try { localStorage.setItem(DUTCH_GUIDE_KEY, String(next)); } catch {}
  };
  const locate = () => {
    const target = document.querySelector(`[data-volume-guide="${step.target}"]`);
    target?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    const control = target?.matches('button,input,select') ? target : target?.querySelector('button:not(:disabled),input:not(:disabled),select:not(:disabled)');
    control?.focus({ preventScroll: true });
  };
  return <aside className="guide" aria-label="단계별 작업 가이드">
    {enabled && <div className="bubble" id="dutch-guide-message" role="status"><span>{step.text}</span>{step.target && <button onClick={locate}>위치로 이동</button>}{step.next && <button disabled={step.id === 'scope' && !state.week} onClick={() => onNext(step.id)}>{step.next}</button>}</div>}
    <button aria-pressed={enabled} onClick={toggle}>{enabled ? '가이드 끄기' : '가이드 켜기'}</button>
    <style jsx>{`.guide{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:6px 0}.bubble{position:relative;background:#fff8df;border:1px solid #d5a925;border-radius:9px;padding:7px 10px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:13px;color:#493807}.bubble:before{content:'';position:absolute;top:-6px;left:20px;width:10px;height:10px;background:#fff8df;border-left:1px solid #d5a925;border-top:1px solid #d5a925;transform:rotate(45deg)}button{border:1px solid #a5b6cb;border-radius:4px;background:#fff;padding:5px 9px;cursor:pointer}button:focus-visible{outline:3px solid #1763db;outline-offset:2px}`}</style>
    <style jsx global>{`[data-guide-active="true"]{outline:3px solid #e9a300!important;outline-offset:3px;scroll-margin:80px}`}</style>
  </aside>;
}
