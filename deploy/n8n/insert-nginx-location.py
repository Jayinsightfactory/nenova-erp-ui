#!/usr/bin/env python3
# nenovaweb nginx 설정에 n8n(/n8n/) 리버스 프록시 location 을 안전하게 삽입.
# 사용: python3 insert-nginx-location.py <nginx_conf_path> <snippet_path>
# - nenovaweb + 443 을 포함하는 server { } 블록의 닫는 중괄호 직전에 snippet 삽입
# - 이미 삽입돼 있으면(IDEMPOTENT) 변경 없이 종료코드 0
# 종료코드: 0=삽입/이미존재, 3=대상 블록 없음, 4=인자/파일 오류
import sys
import re


def server_blocks(text):
    """server { ... } 블록들의 (본문시작, 닫는중괄호index) 를 중괄호 매칭으로 산출."""
    for m in re.finditer(r'\bserver\b\s*\{', text):
        start = m.end() - 1  # '{' 위치
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
    if len(sys.argv) != 3:
        print('usage: insert-nginx-location.py <conf> <snippet>')
        return 4
    conf, snip = sys.argv[1], sys.argv[2]
    try:
        s = open(conf, encoding='utf-8').read()
        block = open(snip, encoding='utf-8').read()
    except OSError as e:
        print('FILE_ERROR', e)
        return 4

    if 'location ^~ /n8n/' in s:
        print('ALREADY_PRESENT')
        return 0

    # 1순위: 443 + nenovaweb + 기존 location 을 가진 server 블록(=실서비스 https 블록)
    target = None
    for bo, be in server_blocks(s):
        body = s[bo:be]
        if '443' in body and 'nenovaweb' in body and 'location' in body:
            target = (bo, be)
    # 2순위: 443 + nenovaweb
    if target is None:
        for bo, be in server_blocks(s):
            body = s[bo:be]
            if '443' in body and 'nenovaweb' in body:
                target = (bo, be)
                break

    if target is None:
        print('NO_443_BLOCK')
        return 3

    bo, be = target
    addition = "\n    # --- n8n reverse proxy (auto-added) ---\n" + block + "\n"
    new = s[:be] + addition + s[be:]
    open(conf, 'w', encoding='utf-8').write(new)
    print('INSERTED')
    return 0


if __name__ == '__main__':
    sys.exit(main())
