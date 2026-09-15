import {useRef} from 'react';
import {excludedTextRanges,toggleExcludedText} from '../../lib/pasteExcludeText';

export default function PasteExcludeHighlight({text,excludedLines=[],onExcludedLinesChange,title='제외 하이라이트',hint='단어·문구를 드래그해 제외 · 제외된 부분을 다시 선택하면 해제',embedded=false}) {
  const contentRef=useRef(null);
  const source=String(text||'');
  const ranges=excludedTextRanges(source,excludedLines);
  const finishSelection=()=>{
    const selection=window.getSelection();const root=contentRef.current;
    if(!selection||selection.isCollapsed||!selection.rangeCount||!root)return;
    const selected=selection.getRangeAt(0);
    if(!root.contains(selected.startContainer)||!root.contains(selected.endContainer))return;
    const prefix=selected.cloneRange();prefix.selectNodeContents(root);prefix.setEnd(selected.startContainer,selected.startOffset);
    const start=prefix.toString().length,end=start+selected.toString().length;
    onExcludedLinesChange?.(toggleExcludedText(source,excludedLines,start,end));
    selection.removeAllRanges();
  };
  const pieces=[];let offset=0;
  for(const range of ranges){if(range.start>offset)pieces.push(<span key={`text-${offset}`}>{source.slice(offset,range.start)}</span>);pieces.push(<mark key={`excluded-${range.start}`} data-excluded-word style={{background:'#ffe0b2',color:'#795548',textDecoration:'line-through'}}>{source.slice(range.start,range.end)}</mark>);offset=range.end;}
  if(offset<source.length)pieces.push(<span key={`text-${offset}`}>{source.slice(offset)}</span>);
  return <section className="paste-word-exclude" style={{border:'1px solid #cfd8dc',borderRadius:6,background:'#fff',marginTop:embedded?0:8,flex:embedded?'1 1 auto':undefined,minWidth:0,minHeight:embedded?120:undefined,display:'flex',flexDirection:'column'}}>
    <div style={{display:'flex',flexWrap:'wrap',gap:6,padding:'5px 8px',borderBottom:'1px solid #eceff1',fontSize:11,flexShrink:0}}><strong>{title}</strong><span>{hint}</span>{excludedLines.length>0&&<button type="button" onClick={()=>onExcludedLinesChange?.([])}>제외 전체 해제</button>}</div>
    <pre ref={contentRef} tabIndex={0} aria-label={title+' 단어 선택'} onMouseUp={finishSelection} onKeyUp={event=>{if(event.key==='Enter')finishSelection();}} style={{margin:0,padding:8,whiteSpace:'pre-wrap',overflowWrap:'anywhere',fontFamily:'monospace',fontSize:12,lineHeight:1.5,userSelect:'text',overflow:'auto',flex:1,minHeight:0,maxHeight:embedded?'none':280}}>{pieces}</pre>
  </section>;
}
