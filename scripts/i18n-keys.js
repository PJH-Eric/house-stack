/* 掃描 public/js 內所有 t('…') 與伺服器訊息，列出需要翻譯的繁中原文（供字典完整性測試與維護用）。 */
'use strict';
const fs = require('fs');
const path = require('path');
const CJK = /[\u4e00-\u9fff]/;
function unescapeJs(s) { return s.replace(/\\(['"\\n])/g, (m, c) => (c === 'n' ? '\n' : c)); }
function clientKeys(root) {
  const dir = path.join(root, 'public', 'js');
  const keys = new Set();
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.js') && !/^locales/.test(n))) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    const re = /(?<![\w$.])t\(\s*(?:'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)")/g;
    let m;
    while ((m = re.exec(src))) { const k = unescapeJs(m[1] != null ? m[1] : m[2]); if (CJK.test(k)) keys.add(k); }
  }
  return [...keys];
}
/* 伺服器送出的訊息字面值（lib/rooms.js、server.js 內的中文字串） */
function serverKeys(root) {
  const keys = new Set();
  for (const f of ['lib/rooms.js', 'server.js']) {
    const src = fs.readFileSync(path.join(root, f), 'utf8');
    const re = /(['"`])((?:(?!\1)[^\\\n]|\\.)*?)\1/g;
    let m;
    while ((m = re.exec(src))) {
      let k = m[2];
      if (!CJK.test(k)) continue;
      if (m[1] === '`') k = k.replace(/\$\{([^}]*)\}/g, (x, e) => '{' + (/^[\w.]+$/.test(e) ? e.split('.').pop() : 'v') + '}');
      keys.add(unescapeJs(k));
    }
  }
  return [...keys];
}
module.exports = { clientKeys, serverKeys };
if (require.main === module) {
  const root = path.join(__dirname, '..');
  const out = { client: clientKeys(root), server: serverKeys(root) };
  console.log(JSON.stringify(out, null, 1));
}
