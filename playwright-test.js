const { chromium } = require('playwright');
const path = require('path');

async function run() {
const userDataDir = path.join(__dirname, 'playwright-profile');

const context = await chromium.launchPersistentContext(userDataDir, {
headless: false
});

let page = context.pages()[0];
if (!page) {
page = await context.newPage();
}

const url =
'https://item.taobao.com/item.htm?abbucket=18&id=713100810231&mi_id=0000xzZYp5k9XLMpQjvF0fXskYtgu1LiDh3ouXZJTSbXxMY&ns=1&skuId=5209841686033&spm=a21n57.1.hoverItem.4&utparam=%7B%22aplus_abtest%22%3A%22f1d7c411caf7af8dc34143ff51232e66%22%7D&xxc=taobaoSearch';

await page.goto(url, {
waitUntil: 'domcontentloaded',
timeout: 30000
});

await page.waitForTimeout(5000);

const title = await page.title();
const currentUrl = page.url();

const bodyText = await page.evaluate(() => {
return document.body ? document.body.innerText : '';
});

const previewText = bodyText
.replace(/\s+/g, ' ')
.trim()
.slice(0, 1000);

console.log('==== PAGE INFO ====');
console.log('URL:', currentUrl);
console.log('TITLE:', title);
console.log('==== TEXT PREVIEW START ====');
console.log(previewText);
console.log('==== TEXT PREVIEW END ====');

await page.waitForTimeout(10000); // 停 10 秒給你看畫面
await context.close();
}

run().catch(error => {
console.error('Playwright content test failed:', error);
});

