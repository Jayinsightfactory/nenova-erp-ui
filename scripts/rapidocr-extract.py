"""Local PDF text + RapidOCR evidence. No network, AI API, or ERP dependency.
stdin: {pdfBase64, sourceHash}; stdout: bounded positioned pages JSON.
"""
import base64,contextlib,hashlib,json,math,pathlib,socket,sys,time
import pypdfium2 as pdfium

def deny_network(*args,**kwargs):
    raise RuntimeError('Network is disabled in OCR extraction')

socket.create_connection=deny_network
socket.socket.connect=deny_network

def extract_text(page):
    text=page.get_textpage()
    items=[]
    current=None
    for i in range(text.count_chars()):
        char=text.get_text_range(i,1)
        if not char or char.isspace():
            if current:
                items.append(current);current=None
            continue
        left,bottom,right,top=text.get_charbox(i)
        if current and (abs(current['y']-bottom)>3 or left-current['x']-current['width']>8 or left<current['x']):
            items.append(current);current=None
        if current:
            current['str']+=char
            current['width']=max(current['width'],right-current['x'])
            current['height']=max(current['height'],top-current['y'])
        else:
            current={'str':char,'x':left,'y':bottom,'width':max(0,right-left),'height':max(0,top-bottom),'method':'pdf-text'}
    if current:items.append(current)
    text.close()
    return items

def run(payload):
    data=base64.b64decode(payload['pdfBase64'],validate=True)
    digest=hashlib.sha256(data).hexdigest()
    if digest!=payload['sourceHash'] or len(data)>20*1024*1024 or not data.startswith(b'%PDF-'):
        raise ValueError('PDF source identity mismatch')
    document=pdfium.PdfDocument(data)
    if not 1<=len(document)<=72:raise ValueError('PDF page count outside supported range')
    engine=None;pages=[];start=time.perf_counter()
    for index in range(len(document)):
        page=document[index];width,height=page.get_size()
        items=extract_text(page)
        has_image=any(obj.type==3 for obj in page.get_objects())
        use_ocr=not items or (sum(len(x['str']) for x in items)<40 and has_image)
        if use_ocr:
            if engine is None:
                import rapidocr
                models=pathlib.Path(rapidocr.__file__).parent/'models'
                from rapidocr import RapidOCR
                engine=RapidOCR(params={
                    'Det.model_path':str(models/'PP-OCRv6_det_small.onnx'),
                    'Rec.model_path':str(models/'PP-OCRv6_rec_small.onnx'),
                    'Cls.model_path':str(models/'ch_ppocr_mobile_v2.0_cls_mobile.onnx'),
                    'EngineConfig.onnxruntime.intra_op_num_threads':2,
                    'EngineConfig.onnxruntime.inter_op_num_threads':1,
                })
            scale=min(3,2800/max(width,height))
            bitmap=page.render(scale=scale);image=bitmap.to_pil()
            result=engine(image)
            items=[]
            if result.boxes is not None:
                for box,string,score in zip(result.boxes,result.txts,result.scores):
                    xs=[float(p[0]) for p in box];ys=[float(p[1]) for p in box]
                    items.append({'str':string,'x':min(xs)/scale,'y':height-max(ys)/scale,'width':(max(xs)-min(xs))/scale,'height':(max(ys)-min(ys))/scale,'confidence':float(score),'method':'rapidocr'})
            image.close();bitmap.close()
        pages.append({'page':index+1,'width':width,'height':height,'method':'rapidocr' if use_ocr else 'pdf-text','items':items})
        page.close()
    document.close()
    return {'sourceHash':digest,'pages':pages,'seconds':round(time.perf_counter()-start,2),'engine':'RapidOCR/local-onnx','providerCalls':0,'erpWrites':0}

if __name__=='__main__':
    try:
        sys.stdout.reconfigure(encoding='utf-8');sys.stderr.reconfigure(encoding='utf-8')
        payload=json.load(sys.stdin)
        with contextlib.redirect_stdout(sys.stderr):result=run(payload)
        json.dump(result,sys.stdout,ensure_ascii=False)
    except Exception as error:
        # Do not print document text, server tokens, or arbitrary payloads.
        print(type(error).__name__+': local OCR extraction failed',file=sys.stderr)
        sys.exit(1)
