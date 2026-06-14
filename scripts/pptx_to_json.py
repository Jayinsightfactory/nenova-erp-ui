#!/usr/bin/env python3
"""PPTX → flat products JSON (stdout). 카달로그 추출기 app.py spatial matching."""
import os, sys, json, base64, tempfile

def main():
    if len(sys.argv) < 2:
        print('usage: pptx_to_json.py <file.pptx>', file=sys.stderr)
        sys.exit(2)

    pptx_path = os.path.abspath(sys.argv[1])
    if not os.path.isfile(pptx_path):
        print(f'not found: {pptx_path}', file=sys.stderr)
        sys.exit(1)

    root = os.environ.get('CATALOG_EXTRACTOR_DIR') or os.path.join(
        os.path.dirname(__file__), '..', '_catalog-ref-browser'
    )
    root = os.path.abspath(root)
    if not os.path.isdir(root):
        print(f'extractor dir missing: {root}', file=sys.stderr)
        sys.exit(1)

    os.chdir(root)
    sys.path.insert(0, root)

    from app import load_pptx, _cache

    ok, msg = load_pptx(pptx_path, force=True, use_render_crop=True)
    if not ok:
        print(msg, file=sys.stderr)
        sys.exit(1)

    out = []
    for slide in _cache.get('slides_data') or []:
        for p in slide.get('products') or []:
            out.append({
                'name': p.get('name') or '',
                'eng_name': p.get('eng_name') or '',
                'label': f"{p.get('eng_name') or ''} {p.get('name') or ''}".strip(),
                'blob_b64': p.get('blob_b64') or '',
            })

    json.dump(out, sys.stdout, ensure_ascii=False)

if __name__ == '__main__':
    main()
