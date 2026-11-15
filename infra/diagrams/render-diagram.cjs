// 별도 Node 도구 환경 또는 형제 web 프로젝트의 Playwright 개발 의존성을 사용합니다.
const fs = require('fs');
const path = require('path');
const { chromium } = require(require.resolve('playwright', { paths: [__dirname, path.resolve(__dirname, '../../web')] }));
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 2400, height: 1810 }, deviceScaleFactor: 1.5 });
  const svg = fs.readFileSync(path.join(__dirname, 'aws-architecture.svg'), 'utf8');
  await page.setContent('<html><head><style>@page{margin:0}html,body{margin:0;padding:0;width:2400px;height:1810px}svg{display:block}</style></head><body>' + svg + '</body></html>');
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: path.join(__dirname, 'aws-architecture.png'), fullPage: true });
  await page.pdf({ path: path.join(__dirname, 'aws-architecture.pdf'), width: '2400px', height: '1810px', printBackground: true, margin: { top: 0, right: 0, bottom: 0, left: 0 } });
  await browser.close();
  console.log('Rendered architecture PNG and one-page PDF');
})();
