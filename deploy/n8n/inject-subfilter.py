#!/usr/bin/env python3
# n8n 서브도메인 nginx conf의 proxy(location, 5678) 블록에 한글 오버레이 sub_filter 주입.
# 사용: python3 inject-subfilter.py <nginx_conf_path>
# - n8n.nenovaweb.com → 127.0.0.1:5678 프록시 location 의 닫는 중괄호 앞에 sub_filter 삽입
# - 이미 주입돼 있으면 변경 없이 종료(0)
# 종료코드: 0=주입/이미존재, 3=대상 블록 없음, 4=인자/파일 오류
import sys
import re

INJECT = (
    "\n        # --- n8n 한글 오버레이 (auto-added) ---\n"
    "        proxy_set_header Accept-Encoding \"\";\n"
    "        sub_filter '</body>' '<script defer src=\"https://nenovaweb.com/n8n-ko/translate.js\"></script></body>';\n"
    "        sub_filter_once on;\n"
    "        sub_filter_types text/html;\n"
)


def location_blocks(text):
    for m in re.finditer(r'location\b[^{]*\{', text):
        start = m.end() - 1  # '{'
        depth = 0
        for j in range(start, len(text)):
            if text[j] == '{':
                depth += 1
            elif text[j] == '}':
                depth -= 1
                if depth == 0:
                    yield (start + 1, j)  # (본문시작, 닫는 '}' index)
                    break


def main():
    if len(sys.argv) != 2:
        print('usage: inject-subfilter.py <conf>')
        return 4
    conf = sys.argv[1]
    try:
        s = open(conf, encoding='utf-8').read()
    except OSError as e:
        print('FILE_ERROR', e)
        return 4

    if 'n8n-ko/translate.js' in s:
        print('ALREADY_PRESENT')
        return 0

    target = None
    for bo, be in location_blocks(s):
        if '5678' in s[bo:be]:
            target = (bo, be)
            break
    if target is None:
        print('NO_PROXY_LOCATION')
        return 3

    bo, be = target
    new = s[:be] + INJECT + s[be:]
    open(conf, 'w', encoding='utf-8').write(new)
    print('INJECTED')
    return 0


if __name__ == '__main__':
    sys.exit(main())
