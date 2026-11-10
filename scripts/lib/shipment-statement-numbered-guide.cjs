// Presentation-only camera for the actual 1920x1080/100% browser capture.
// Raw UI is never reconstructed; final subtitles are composited AFTER the camera.
const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
const {createWorkflowGuideRecorder}=require('./workflow-guide-recorder.cjs');
const {sha256}=require('../check-workflow-guides.cjs');
const assTime=t=>{const c=Math.round(t*100),h=Math.floor(c/360000),m=Math.floor(c/6000)%60,s=Math.floor(c/100)%60;return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}.${String(c%100).padStart(2,'0')}`;};
const escaped=s=>String(s).replace(/\\/g,'\\\\').replace(/[{}]/g,'').replace(/\r?\n/g,'\\N');
async function createNumberedStatementGuide(page,options){
 const base=await createWorkflowGuideRecorder(page,options),started=performance.now(),camera=[];
 let step=0,title='',current=null;
 const time=()=>Math.max(0,(performance.now()-started)/1000);
 async function caption(text){
  await base.caption(`${step}. ${title}\n${text}`);
  await page.evaluate(()=>{const h=document.getElementById('nenova-guide-capture');h.querySelector('[data-guide-caption]').style.visibility='hidden';});
 }
 async function out(){
  if(!current)return;
  await base.pause(1000);current.holdEnd=time();await base.pause(750);current.end=time();current=null;
  await page.evaluate(()=>document.getElementById('statement-guide-target')?.remove());await base.pause(350);
 }
 async function focus(selector){
  if(current)await out();
  const element=await page.$(selector);if(!element)throw Error('Guide target missing: '+selector);
  await element.evaluate(n=>n.scrollIntoView({block:'center',inline:'nearest'}));
  const box=await element.boundingBox();if(!box||box.y<0||box.y+box.height>1060)throw Error('Guide target outside readable camera region: '+selector);
  await page.evaluate(({box,step})=>{
   const host=document.getElementById('nenova-guide-capture'),surface=document.querySelector('dialog[open]')??document.body;
   if(host.parentElement!==surface)surface.append(host);document.getElementById('statement-guide-target')?.remove();
   const target=document.createElement('div');target.id='statement-guide-target';
   target.style.cssText=`position:absolute;left:${Math.max(2,box.x-6)}px;top:${Math.max(2,box.y-6)}px;width:${box.width+12}px;height:${box.height+12}px;outline:3px solid #ffb300;border-radius:8px;box-shadow:0 0 0 3px #ffffffb0;pointer-events:none`;
   const badge=document.createElement('div');badge.textContent=String(step);badge.style.cssText='position:absolute;left:-8px;top:-34px;min-width:30px;height:28px;padding:0 6px;border-radius:14px;background:#163e6b;color:white;font-size:20px;font-weight:bold;text-align:center;line-height:28px';target.append(badge);host.append(target);
  },{box,step});
  await base.pause(950);current={step,start:time(),inEnd:0,holdEnd:0,end:0,cx:box.x+box.width/2,cy:box.y+box.height/2,zoom:1.35};camera.push(current);
  await base.pause(750);current.inEnd=time();await base.pause(650);
 }
 async function stop(){
  await out();const result=await base.stop();
  const raw=path.resolve('.verify/guide-recordings/shipment-statement-support.webm'),filterFile=path.resolve('.verify/guide-recordings/shipment-statement-camera.txt'),assFile=path.resolve('.verify/guide-recordings/shipment-statement-numbered.ass');
  const vtt=fs.readFileSync(result.captions,'utf8').replace(/\r\n/g,'\n'),stamp=t=>t.split(':').map(Number).reduce((s,n)=>s*60+n,0);
  const cues=vtt.split('\n\n').filter(s=>s.includes('-->')).map(s=>{const [times,...lines]=s.split('\n'),[a,b]=times.split(' --> ');return {start:stamp(a),end:stamp(b),text:lines.join('\n')};});
  const ass=['[Script Info]','ScriptType: v4.00+','PlayResX: 1920','PlayResY: 1080','WrapStyle: 0','[V4+ Styles]','Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding','Style: Caption,Malgun Gothic,29,&H00FFFFFF,&H00FFFFFF,&H001E293B,&H901E293B,0,0,0,0,100,100,0,0,3,11,0,2,100,100,26,1','Style: Step,Malgun Gothic,25,&H00FFFFFF,&H00FFFFFF,&H001E293B,&H901E293B,-1,0,0,0,100,100,0,0,3,8,0,7,220,24,8,1','[Events]','Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text'];
  for(const c of cues){ass.push(`Dialogue: 0,${assTime(c.start)},${assTime(c.end)},Caption,,0,0,0,,${/^[234]\./.test(c.text)?"{\\an8\\pos(960,70)}":""}${escaped(c.text)}`);ass.push(`Dialogue: 1,${assTime(c.start)},${assTime(c.end)},Step,,0,0,0,,${escaped(c.text.split('\n')[0])}`);}
  fs.writeFileSync(assFile,ass.join('\n')+'\n');
  const t='on/20',f=n=>Number(n.toFixed(4)),active=c=>`between(${t},${f(c.start)},${f(c.end)})`;
  const smooth=x=>`((${x})*(${x})*(3-2*(${x})))`;
  const weight=c=>`if(lt(${t},${f(c.inEnd)}),${smooth(`min(1,max(0,(${t}-${f(c.start)})/${f(c.inEnd-c.start)}))`)},if(lt(${t},${f(c.holdEnd)}),1,1-${smooth(`min(1,max(0,(${t}-${f(c.holdEnd)})/${f(c.end-c.holdEnd)}))`)}))`;
  const zoom='1'+camera.map(c=>`+if(${active(c)},${c.zoom-1}*${weight(c)},0)`).join('');
  const center=(axis,initial)=>camera.reduceRight((expr,c)=>`if(${active(c)},${f(c[axis])},${expr})`,String(initial));
  const assPath=assFile.replace(/\\/g,'/').replace(/:/g,'\\:').replace(/'/g,"\\'");
  const filter=`[0:v]fps=20,zoompan=z='${zoom}':x='max(0,min(iw-iw/zoom,${center('cx',960)}-iw/zoom/2))':y='max(0,min(ih-ih/zoom,${center('cy',540)}-ih/zoom/2))':d=1:s=1920x1080:fps=20,subtitles=filename='${assPath}'[out]`;
  fs.writeFileSync(filterFile,filter);
  fs.writeFileSync(path.resolve('.verify/guide-recordings/statement-camera-plan.json'),JSON.stringify({camera,result,raw,filterFile,assFile},null,2));
  execFileSync('ffmpeg',['-y','-hide_banner','-loglevel','error','-i',raw,'-/filter_complex',filterFile,'-map','[out]','-an','-c:v','libx264','-threads','2','-preset','medium','-crf','23','-pix_fmt','yuv420p','-movflags','+faststart',result.mp4],{windowsHide:true,timeout:300000});
  const actual=JSON.parse(execFileSync('ffprobe',['-v','error','-select_streams','v:0','-show_entries','stream=width,height,avg_frame_rate:format=duration','-of','json',result.mp4],{encoding:'utf8',windowsHide:true}));
  if(actual.streams[0].width!==1920||actual.streams[0].height!==1080)throw Error('Final numbered guide size mismatch');
  const proof=JSON.parse(fs.readFileSync(result.proofFile,'utf8'));proof.duration=Number(actual.format.duration);proof.videoSha256=sha256(fs.readFileSync(result.mp4));proof.camera={method:'post-production zoompan on actual 100% browser capture',maxZoom:1.35,captionAfterCamera:true,steps:result.chapters.map(c=>c.title),segments:camera};fs.writeFileSync(result.proofFile,JSON.stringify(proof,null,2)+'\n');
  return result;
 }
 return {...base,caption,focus,out,chapter:async(scenario,text)=>{step++;title=text;base.chapter(scenario,`${step}. ${text}`);await caption('전체 화면에서 번호로 표시한 조작 위치를 확인하세요.');},stop};
}
module.exports={createNumberedStatementGuide};
