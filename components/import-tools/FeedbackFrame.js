import {useEffect,useRef} from 'react';
import {bindAutoHeightFrame} from '../../lib/autoHeightFrame';

export default function FeedbackFrame({className}) {
  const frame = useRef(null);
  useEffect(() => bindAutoHeightFrame(frame.current), []);
  return <iframe ref={frame} className={className} title="기존 농장 불량·피드백 관리" src="/sales/farm-quality?popup=1"/>;
}
