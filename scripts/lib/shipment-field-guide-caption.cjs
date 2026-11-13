// Add a readable numbered caption to the actual Excel print-preview segment.
const fs=require('fs'),crypto=require('crypto'),{execFileSync}=require('child_process');
function finalize(root=process.cwd()){
const dir='public/guides/shipment-field-volume',proofFile=dir+'/support.proof.json',proof=JSON.parse(fs.readFileSync(proofFile));
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');if(proof.printPreviewCaption&&proof.videoSha256===hash(fs.readFileSync(dir+'/support.mp4')))return;
fs.mkdirSync('.verify/field-volume',{recursive:true});fs.writeFileSync('.verify/field-volume/caption-last.txt','4. 돈셀(2) 3 /5: 이전 2 · 이번 3 · 당일합계 5\n요일색 · 입고 5 · 출고 3 · 재고 1 · 잔량 3 확인');fs.writeFileSync('.verify/field-volume/caption-step.txt','4 단계');
const enable=`gte(t,${Math.max(0,proof.duration-7.2)})`,font="fontfile='C\\:/Windows/Fonts/malgun.ttf'";
const filter=`drawbox=x=0:y=955:w=1920:h=125:color=0x102847@0.95:t=fill:enable='${enable}',drawtext=${font}:textfile=.verify/field-volume/caption-last.txt:fontcolor=white:fontsize=28:line_spacing=10:x=40:y=975:enable='${enable}',drawbox=x=20:y=10:w=160:h=60:color=0x102847@0.95:t=fill:enable='${enable}',drawtext=${font}:textfile=.verify/field-volume/caption-step.txt:fontcolor=white:fontsize=30:x=35:y=23:enable='${enable}'`;
execFileSync('ffmpeg',['-y','-loglevel','error','-i',dir+'/support.mp4','-vf',filter,'-c:v','libx264','-preset','veryfast','-crf','22','-pix_fmt','yuv420p','-movflags','+faststart','.verify/field-volume/captioned.mp4'],{stdio:'pipe'});
fs.copyFileSync('.verify/field-volume/captioned.mp4',dir+'/support.mp4');proof.videoSha256=hash(fs.readFileSync(dir+'/support.mp4'));proof.printPreviewCaption={number:4,source:'actual Excel ReadOnly PDF rendered to PNG; captured in local browser',start:Math.max(0,proof.duration-7.2),end:proof.duration};fs.writeFileSync(proofFile,JSON.stringify(proof,null,2)+'\n');
}
module.exports={finalize};if(require.main===module){finalize();console.log('actual print preview caption PASS');}
