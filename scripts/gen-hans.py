#!/usr/bin/env python3
"""由 public/js/locales.js 的繁體原文 key，以 OpenCC（tw2sp，含兩岸用語）產生 public/js/locales-hans.js。
用法：pip install opencc-python-reimplemented && python3 scripts/gen-hans.py
新增 t('…') 字串後，先在 locales.js 補英文，再跑這支；個別用語不理想請寫進 OVERRIDES，不要手改產出檔。"""
import json, os, subprocess, sys, tempfile
import opencc

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
OVERRIDES = {}  # key -> 手動指定的簡體
POST = [('缺省', '默认')]  # OpenCC 把「預設」轉成「缺省」，這裡統一改回常用的「默认」

src = os.path.join(ROOT, 'public', 'js', 'locales.js')
with tempfile.TemporaryDirectory() as d:
    tmp = os.path.join(d, 'l.mjs')
    open(tmp, 'w', encoding='utf8').write(open(src, encoding='utf8').read())
    out = subprocess.check_output(['node', '-e', "import(process.argv[1]).then(m=>console.log(JSON.stringify(Object.keys(m.EN))))", tmp])
keys = json.loads(out)
cc = opencc.OpenCC('tw2sp')
lines = ['/* 简体中文（由 scripts/gen-hans.py 以 OpenCC tw2sp 產生，請勿手改；用語調整寫在該腳本的 OVERRIDES）。 */', 'export const HANS = {']
for k in keys:
    v = OVERRIDES.get(k)
    if v is None:
        v = cc.convert(k.split('|')[0] if '|' in k else k)
        for a, b in POST:
            v = v.replace(a, b)
    lines.append('  %s: %s,' % (json.dumps(k, ensure_ascii=False), json.dumps(v, ensure_ascii=False)))
lines.append('};\n')
open(os.path.join(ROOT, 'public', 'js', 'locales-hans.js'), 'w', encoding='utf8').write('\n'.join(lines))
print('已產生 %d 筆' % len(keys), file=sys.stderr)
