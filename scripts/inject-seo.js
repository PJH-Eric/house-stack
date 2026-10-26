'use strict';

const fs = require('fs');
const path = require('path');
const DEFAULT_GA_ID = 'G-PG79WZK8QY'; // 遊戲小小島全站共用的 GA4 資源；可用環境變數 GA_MEASUREMENT_ID 覆寫
const MARK = '<!--SEO:HEAD-->';
const END = '<!--SEO:END-->';
const esc = value => String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const safeJson = value => JSON.stringify(value).replace(/</g, '\\u003c');

function validate(cfg, gaId) {
  for (const key of ['id', 'siteUrl', 'title', 'description', 'lobbyUrl', 'genre', 'players']) {
    if (typeof cfg[key] !== 'string' || !cfg[key].trim()) throw new Error('seo.config.json 缺少欄位：' + key);
  }
  if (!/^[a-z0-9-]+$/.test(cfg.id) || cfg.siteUrl !== 'https://pjh-eric.github.io/' + cfg.id + '/') {
    throw new Error('siteUrl 必須是遊戲自己的 HTTPS 網址，並以 / 結尾');
  }
  if (cfg.lobbyUrl !== 'https://pjh-eric.github.io/game-lobby/') throw new Error('lobbyUrl 格式錯誤');
  if (cfg.title.length > 40 || cfg.description.length < 40 || cfg.description.length > 120) throw new Error('SEO 文案長度錯誤');
  if (!/^G-[A-Z0-9]+$/.test(gaId)) throw new Error('GA_MEASUREMENT_ID 格式錯誤');
  if (cfg.ogImage && !/^https:\/\//.test(cfg.ogImage)) throw new Error('ogImage 必須是 HTTPS 網址');
  if (cfg.ogImage && !/\/assets\/images\/cover\.webp$/.test(cfg.ogImage)) throw new Error('ogImage 必須指向 WebP 遊戲封面');
}

/** 讀 public/index.html 當樣板，把 SEO／GA4 寫進 outDir/index.html（預設就是 public/；建置時傳 dist/，不動原始碼）。 */
function inject(root, env = process.env, outDir = path.join(root, 'public')) {
  const cfg = JSON.parse(fs.readFileSync(path.join(root, 'seo.config.json'), 'utf8'));
  const gaId = env.GA_MEASUREMENT_ID || DEFAULT_GA_ID;
  validate(cfg, gaId);
  const indexPath = path.join(root, 'public', 'index.html');
  let html = fs.readFileSync(indexPath, 'utf8');
  if (html.split(MARK).length !== 2) throw new Error('index.html 必須有一個 ' + MARK);
  if (!/<title\b[^>]*>[\s\S]*?<\/title>/i.test(html)) throw new Error('index.html 缺少 title');
  const imageHeight = cfg.ogImage ? '675' : '';
  // 保留界線，重複建置不會累積標籤。所有檢查完成才寫入產物。
  html = html.replace(/<!--SEO:HEAD-->[\s\S]*?<!--SEO:END-->/, MARK)
    .replace(/<meta\b(?=[^>]*\bname=["']description["'])[^>]*>\s*/gi, '')
    .replace(/<title\b[^>]*>[\s\S]*?<\/title>/i, () => '<title>' + esc(cfg.title) + '</title>');
  const jsonLd = {
    '@context': 'https://schema.org', '@type': 'WebApplication',
    name: cfg.title.split('｜')[0], url: cfg.siteUrl, description: cfg.description,
    applicationCategory: 'GameApplication', operatingSystem: 'Any', inLanguage: ['zh-Hant', 'zh-Hans', 'en'],
    genre: cfg.genre, offers: { '@type': 'Offer', price: '0', priceCurrency: 'TWD' },
    image: cfg.ogImage || undefined, thumbnailUrl: cfg.ogImage || undefined,
    isPartOf: { '@type': 'WebSite', url: cfg.lobbyUrl }
  };
  const head = [
    MARK,
    // 共用 analytics.js 負責正式環境限制、URL 清理與單次初始化。
    '<script>window.GAME_ANALYTICS_CONFIG=' + safeJson({
      measurement_id: gaId, game_id: cfg.id, page_location: cfg.siteUrl, manual_page_view: true
    }) + ';</script>',
    cfg.googleSiteVerification && '<meta name="google-site-verification" content="' + esc(cfg.googleSiteVerification) + '">',
    '<meta name="description" content="' + esc(cfg.description) + '">',
    '<link rel="canonical" href="' + esc(cfg.siteUrl) + '">',
    '<meta name="robots" content="index, follow, max-image-preview:large">',
    '<meta property="og:type" content="website">',
    '<meta property="og:locale" content="zh_TW">',
    '<meta property="og:title" content="' + esc(cfg.title) + '">',
    '<meta property="og:description" content="' + esc(cfg.description) + '">',
    '<meta property="og:url" content="' + esc(cfg.siteUrl) + '">',
    cfg.ogImage && '<meta property="og:image" content="' + esc(cfg.ogImage) + '">',
    cfg.ogImage && '<meta property="og:image:type" content="image/webp">',
    cfg.ogImage && '<meta property="og:image:width" content="1200">',
    cfg.ogImage && '<meta property="og:image:height" content="' + imageHeight + '">',
    cfg.ogImage && '<meta property="og:image:alt" content="' + esc(cfg.ogImageAlt || cfg.title) + '">',
    '<meta name="twitter:card" content="' + (cfg.ogImage ? 'summary_large_image' : 'summary') + '">',
    '<meta name="twitter:title" content="' + esc(cfg.title) + '">',
    '<meta name="twitter:description" content="' + esc(cfg.description) + '">',
    cfg.ogImage && '<meta name="twitter:image" content="' + esc(cfg.ogImage) + '">',
    cfg.ogImage && '<meta name="twitter:image:alt" content="' + esc(cfg.ogImageAlt || cfg.title) + '">',
    '<script type="application/ld+json">' + safeJson(jsonLd) + '</script>', END
  ].filter(Boolean).join('\n');
  html = html.replace(MARK, () => head);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'index.html'), html, 'utf8');
  fs.writeFileSync(path.join(outDir, 'sitemap.xml'),
    '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    '  <url><loc>' + esc(cfg.siteUrl) + '</loc></url>\n</urlset>\n', 'utf8');
  return cfg;
}

module.exports = { inject, validate, DEFAULT_GA_ID };
if (require.main === module) {
  try { console.log('✓ SEO 與 GA4 已注入：' + inject(path.join(__dirname, '..'), process.env, process.argv[2] ? path.resolve(process.argv[2]) : undefined).id); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
