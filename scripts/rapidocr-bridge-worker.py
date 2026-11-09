"""Owner-PC free OCR worker. Uses existing ingest authentication; no ERP calls."""
import json,os,pathlib,subprocess,sys,time,urllib.request,urllib.parse
BASE=os.environ.get('NENOVAWEB_BASE','https://nenovaweb.com').rstrip('/')
origin=urllib.parse.urlsplit(BASE)
local_ok=origin.scheme=='http' and origin.hostname=='127.0.0.1' and origin.port and not origin.username and not origin.password and not origin.path and not origin.query and not origin.fragment
if BASE!='https://nenovaweb.com' and not local_ok:
    raise RuntimeError('Unsupported OCR server origin')
URL=BASE+'/api/import/tools/free-ocr-worker'

def token():
    value=os.environ.get('ORBIT_DRIVE_INGEST_TOKEN','').strip()
    if value:return value
    config=json.loads((pathlib.Path.home()/'.orbit-config.json').read_text(encoding='utf-8-sig'))
    request=urllib.request.Request('https://mindmap-viewer-production-adb2.up.railway.app/api/daemon/nenova-ingest-config',headers={'Authorization':'Bearer '+config['token']})
    with urllib.request.urlopen(request,timeout=30) as response:data=json.load(response)
    if not data.get('enabled') or not data.get('token'):raise RuntimeError('Ingest authentication unavailable')
    return data['token']

def request(method,auth,payload=None):
    req=urllib.request.Request(URL,data=None if payload is None else json.dumps(payload).encode(),method=method,headers={'Authorization':'Bearer '+auth,'Content-Type':'application/json'})
    with urllib.request.urlopen(req,timeout=60) as response:return json.load(response)

def once(auth):
    job=request('GET',auth).get('job')
    if not job:return False
    body={k:job[k] for k in ['jobId','claimToken','sourceHash']}
    try:
        result=subprocess.run([sys.executable,str(pathlib.Path(__file__).with_name('rapidocr-extract.py'))],input=json.dumps({'pdfBase64':job['pdfBase64'],'sourceHash':job['sourceHash']}),text=True,encoding='utf-8',capture_output=True,timeout=600)
        if result.returncode:raise RuntimeError('OCR child failed')
        body['result']=json.loads(result.stdout)
        request('POST',auth,body)
        print('free OCR completed',job['jobId'],len(body['result']['pages']),'pages',flush=True)
    except Exception:
        body.pop('result',None);body['error']=True
        try:request('POST',auth,body)
        except Exception:pass
        print('free OCR job failed; no paid fallback',job['jobId'],flush=True)
    return True

if __name__=='__main__':
    auth=token()
    while True:
        try:worked=once(auth)
        except Exception:worked=False;print('free OCR connection unavailable',flush=True)
        if '--once' in sys.argv:break
        time.sleep(2 if worked else 10)
