// 별도 Node 도구 환경 또는 형제 web 프로젝트의 Playwright로 실행합니다.
const fs = require('fs');
const path = require('path');
const { chromium } = require(require.resolve('playwright', { paths: [__dirname, path.resolve(__dirname, '../../web')] }));

(async () => {
  const width = 2600;
  const height = 1880;
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1.5 });
  const svg = fs.readFileSync(path.join(__dirname, 'aws-ecs-test-architecture.svg'), 'utf8');
  await page.setContent(`<html><head><style>@page{margin:0}html,body{margin:0;padding:0;width:${width}px;height:${height}px}svg{display:block}</style></head><body>${svg}</body></html>`);
  await page.evaluate(() => document.fonts.ready);
  const invalidText = await page.locator('svg > text').evaluateAll((elements) => elements.filter((el) => {
    const b = el.getBBox();
    return b.x < 0 || b.y < 0 || b.x + b.width > 2600 || b.y + b.height > 1880;
  }).map((el) => ({ text: el.textContent, bbox: el.getBBox().toJSON() })));
  if (invalidText.length) throw new Error('Text outside canvas: ' + JSON.stringify(invalidText));
  await page.screenshot({ path: path.join(__dirname, 'aws-ecs-test-architecture.png'), fullPage: true });
  await page.pdf({ path: path.join(__dirname, 'aws-ecs-test-architecture.pdf'), width: `${width}px`, height: `${height}px`, printBackground: true, margin: { top: 0, right: 0, bottom: 0, left: 0 } });
  await browser.close();
  console.log('Rendered ECS test architecture: PNG 3900 x 2820, one-page PDF');
})();
