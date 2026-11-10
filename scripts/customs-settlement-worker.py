"""Dedicated first-page-only Korean OCR queue worker. No AI provider or ERP writes.

Private PDF/PNG files are held in a TemporaryDirectory and removed after each claim.
Only the permitted middle-page crop is OCRed; full OCR text is never persisted.
"""
import base64, hashlib, json, math, os, pathlib, subprocess, sys, tempfile, time, urllib.parse, urllib.request
import pypdfium2 as pdfium

HERE = pathlib.Path(__file__).resolve().parent
NO_WINDOW = getattr(subprocess,'CREATE_NO_WINDOW',0)
_ascii_engine = None
BASE = os.environ.get('NENOVAWEB_BASE', 'https://nenovaweb.com').rstrip('/')
origin = urllib.parse.urlsplit(BASE)
if BASE != 'https://nenovaweb.com' and not (origin.scheme == 'http' and origin.hostname == '127.0.0.1' and origin.port and not origin.username and not origin.password and not origin.path and not origin.query and not origin.fragment):
    raise RuntimeError('Unsupported settlement worker origin')
URL = BASE + '/api/sales/customs-settlement-worker'

def token():
    value = os.environ.get('ORBIT_DRIVE_INGEST_TOKEN', '').strip()
    if value: return value
    config = json.loads((pathlib.Path.home()/'.orbit-config.json').read_text(encoding='utf-8-sig'))
    req = urllib.request.Request('https://mindmap-viewer-production-adb2.up.railway.app/api/daemon/nenova-ingest-config', headers={'Authorization': 'Bearer '+config['token']})
    with urllib.request.urlopen(req, timeout=30) as response: data = json.load(response)
    if not data.get('enabled') or not data.get('token'): raise RuntimeError('Worker authentication unavailable')
    return data['token']

def request(method, auth, body=None):
    req = urllib.request.Request(URL, data=None if body is None else json.dumps(body).encode(), method=method, headers={'Authorization':'Bearer '+auth,'Content-Type':'application/json'})
    with urllib.request.urlopen(req, timeout=60) as response: return json.load(response)

def parse_ok(page, digest):
    # Check the exact production parser locally; no values are printed or stored.
    program = "const fs=require('fs');const p=require('./lib/customsSettlementParser.cjs');try{const x=JSON.parse(fs.readFileSync(0,'utf8'));p.parseSettlementPage(x.page,x.hash);process.stdout.write('OK')}catch{process.stdout.write('REVIEW')}"
    check = subprocess.run(['node','-e',program], cwd=HERE.parent, input=json.dumps({'page':page,'hash':digest}), encoding='utf-8', capture_output=True, timeout=15,creationflags=NO_WINDOW)
    return check.returncode == 0 and check.stdout == 'OK'

def metadata_retry(image,page,digest):
    """One same-page ASCII header crop; no identifier character substitution."""
    global _ascii_engine
    import rapidocr
    from rapidocr import RapidOCR
    if _ascii_engine is None:
        models=pathlib.Path(rapidocr.__file__).parent/'models'
        _ascii_engine=RapidOCR(params={'Det.model_path':str(models/'PP-OCRv6_det_small.onnx'),'Rec.model_path':str(models/'PP-OCRv6_rec_small.onnx'),'Cls.model_path':str(models/'ch_ppocr_mobile_v2.0_cls_mobile.onnx'),'EngineConfig.onnxruntime.intra_op_num_threads':2,'EngineConfig.onnxruntime.inter_op_num_threads':1})
    width,height=image.size;left,top,right,bottom=int(width*.38),int(height*.25),int(width*.68),int(height*.32)
    crop=image.crop((left,top,right,bottom))
    try:result=_ascii_engine(crop)
    finally:crop.close()
    items=[]
    if result.boxes is None:return page
    for box,string,confidence in zip(result.boxes,result.txts,result.scores):
        xs=[float(p[0]) for p in box];ys=[float(p[1]) for p in box]
        items.append({'str':string,'x':left+min(xs),'y':height-top-max(ys),'width':max(xs)-min(xs),'height':max(ys)-min(ys),'confidence':float(confidence)})
    import re
    identifier=lambda rows:{r['str'] for r in rows if re.fullmatch(r'\d{5}-\d{2}-\d{6}[A-Z]',r['str'])}
    before,after=identifier(page['items']),identifier(items)
    if before and after and before!=after:return page
    awbs=lambda rows:{r['str'] for r in rows if re.fullmatch(r'\d{11}',r['str']) and left<=r['x']<right and height-bottom<=r['y']<=height-top}
    old_awb,new_awb=awbs(page['items']),awbs(items)
    if old_awb and new_awb and old_awb!=new_awb:return page
    merged={**page,'items':[r for r in page['items'] if not left<=r['x']<right or not height-bottom<=r['y']<=height-top]+items}
    return merged if parse_ok(merged,digest) else page

