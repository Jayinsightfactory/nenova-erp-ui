# scripts/docling-bridge-worker.py
# owner PC 상주 docling 워커(기술레이더 1호 채택, 2026-11-04).
# 네노바웹 /api/import/tools/docling-bridge 를 폴링해 PDF를 받아 docling으로 표를 뽑아 되돌린다.
# 실행(owner PC): C:\Users\USER\nenova-pm\radar-pilot\venv\Scripts\python.exe 이 파일 경로
# 환경변수: ORBIT_DRIVE_INGEST_TOKEN(필수), NENOVAWEB_BASE(기본 https://nenovaweb.com), DOCLING_POLL_SEC(기본 15)
# 서류는 네노바웹 서버와 이 PC 사이에서만 오가며 외부 서비스로 전송되지 않는다.
import base64
import json
import os
import socket
import sys
import tempfile
import time
import traceback
import urllib.request

BASE = os.environ.get("NENOVAWEB_BASE", "https://nenovaweb.com").rstrip("/")
TOKEN = os.environ.get("ORBIT_DRIVE_INGEST_TOKEN", "").strip()
POLL_SEC = max(5, int(os.environ.get("DOCLING_POLL_SEC", "15") or 15))
URL = BASE + "/api/import/tools/docling-bridge"
WORKER = "docling-bridge/" + socket.gethostname()

def http(method, url, body=None, timeout=120):
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers={
        "Authorization": "Bearer " + TOKEN,
        "Content-Type": "application/json",
    })
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))

def log(*parts):
    print(time.strftime("%Y-%m-%d %H:%M:%S"), *parts, flush=True)

def process(job):
    sha = job["sha"]
    log("job", sha[:12], job.get("country"), "pdf", len(job.get("pdfBase64", "")) // 1024, "KB(b64)")
    pdf_path = None
    try:
        from docling.document_converter import DocumentConverter
        fd, pdf_path = tempfile.mkstemp(suffix=".pdf")
        with os.fdopen(fd, "wb") as f:
            f.write(base64.b64decode(job["pdfBase64"]))
        t0 = time.time()
        converter = DocumentConverter()
        result = converter.convert(pdf_path)
        doc = result.document
        markdown = doc.export_to_markdown()
        tables = []
        for t in doc.tables:
            try:
                tables.append(t.export_to_dataframe(doc=doc).to_dict(orient="records"))
            except Exception:
                tables.append([])
        sec = round(time.time() - t0, 1)
        http("POST", URL, {"sha": sha, "ok": True, "markdown": markdown, "tables": tables, "sec": sec, "worker": WORKER}, timeout=180)
        log("done", sha[:12], f"{sec}s", f"{len(tables)} tables", f"{len(markdown)} chars")
    except Exception as e:
        log("fail", sha[:12], repr(e))
        traceback.print_exc()
        try:
            http("POST", URL, {"sha": sha, "ok": False, "error": str(e)[:400], "worker": WORKER}, timeout=60)
        except Exception:
            pass
    finally:
        if pdf_path:
            try:
                os.unlink(pdf_path)
            except OSError:
                pass

def main():
    if not TOKEN:
        print("ORBIT_DRIVE_INGEST_TOKEN 환경변수가 없습니다.", file=sys.stderr)
        sys.exit(1)
    log("docling bridge worker start", URL, "poll", POLL_SEC, "s")
    while True:
        try:
            r = http("GET", URL + "?action=claim", timeout=120)
            job = r.get("job")
            if job:
                process(job)
                continue  # 큐가 비어 있는지 바로 재확인
        except Exception as e:
            log("poll error", repr(e))
        time.sleep(POLL_SEC)

if __name__ == "__main__":
    main()
