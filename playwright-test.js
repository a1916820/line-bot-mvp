const productInfo = data.productInfo || '請補商品描述';
const fabric = data.fabric || '請補充';
const sizeList = data.sizeList || '請補充';
const sizeInfo = data.sizeInfo || '請補尺寸資訊';
const modelInfo = data.modelInfo || '';

return `PRODUCT INFO
${productInfo}
材質Fabric：${fabric}
尺寸Size : ${sizeList}

Size Info
${sizeInfo}

模特資訊 MODEL INFO ：
${modelInfo}


＝＝＝＝＝＝＝＝＝＝＝＝＝＝

歡迎光臨GUBAN

我們很喜歡與人聊天！所以下單前可以私訊小編～
告訴我們你目前煩惱的問題！

如有任何問題歡迎詢問
官方LINE ID : @102rxpce (要加@呦～)
IG : guban_store
回覆時間 : 11:00-20:00
有其他商品的問題，也歡迎詢問小編～`;
}

async function processPickedImage(url, originalName, processedName) {
const workDir = path.join(__dirname, 'ocr-work');
if (!fs.existsSync(workDir)) {
fs.mkdirSync(workDir, { recursive: true });
}

const originalPath = path.join(workDir, originalName);
const processedPath = path.join(workDir, processedName);

await downloadImage(url, originalPath);
await preprocessImage(originalPath, processedPath);
return await runOcrOnLocalImage(processedPath);
}

async function run() {
const productUrl =
'https://item.taobao.com/item.htm?abbucket=18&id=713100810231&mi_id=0000xzZYp5k9XLMpQjvF0fXskYtgu1LiDh3ouXZJTSbXxMY&ns=1&skuId=5209841686033&spm=a21n57.1.hoverItem.4&utparam=%7B%22aplus_abtest%22%3A%22f1d7c411caf7af8dc34143ff51232e66%22%7D&xxc=taobaoSearch';

const userDataDir = path.join(__dirname, 'playwright-profile');

const context = await chromium.launchPersistentContext(userDataDir, {
headless: false
});

let page = context.pages()[0];
if (!page) {
page = await context.newPage();
}

await page.goto(productUrl, {
waitUntil: 'domcontentloaded',
timeout: 30000
});

await page.waitForTimeout(5000);
await autoScroll(page);
await page.waitForTimeout(5000);

const title = await page.title();
const bodyText = await page.evaluate(() => {
return document.body ? document.body.innerText : '';
});

const rawImages = await page.evaluate(() => {
const imgs = Array.from(document.querySelectorAll('img'));
return imgs.map(img => {
const src =
img.src ||
img.getAttribute('data-src') ||
img.getAttribute('data-lazyload') ||
img.getAttribute('data-ks-lazyload') ||
'';

const width =
img.naturalWidth ||
img.width ||
parseInt(img.getAttribute('width') || '0', 10) ||
0;

const height =
img.naturalHeight ||
img.height ||
parseInt(img.getAttribute('height') || '0', 10) ||
0;

return { src, width, height };
});
});

await context.close();

const uniqueMap = new Map();
for (const item of rawImages) {
if (!item.src) continue;
if (!uniqueMap.has(item.src)) {
uniqueMap.set(item.src, item);
}
}

const candidateImages = [...uniqueMap.values()]
.filter(item => isCandidateDetailImage(item.src))
.filter(item => item.width >= 150 || item.height >= 150)
.slice(0, 30);

// 你目前人工確認的圖號
const fabricImage = candidateImages[6]?.src; // #7
const modelImage = candidateImages[15]?.src; // #16
const sizeImage = candidateImages[16]?.src; // #17

console.log('Using picked images:');
console.log('#7 fabric:', fabricImage || '(missing)');
console.log('#16 model:', modelImage || '(missing)');
console.log('#17 size:', sizeImage || '(missing)');

let ocrFabricText = '';
let ocrModelText = '';
let ocrSizeText = '';

if (fabricImage) {
console.log('\nRunning OCR for fabric image...');
ocrFabricText = await processPickedImage(
fabricImage,
'fabric-original.jpg',
'fabric-processed.png'
);
}

if (modelImage) {
console.log('\nRunning OCR for model image...');
ocrModelText = await processPickedImage(
modelImage,
'model-original.jpg',
'model-processed.png'
);
}

if (sizeImage) {
console.log('\nRunning OCR for size image...');
ocrSizeText = await processPickedImage(
sizeImage,
'size-original.jpg',
'size-processed.png'
);
}

const productInfo = buildProductInfo(title, bodyText);
const sizeList = extractSizeList(bodyText);
const textFabric = extractFabricFromText(bodyText);

const ocrFabric = formatOcrFabric(ocrFabricText);
const ocrModel = formatOcrModelInfo(ocrModelText);
const ocrSizeInfo = formatOcrSizeInfo(ocrSizeText);