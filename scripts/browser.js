/* 取得可用的 Chromium 啟動參數（含軟體 WebGL，供截圖與版面巡檢使用）。 */
'use strict';
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
function findExe() {
  if (process.env.PW_EXE) return process.env.PW_EXE;
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  try {
    for (const d of fs.readdirSync(base).filter((n) => n.startsWith('chromium_headless_shell')).sort().reverse()) {
      const dir = path.join(base, d);
      for (const sub of fs.readdirSync(dir)) {
        const exe = path.join(dir, sub, 'chrome-headless-shell');
        if (fs.existsSync(exe)) return exe;
      }
    }
  } catch (e) { /* 使用 Playwright 預設 */ }
  return undefined;
}
async function launch() {
  const executablePath = findExe();
  return chromium.launch({ executablePath, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
}
module.exports = { launch };
