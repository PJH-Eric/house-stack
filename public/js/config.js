/*
 * 單一設定模組：前端連線位置只從這裡取得。
 * 值來自 env.js（window.__GAME_CONFIG__），由部署流程以 GAME_SERVER_URL 注入。
 * 本機開發（localhost）未設定時使用同源；production 未設定時不回退到 localhost，改為顯示可讀錯誤。
 */
const raw = (window.__GAME_CONFIG__ && window.__GAME_CONFIG__.serverUrl) || '';
const isLocal = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);

function validate(u) {
  try {
    const x = new URL(u);
    if (!/^https?:$/.test(x.protocol)) return null;
    if (!isLocal && x.protocol !== 'https:') return null; // production 必須 HTTPS/WSS
    return x.origin;
  } catch (e) { return null; }
}

let serverUrl = null, error = null;
if (raw) {
  serverUrl = validate(raw);
  if (!serverUrl) error = `GAME_SERVER_URL 格式不正確：${raw}（production 需為 https:// 開頭）`;
} else if (isLocal) {
  serverUrl = location.origin;
} else if (location.protocol.startsWith('http') && location.port === '' && !/github\.io$/.test(location.hostname)) {
  serverUrl = location.origin; // 前後端同網域部署
} else {
  error = '尚未設定線上伺服器（GAME_SERVER_URL）。單機與對電腦仍可遊玩。';
}

export const CONFIG = { serverUrl, error, onlineAvailable: !!serverUrl };