def extract(job):
    if job.get('firstPageOnly') is not True: raise ValueError('First-page-only scope required')
    data = base64.b64decode(job['pdfBase64'], validate=True)
    digest = hashlib.sha256(data).hexdigest()
    if digest != job['sourceHash'] or len(data) > 12*1024*1024 or not data.startswith(b'%PDF-'): raise ValueError('Source identity mismatch')
    document = pdfium.PdfDocument(data)
    try:
        count = len(document)
        if not 1 <= count <= 100: raise ValueError('PDF page count outside supported range')
        page = document[0]  # Do not enumerate or render remaining pages.
        try:
            width, height = page.get_size()
            if not all(math.isfinite(n) and 0<n<=20000 for n in (width,height)) or not .5<=width/height<=.9:
                raise ValueError('Unsupported settlement page dimensions')
            best = None
            with tempfile.TemporaryDirectory(prefix='nenova-customs-') as temporary:
                for max_height in (2000, 3000):
                    bitmap = page.render(scale=max_height/height)
                    image = bitmap.to_pil()
                    try:
                        full_width, full_height = image.size
                        top, bottom = int(full_height*.25), int(full_height*.67)
                        crop = image.crop((0, top, full_width, bottom))
                        image_path = pathlib.Path(temporary)/'first-page-body.png'
                        try: crop.save(image_path)
                        finally: crop.close()
                        output = subprocess.run(['powershell.exe','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',str(HERE/'windows-customs-ocr.ps1'),'-ImagePath',str(image_path),'-FullWidth',str(full_width),'-FullHeight',str(full_height),'-CropTop',str(top)], capture_output=True, encoding='utf-8-sig', timeout=120,creationflags=NO_WINDOW)
                        if output.returncode: raise RuntimeError('Korean OCR failed')
                        best = json.loads(output.stdout)
                        if parse_ok(best, digest): break
                        if max_height==3000:best=metadata_retry(image,best,digest)
                    finally: image.close(); bitmap.close()
            return {'sourceHash':digest,'pageCount':count,'pages':[best],'ocrPages':1,'providerCalls':0}
        finally: page.close()
    finally: document.close()

def once(auth):
    job = request('GET', auth).get('job')
    if not job: return False
    body = {key:job[key] for key in ['jobId','index','sourceHash','claimToken']}
    try:
        body['result'] = extract(job)
        request('POST', auth, body)
        print('settlement first-page job completed', job['jobId'], job['index'], flush=True)
    except Exception:
        body.pop('result', None); body['error'] = True
        try: request('POST', auth, body)
        except Exception: pass
        print('settlement first-page job needs review; no paid fallback', flush=True)
    return True

if __name__ == '__main__':
    auth = None; failures = 0
    while True:
        try:
            if not auth: auth=token()
            worked = once(auth); failures=0
        except Exception:
            worked=False;auth=None;failures=min(failures+1,6)
            print('settlement worker connection unavailable; retrying without exposing authentication',flush=True)
            if '--once' in sys.argv:sys.exit(1)
        if '--once' in sys.argv: break
        time.sleep(min(60,10*max(failures,1)) if failures else 2 if worked else 10)
