const fs = require('fs');
const path = require('path');
const axios = require('axios');
const sharp = require('sharp');
const Tesseract = require('tesseract.js');

function toTraditional(text = '') {
return (text || '')
.replace(/登录/g, '登入')
.replace(/淘宝网/g, '淘寶網')
.replace(/淘宝/g, '淘寶')
.replace(/网页/g, '網頁')
.replace(/无障碍/g, '無障礙')
.replace(/购物车/g, '購物車')
.replace(/收藏夹/g, '收藏夾')
.replace(/免费开店/g, '免費開店')
.replace(/帮助中心/g, '幫助中心')
.replace(/卖家/g, '賣家')
.replace(/参数信息/g, '參數資訊')
.replace(/图文详情/g, '圖文詳情')
.replace(/用户评价/g, '用戶評價')
.replace(/推荐/g, '推薦')
.replace(/回头客/g, '回頭客')
.replace(/评价/g, '評價')
.replace(/发货/g, '發貨')
.replace(/运费/g, '運費')
.replace(/优惠/g, '優惠')
.replace(/购买/g, '購買')
.replace(/搜索/g, '搜尋')
.replace(/颜色/g, '顏色')
.replace(/尺码/g, '尺碼')
.replace(/详情/g, '詳情')
.replace(/图片/g, '圖片')
.replace(/材质/g, '材質')
.replace(/质感/g, '質感')
.replace(/舒服/g, '舒適')
.replace(/外观/g, '外觀')
.replace(/质量/g, '品質')
.replace(/不错/g, '不錯')
.replace(/紧身/g, '緊身')
.replace(/休闲/g, '休閒')
.replace(/弹力/g, '彈力')
.replace(/风格/g, '風格')
.replace(/圆领/g, '圓領')
.replace(/袖长/g, '袖長')
.replace(/长/g, '長')
.replace(/宽/g, '寬')
.replace(/围/g, '圍')
.replace(/体重/g, '體重')
.replace(/身高/g, '身高')
.replace(/试穿/g, '試穿')
.replace(/纤维/g, '纖維')
.replace(/粘胶/g, '黏膠')
.replace(/氨纶/g, '氨綸')
.replace(/针织/g, '針織');
}

async function downloadImage(url, filePath) {
const response = await axios.get(url, {
responseType: 'arraybuffer',
timeout: 30000,
headers: {
'User-Agent':
'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
}
});

fs.writeFileSync(filePath, response.data);
}

async function preprocessImage(inputPath, outputPath) {
const image = sharp(inputPath);
const meta = await image.metadata();

const width = meta.width || 1000;
const height = meta.height || 1000;

await image
.resize({
width: width * 2,
height: height * 2,
fit: 'fill'
})
.grayscale()
.normalize()
.sharpen()
.png()
.toFile(outputPath);
}

async function runOcrOnLocalImage(filePath) {
const result = await Tesseract.recognize(filePath, 'chi_sim', {
logger: m => {
if (m.status === 'recognizing text') {
console.log(`[OCR] progress ${Math.round((m.progress || 0) * 100)}%`);
}
}
});

return toTraditional(result.data.text || '');
}

async function run() {
// 這裡改成你第 17 張圖片的網址
const imageUrl =‘https://img.alicdn.com/imgextra/i3/13042061/O1CN01vqF2mb1R5zEORV9u4_!!13042061.gif’
'把第17張圖片網址貼在這裡';

const workDir = path.join(__dirname, 'ocr-work');
if (!fs.existsSync(workDir)) {
fs.mkdirSync(workDir, { recursive: true });
}

const originalPath = path.join(workDir, 'size-original.jpg');
const processedPath = path.join(workDir, 'size-processed.png');

console.log('Downloading image...');
await downloadImage(imageUrl, originalPath);

console.log('Preprocessing image...');
await preprocessImage(originalPath, processedPath);

console.log('Running OCR on processed image...');
const text = await runOcrOnLocalImage(processedPath);

console.log('================ OCR RESULT START ================');
console.log(text);
console.log('================ OCR RESULT END ==================');
}

run().catch(error => {
console.error('Preprocessed OCR test failed:', error);
});
