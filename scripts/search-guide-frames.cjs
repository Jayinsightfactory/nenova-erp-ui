const fs=require('fs'),path=require('path'),{execFileSync}=require('child_process');
const registry=JSON.parse(fs.readFileSync('config/workflow-guides.json'));
const ids=process.argv.slice(2);
for(const id of ids){
 const workflow=registry.workflows.find(w=>w.id===id),guide=workflow.guides[0],proof=JSON.parse(fs.readFileSync('public'+guide.proof));
 const shots=proof.presentation?.focusShots||[];if(!shots.length)throw Error(id+': missing actual camera shots');
 const first=shots[0],middle=shots[Math.floor(shots.length/2)],last=shots.at(-1);
 const times=[.3,first.start+1.8,first.end+.3,middle.start+1.8,middle.end+.3,last.start+1.8,last.end+.3,proof.duration-3,proof.duration-.3].map(t=>Math.max(.1,Math.min(proof.duration-.1,t)));
 const dir=path.join('.verify','search-guide-frames',id);fs.mkdirSync(dir,{recursive:true});
 for(let i=0;i<times.length;i++)execFileSync('ffmpeg',['-y','-loglevel','error','-ss',String(times[i]),'-i','public'+guide.src,'-frames:v','1','-vf','scale=640:360',path.join(dir,`frame-${String(i).padStart(2,'0')}.png`)],{windowsHide:true});
 execFileSync('ffmpeg',['-y','-loglevel','error','-i',path.join(dir,'frame-%02d.png'),'-vf','tile=3x3','-frames:v','1',path.join(dir,'contact.png')],{windowsHide:true});
 fs.writeFileSync(path.join(dir,'times.json'),JSON.stringify({duration:proof.duration,times,shots},null,2)+'\n');console.log('Extracted',id,proof.duration);
}
