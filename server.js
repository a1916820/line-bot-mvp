const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
require('dotenv').config();

const app = express();
app.use(express.json());

const DATA_DIR = path.join(__dirname, 'data');
const MEMORY_FILE = path.join(DATA_DIR, 'memory.json');
const LISTING_SESSION_FILE = path.join(DATA_DIR, 'listing-session.json');
const PLAYWRIGHT_PROFILE_DIR = path.join(__dirname, 'playwright-profile');

function ensureMemoryStore() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(MEMORY_FILE)) {
    fs.writeFileSync(MEMORY_FILE, JSON.stringify({ notes: [] }, null, 2), 'utf8');
  }
  if (!fs.existsSync(LISTING_SESSION_FILE)) {
    fs.writeFileSync(LISTING_SESSION_FILE, JSON.stringify({ sessionMode: null }, null, 2), 'utf8');
  }
}

function loadMemory() {
  ensureMemoryStore();
  try {
    return JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf8'));
  } catch (e) {
    return { notes: [] };
  }
}

function saveMemory(data) {
  ensureMemoryStore();
  fs.writeFileSync(MEMORY_FILE, JSON.stringify(data, null, 2), 'utf8');
}

function addMemory(content) {
  const data = loadMemory();
  const note = {
    id: Date.now(),
    content: content.trim(),
    createdAt: new Date().toISOString(),
    scope: 'private_instruction'
  };
  data.notes.push(note);
  saveMemory(data);
  return note;
}

function listMemories() {
  const data = loadMemory();
  return data.notes || [];
}

function removeMemory(content) {
  const data = loadMemory();
  const before = data.notes.length;
  data.notes = data.notes.filter(note => note.content !== content.trim());
  saveMemory(data);
  return before !== data.notes.length;
}

function loadListingSession() {
  ensureMemoryStore();
  try {
    return JSON.parse(fs.readFileSync(LISTING_SESSION_FILE, 'utf8'));
  } catch (e) {
    return { sessionMode: null };
  }
}

function saveListingSession(session) {
  ensureMemoryStore();
  fs.writeFileSync(LISTING_SESSION_FILE, JSON.stringify(session, null, 2), 'utf8');
}

function nowIso() {
  return new Date().toISOString();
}

function createEmptyProduct(id) {
  const product = {
    id,
    status: 'draft',
    title: '',
    price: '',
    description: '',
    fabric: '',
    sizes: '',
    sizeInfo: '',
    colors: '',
    stock: '',
    category: '',
    imageLinks: [],
    uploadedImages: [],
    notes: '',
    missingFields: [],
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
  product.missingFields = computeMissingFields(product);
  return product;
}

function computeMissingFields(product) {
  const missing = [];
  if (!product.title) missing.push('商品名稱');
  if (!product.price) missing.push('售價');
  if (!product.description) missing.push('商品描述');
  if (!product.fabric) missing.push('材質');
  if (!product.sizes) missing.push('尺寸');
  if (!product.sizeInfo) missing.push('尺寸資訊');
  if (!product.colors) missing.push('顏色');
  if (!product.stock) missing.push('庫存');
  if (!product.category) missing.push('分類');
  if ((!product.imageLinks || product.imageLinks.length === 0) && (!product.uploadedImages || product.uploadedImages.length === 0)) {
    missing.push('圖片素材');
  }
  return missing;
}

function computeProductStatus(product) {
  return product.missingFields.length === 0 ? 'complete' : 'draft';
}

function createListingSession() {
  const session = {
    sessionMode: 'listing_batch',
    sessionStatus: 'collecting',
    currentDraftId: 1,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    products: [createEmptyProduct(1)]
  };
  saveListingSession(session);
  return session;
}

function getCurrentDraft(session) {
  return session.products.find(p => p.id === session.currentDraftId) || null;
}

function addNextProduct(session) {
  const nextId = (session.products.at(-1)?.id || 0) + 1;
  session.products.push(createEmptyProduct(nextId));
  session.currentDraftId = nextId;
  session.updatedAt = nowIso();
  saveListingSession(session);
  return session;
}

function updateCurrentDraft(session, patch) {
  const product = getCurrentDraft(session);
  if (!product) return session;

  const fields = ['title', 'price', 'description', 'fabric', 'sizes', 'sizeInfo', 'colors', 'stock', 'category', 'notes'];
  for (const field of fields) {
    if (typeof patch[field] === 'string' && patch[field].trim()) {
      product[field] = patch[field].trim();
    }
  }

  product.updatedAt = nowIso();
  product.missingFields = computeMissingFields(product);
  product.status = computeProductStatus(product);
  session.updatedAt = nowIso();
  saveListingSession(session);
  return session;
}

function appendImageLink(session, imageUrl) {
  const product = getCurrentDraft(session);
  if (!product || !imageUrl) return session;
  product.imageLinks = [...new Set([...(product.imageLinks || []), imageUrl])];
  product.updatedAt = nowIso();
  product.missingFields = computeMissingFields(product);
  product.status = computeProductStatus(product);
  session.updatedAt = nowIso();
  saveListingSession(session);
  return session;
}

function getBatchSummary(session) {
  const completeCount = session.products.filter(p => p.status === 'complete').length;
  const incompleteCount = session.products.length - completeCount;
  return {
    totalProducts: session.products.length,
    currentDraftId: session.currentDraftId,
    completeCount,
    incompleteCount
  };
}

const LISTING_FIELD_MAP = {
  '商品名稱': 'title',
  '售價': 'price',
  '商品描述': 'description',
  '材質': 'fabric',
  '尺寸': 'sizes',
  '尺寸資訊': 'sizeInfo',
  '顏色': 'colors',
  '庫存': 'stock',
  '分類': 'category',
  '備註': 'notes',
  '圖片連結': 'imageLinks'
};

function extractUrls(text = '') {
  return text.match(/https?:\/\/[^\s]+/g) || [];
}

function parseListingMessage(text = '') {
  const result = { patch: {}, imageLinks: [] };
  const lines = text.split('\n');
  let currentMultilineField = null;
  let multilineBuffer = [];

  function flushMultilineField() {
    if (!currentMultilineField) return;
    const value = multilineBuffer.join('\n').trim();
    if (value) result.patch[currentMultilineField] = value;
    currentMultilineField = null;
    multilineBuffer = [];
  }

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    const match = line.match(/^([^:：]+)\s*[:：]\s*(.*)$/);
    if (match) {
      const fieldName = match[1].trim();
      const value = match[2].trim();
      const key = LISTING_FIELD_MAP[fieldName];

      if (key) {
        flushMultilineField();

        if (key === 'imageLinks') {
          result.imageLinks.push(...extractUrls(value));
          continue;
        }

        if (key === 'sizeInfo') {
          if (value) {
            result.patch[key] = value;
          } else {
            currentMultilineField = 'sizeInfo';
            multilineBuffer = [];
          }
          continue;
        }

        result.patch[key] = value;
        continue;
      }
    }

    if (currentMultilineField) {
      multilineBuffer.push(line);
      continue;
    }

    const looseUrls = extractUrls(line);
    if (looseUrls.length) {
      result.imageLinks.push(...looseUrls);
    }
  }

  flushMultilineField();
  result.imageLinks = [...new Set(result.imageLinks)];
  return result;
}

function looksLikeListingFieldMessage(text = '') {
  return /^(商品名稱|售價|商品描述|材質|尺寸|尺寸資訊|顏色|庫存|分類|備註|圖片連結)\s*[:：]/m.test(text) || extractUrls(text).length > 0;
}

function isListingBatchMode(session) {
  return session?.sessionMode === 'listing_batch';
}

function formatCurrentProduct(product) {
  return [
    '目前商品資料：',
    `- 商品名稱：${product.title || '未填'}`,
    `- 售價：${product.price || '未填'}`,
    `- 商品描述：${product.description || '未填'}`,
    `- 材質：${product.fabric || '未填'}`,
    `- 尺寸：${product.sizes || '未填'}`,
    `- 尺寸資訊：${product.sizeInfo || '未填'}`,
    `- 顏色：${product.colors || '未填'}`,
    `- 庫存：${product.stock || '未填'}`,
    `- 分類：${product.category || '未填'}`,
    `- 圖片連結數：${product.imageLinks?.length || 0}`,
    `- 上傳圖片數：${product.uploadedImages?.length || 0}`
  ].join('\n');
}

function formatMissingReport(session) {
  const lines = ['目前商品缺漏狀況如下：', ''];
  for (const product of session.products) {
    product.missingFields = computeMissingFields(product);
    product.status = computeProductStatus(product);
    lines.push(`第 ${product.id} 筆：`);
    if (product.missingFields.length === 0) {
      lines.push('- 已完整');
    } else {
      for (const field of product.missingFields) {
        lines.push(`- 缺 ${field}`);
      }
    }
    lines.push('');
  }
  saveListingSession(session);
  return lines.join('\n').trim();
}

function scoreMemoryMatch(question = '', memoryContent = '') {
  const q = question.toLowerCase();
  const m = memoryContent.toLowerCase();

  const tokens = q
    .split(/[^\p{L}\p{N}]+/u)
    .map(t => t.trim())
    .filter(Boolean);

  const bigrams = [];
  for (let i = 0; i < q.length - 1; i++) {
    const bg = q.slice(i, i + 2).trim();
    if (bg && !/\s/.test(bg)) bigrams.push(bg);
  }

  const keywordGroups = [
    ['客服', '客人', '訊息'],
    ['回覆', '回應', '回答'],
    ['多久', '時間', '幾小時', '幾天', '何時'],
    ['成本', '報價', '價格'],
    ['蝦皮', 'shopee'],
    ['shopify', '訂單'],
    ['退貨', '退款'],
    ['上架', '刊登']
  ];

  let score = 0;

  for (const token of tokens) {
    if (token.length >= 2 && m.includes(token)) score += 2;
    if (token.length === 1 && m.includes(token)) score += 0.5;
  }

  for (const bg of bigrams) {
    if (m.includes(bg)) score += 1;
  }

  for (const group of keywordGroups) {
    const qHit = group.some(word => q.includes(word));
    const mHit = group.some(word => m.includes(word));
    if (qHit && mHit) score += 3;
  }

  if (q.includes('客服') && m.includes('客服')) score += 3;
  if ((q.includes('多久') || q.includes('時間')) && (m.includes('回覆') || m.includes('時間'))) score += 3;

  return score;
}

function findBestMemory(question = '') {
  const notes = listMemories();
  if (!notes.length) return null;

  let best = null;
  let bestScore = 0;

  for (const note of notes) {
    const score = scoreMemoryMatch(question, note.content);
    if (score > bestScore) {
      bestScore = score;
      best = note;
    }
  }

  if (!best || bestScore === 0) return null;
  return best;
}

function isGroupContext(event) {
  return event.source?.type === 'group' || event.source?.type === 'room';
}

function normalizeText(text = '') {
  return text.replace(/\r/g, '').trim();
}

function isMentionedOrDirectCommand(text = '') {
  return /(^|\s)g(\s|$)|@g|幫我整理|幫我摘要|幫我列待辦|幫我抓結論|總結一下|誰負責什麼|幫我回答|用之前的說法回答|這題有記憶嗎|幫我生成文案|生成文案|幫我整理商品文案|g上架|g下一筆|g 查看目前商品|g 檢查缺漏|g 生成蝦皮上架|g 生成shopify上架/i.test(text);
}

function extractBodyAfterCommand(text = '', commandRegex) {
  const cleaned = normalizeText(text);
  const match = cleaned.match(commandRegex);
  if (!match) return '';
  return cleaned.slice(match.index + match[0].length).trim();
}

function extractCommandBodyFlexible(text = '', keywords = []) {
  const cleaned = normalizeText(text);
  const lines = cleaned.split('\n');

  if (lines.length > 1) {
    const firstLine = lines[0];
    const hit = keywords.some(keyword => firstLine.includes(keyword));
    if (hit) {
      return lines.slice(1).join('\n').trim();
    }
  }

  for (const keyword of keywords) {
    const idx = cleaned.indexOf(keyword);
    if (idx !== -1) {
      return cleaned.slice(idx + keyword.length).trim();
    }
  }

  return '';
}

function linesFromBody(body = '') {
  return body
    .split('\n')
    .map(s => s.trim())
    .filter(Boolean)
    .slice(0, 8);
}

function buildSummaryFromBody(body = '') {
  const lines = linesFromBody(body);
  if (!lines.length) {
    return '請用以下格式傳給我：\nG 幫我整理\n（貼上要整理的內容）';
  }

  const bullets = lines.slice(0, 5).map(line => `- ${line}`).join('\n');
  return `重點摘要\n${bullets}\n\n關鍵結論\n- 已整理以上重點\n\n補充說明\n- 若需要，我可以再幫你列待辦或抓結論。`;
}

function buildTodoFromBody(body = '') {
  const lines = linesFromBody(body);
  if (!lines.length) {
    return '請用以下格式傳給我：\nG 幫我列待辦\n（貼上要整理的內容）';
  }

  const bullets = lines.slice(0, 5).map(line => `- [ ] ${line}`).join('\n');
  return `待辦事項\n${bullets}\n\n負責人\n- 未明確\n\n下一步\n- 如需，我可以再幫你整理責任人與優先順序。`;
}

function buildConclusionFromBody(body = '') {
  const lines = linesFromBody(body);
  if (!lines.length) {
    return '請用以下格式傳給我：\nG 幫我抓結論\n（貼上要整理的內容）';
  }

  const bullets = lines.slice(0, 3).map(line => `- ${line}`).join('\n');
  return `本段結論\n${bullets}\n\n未解問題\n- 若需要，我可以進一步幫你補成待辦事項。`;
}

function buildMemoryAnswer(question = '', debug = false) {
  const notes = listMemories();
  const best = findBestMemory(question);

  if (debug) {
    return [
      'DEBUG',
      `- question: ${question || '(empty)'}`,
      `- memory_count: ${notes.length}`,
      `- matched: ${best ? 'yes' : 'no'}`,
      `- best_match: ${best ? best.content : '(none)'}`
    ].join('\n');
  }

  if (!best) {
    return '目前找不到相符的既有記憶。\n如果你要，我可以先幫你整理一版建議回覆。';
  }
  return `根據目前既有口徑：\n- ${best.content}`;
}

function isGenerateCopyCommand(text = '') {
  return text.includes('幫我生成文案') || text.includes('生成文案') || text.includes('幫我整理商品文案');
}

function extractFirstUrl(text = '') {
  const match = text.match(/https?:\/\/[^\s]+/i);
  return match ? match[0] : '';
}

function detectProductPlatform(url = '') {
  if (/item\.taobao\.com/i.test(url)) return 'taobao';
  if (/detail\.1688\.com/i.test(url)) return '1688';
  return null;
}

async function fetchRawPage(url = '') {
  const response = await axios.get(url, {
    timeout: 15000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8'
    }
  });

  return response.data || '';
}

async function fetchProductPageWithPlaywright(url = '') {
  const context = await chromium.launchPersistentContext(PLAYWRIGHT_PROFILE_DIR, {
    headless: true
  });

  try {
    let page = context.pages()[0];
    if (!page) {
      page = await context.newPage();
    }

    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 45000
    });

    await page.waitForTimeout(5000);

    const title = await page.title();
    const currentUrl = page.url();
    const bodyText = await page.evaluate(() => {
      return document.body ? document.body.innerText : '';
    });

    return {
      title,
      currentUrl,
      bodyText: bodyText || ''
    };
  } finally {
    await context.close();
  }
}

function stripHtml(html = '') {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractTitleFromHtml(html = '') {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? stripHtml(match[1]) : '';
}

function cleanProductText(text = '') {
  return (text || '')
    .replace(/\r/g, '')
    .replace(/\t/g, ' ')
    .replace(/[ ]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function removeNoiseLines(text = '') {
  const noisePatterns = [
    /加入購物車|立即購買|收藏商品|客服|物流|發貨|付款|優惠|活動|退貨|運費|支付|推薦|店鋪|賣家/i,
    /7天|48小時|包郵|運費險|跨店/i
  ];

  return cleanProductText(text)
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .filter(line => !noisePatterns.some(pattern => pattern.test(line)))
    .join('\n');
}

function extractFabric(text = '') {
  const cleaned = removeNoiseLines(text);
  const lines = cleaned
    .split(/\n|。/)
    .map(line => line.trim())
    .filter(Boolean);

  const materialKeywords = /(棉|聚酯|聚酯纖維|滌綸|氨綸|彈力纖維|針織|羊毛|毛呢|尼龍|錦綸|麻|亞麻|丹寧|牛仔|人造棉|嫘縈|莫代爾|viscose|polyester|cotton|spandex)/i;

  for (const line of lines) {
    if (/(材質成分|材質|面料|Fabric)/i.test(line) && materialKeywords.test(line)) {
      return line
        .replace(/^(材質成分|材質|面料|Fabric)[:：]?/i, '')
        .replace(/,/g, ' / ')
        .replace(/\s{2,}/g, ' ')
        .trim();
    }
  }

  const match = cleaned.match(/((?:棉|聚酯纖維|聚酯|滌綸|氨綸|尼龍|錦綸|麻|亞麻|嫘縈|莫代爾)[^\n。；;]{0,30}%?[^\n。；;]{0,30})/i);
  return match ? match[1].trim() : '';
}

function extractSizeList(text = '') {
  const cleaned = removeNoiseLines(text);
  const matches = cleaned.match(/\b(?:XS|S|M|L|XL|2XL|3XL|F)\b/gi) || [];
  const unique = [...new Set(matches.map(s => s.toUpperCase()))];
  const order = ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', 'F'];
  const sorted = order.filter(size => unique.includes(size));
  return sorted.join('/');
}

function extractSizeInfo(text = '') {
  const lines = removeNoiseLines(text)
    .split(/\n|。/)
    .map(line => line.trim())
    .filter(Boolean)
    .filter(line => /(胸圍|肩寬|衣長|長度|袖長|腰圍|臀圍|下擺)/.test(line))
    .filter(line => /(XS|S|M|L|XL|2XL|3XL|F|均碼|free)/i.test(line) || /\d/.test(line))
    .slice(0, 10)
    .map(line => line.replace(/[,:：]/g, ' ').replace(/\s{2,}/g, ' ').trim());

  return lines.join('\n');
}

function extractModelInfo(text = '') {
  const lines = removeNoiseLines(text)
    .split(/\n|。/)
    .map(line => line.trim())
    .filter(line => /(模特|MODEL|身高|體重|試穿|著用|示範)/i.test(line))
    .slice(0, 3)
    .map(line => line.replace(/\s+/g, ' '));

  return lines.join('\n');
}

function buildProductInfo(title = '', text = '') {
  const cleanedTitle = cleanProductText(title).replace(/[|｜_]+/g, ' ').trim();
  if (cleanedTitle) return cleanedTitle;

  const lines = removeNoiseLines(text)
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .filter(line => line.length >= 8)
    .slice(0, 3);

  return lines.join('，').slice(0, 120);
}

function parseProductFieldsFromText(text = '', title = '', platform = '') {
  const cleanedRawText = cleanProductText(text);
  const filteredText = removeNoiseLines(cleanedRawText);
  const productInfo = buildProductInfo(title, filteredText) || cleanedRawText.slice(0, 120);

  return {
    productInfo,
    fabric: extractFabric(filteredText),
    sizeList: extractSizeList(filteredText),
    sizeInfo: extractSizeInfo(filteredText),
    modelInfo: extractModelInfo(filteredText),
    sourcePlatform: platform
  };
}

function parseProductFields(html = '', platform = '') {
  const text = stripHtml(html);
  const title = extractTitleFromHtml(html);
  return parseProductFieldsFromText(text, title, platform);
}

function normalizeProductData(data = {}) {
  return {
    productInfo: data.productInfo || '請補商品描述',
    fabric: data.fabric || '請補充',
    sizeList: data.sizeList || '請補充',
    sizeInfo: data.sizeInfo || '請補尺寸資訊',
    modelInfo: data.modelInfo || ''
  };
}

async function fetchProductData(url = '', platform = '') {
  try {
    const pageData = await fetchProductPageWithPlaywright(url);

    if (/登錄|登录/i.test(pageData.title) || /login/i.test(pageData.currentUrl)) {
      throw new Error('LOGIN_REQUIRED');
    }

    const parsed = parseProductFieldsFromText(pageData.bodyText, pageData.title, platform);
    return normalizeProductData(parsed);
  } catch (error) {
    const html = await fetchRawPage(url);
    const parsed = parseProductFields(html, platform);
    return normalizeProductData(parsed);
  }
}

function buildGubanProductTemplate(data = {}) {
  const productInfo = data.productInfo || '請補商品描述';
  const fabric = data.fabric || '請補充';
  const sizeList = data.sizeList || '請補充';
  const sizeInfo = data.sizeInfo || '請補尺寸資訊';
  const modelInfo = data.modelInfo || '';

  return `PRODUCT INFO\n${productInfo}\n材質Fabric：${fabric}\n尺寸Size : ${sizeList}\n\nSize Info\n${sizeInfo}\n\n模特資訊 MODEL INFO ：\n${modelInfo}\n\n\n＝＝＝＝＝＝＝＝＝＝＝＝＝＝\n\n歡迎光臨GUBAN\n\n我們很喜歡與人聊天！所以下單前可以私訊小編～\n告訴我們你目前煩惱的問題！\n\n如有任何問題歡迎詢問\n官方LINE ID : @102rxpce (要加@呦～)\nIG : guban_store\n回覆時間 : 11:00-20:00\n有其他商品的問題，也歡迎詢問小編～`;
}

app.get('/', (req, res) => {
  res.status(200).send('SmartSimon LINE webhook is running');
});

app.get('/health', (req, res) => {
  res.status(200).json({ ok: true });
});

app.post('/webhook/line', async (req, res) => {
  try {
    const events = req.body.events || [];

    for (const event of events) {
      if (event.type !== 'message') continue;
      if (event.message?.type !== 'text') continue;

      const userText = normalizeText(event.message.text || '');
      const replyToken = event.replyToken;
      if (!replyToken) continue;

      const inGroup = isGroupContext(event);

      if (inGroup && !isMentionedOrDirectCommand(userText)) {
        continue;
      }

      let replyText = '我是 G，已成功連線。';
      let listingSession = loadListingSession();

      if (/^g上架$/i.test(userText)) {
        listingSession = createListingSession();
        replyText = '好的，已開始整理上架資料。\n\n請把商品資料陸續傳給我，可以一次傳多筆。\n每筆建議提供以下資訊：\n1. 商品名稱\n2. 售價\n3. 商品描述\n4. 材質\n5. 尺寸\n6. 尺寸資訊\n7. 顏色\n8. 庫存\n9. 分類\n10. 圖片素材（可貼連結或直接上傳圖片）\n\n切換下一筆請輸入：G下一筆\n完成後可輸入：\n- G 查看目前商品\n- G 檢查缺漏\n- G 生成蝦皮上架\n- G 生成Shopify上架';
      } else if (/^g下一筆$/i.test(userText)) {
        if (!isListingBatchMode(listingSession)) {
          replyText = '如果你要開始整理上架資料，請先輸入：G上架';
        } else {
          listingSession = addNextProduct(listingSession);
          replyText = '已建立下一筆商品，請繼續提供資料。';
        }
      } else if (/^g 查看目前商品$/i.test(userText)) {
        if (!isListingBatchMode(listingSession)) {
          replyText = '如果你要開始整理上架資料，請先輸入：G上架';
        } else {
          const product = getCurrentDraft(listingSession);
          replyText = product ? formatCurrentProduct(product) : '目前找不到正在編輯的商品。';
        }
      } else if (/^g 檢查缺漏$/i.test(userText)) {
        if (!isListingBatchMode(listingSession)) {
          replyText = '如果你要開始整理上架資料，請先輸入：G上架';
        } else {
          replyText = formatMissingReport(listingSession);
        }
      } else if (/^g 生成蝦皮上架$/i.test(userText)) {
        if (!isListingBatchMode(listingSession)) {
          replyText = '目前還沒有商品資料，請先輸入：G上架';
        } else {
          const summary = getBatchSummary(listingSession);
          replyText = `已開始生成蝦皮上架檔。\n\n本次可生成商品：\n- 完整商品：${summary.completeCount} 筆\n- 缺漏商品：${summary.incompleteCount} 筆\n\n若有缺漏，建議先輸入：\nG 檢查缺漏`;
        }
      } else if (/^g 生成shopify上架$/i.test(userText)) {
        if (!isListingBatchMode(listingSession)) {
          replyText = '目前還沒有商品資料，請先輸入：G上架';
        } else {
          const summary = getBatchSummary(listingSession);
          replyText = `已開始生成 Shopify 上架檔。\n\n本次可生成商品：\n- 完整商品：${summary.completeCount} 筆\n- 缺漏商品：${summary.incompleteCount} 筆\n\n若有缺漏，建議先輸入：\nG 檢查缺漏`;
        }
      } else if (isListingBatchMode(listingSession) && !inGroup && looksLikeListingFieldMessage(userText)) {
        const parsed = parseListingMessage(userText);
        const hasPatch = Object.keys(parsed.patch).length > 0;
        const hasImages = parsed.imageLinks.length > 0;

        if (hasPatch) {
          listingSession = updateCurrentDraft(listingSession, parsed.patch);
        }
        if (hasImages) {
          for (const imageUrl of parsed.imageLinks) {
            listingSession = appendImageLink(listingSession, imageUrl);
          }
        }

        const product = getCurrentDraft(listingSession);
        const missingPreview = product?.missingFields?.slice(0, 3) || [];
        replyText = missingPreview.length
          ? `已記錄目前這筆商品資料。\n目前還缺：\n- ${missingPreview.join('\n- ')}`
          : '已記錄目前這筆商品資料。這筆商品資料已完整。';
      } else if (isListingBatchMode(listingSession) && !inGroup) {
        replyText = '目前正在整理上架資料。你可以直接補欄位內容，或輸入：\n- G下一筆\n- G 查看目前商品\n- G 檢查缺漏';
      } else if (!inGroup && /^(g\s*)?記住[:：]?/i.test(userText)) {
        const body = extractBodyAfterCommand(userText, /^(g\s*)?記住[:：]?\s*/i);
        if (!body) {
          replyText = '請用這個格式：\nG 記住：\n（要我記住的內容）';
        } else {
          const note = addMemory(body);
          replyText = `已記住這條資訊。\n- ${note.content}`;
        }
      } else if (!inGroup && /^(g\s*)?(顯示記憶|我記住了什麼)/i.test(userText)) {
        const notes = listMemories();
        if (!notes.length) {
          replyText = '目前沒有已儲存的記憶。';
        } else {
          const lines = notes.slice(-10).map((note, idx) => `${idx + 1}. ${note.content}`);
          replyText = `目前記憶：\n${lines.join('\n')}`;
        }
      } else if (!inGroup && /^(g\s*)?忘記[:：]?/i.test(userText)) {
        const body = extractBodyAfterCommand(userText, /^(g\s*)?忘記[:：]?\s*/i);
        if (!body) {
          replyText = '請用這個格式：\nG 忘記：\n（要刪除的內容）';
        } else {
          const removed = removeMemory(body);
          replyText = removed ? '已移除這條記憶。' : '找不到相符的記憶內容。';
        }
      } else if (/^(hi|hello|你好|哈囉|在嗎)$/i.test(userText)) {
        replyText = inGroup
          ? '我在。若需要我整理群組內容，請直接用：G 幫我整理。'
          : '嗨，我是 G，已成功連線。';
      } else if (/^(help|你可以做什麼|你是誰)$/i.test(userText)) {
        replyText = inGroup
          ? '我是 G，公司總助理。\n群組中可叫我：\n- G 幫我整理\n- G 幫我列待辦\n- G 幫我抓結論\n- G 幫我回答'
          : '我是 G，公司總助理。\n目前可用功能：\n- G 幫我整理\n- G 幫我列待辦\n- G 幫我抓結論\n- G 記住：...\n- G 顯示記憶\n- G 忘記：...';
      } else if (isGenerateCopyCommand(userText)) {
        const url = extractFirstUrl(userText);
        if (!url) {
          replyText = '請貼上淘寶或 1688 商品連結，我再幫你生成文案。';
        } else {
          const platform = detectProductPlatform(url);
          if (!platform) {
            replyText = '目前僅支援淘寶與 1688 商品連結。';
          } else {
            try {
              const productData = await fetchProductData(url, platform);
              replyText = buildGubanProductTemplate(productData);
            } catch (e) {
              replyText = '目前無法直接抓取這個商品連結，可能需要登入權限或頁面限制。';
            }
          }
        }
      } else if (userText.includes('幫我回答') || userText.includes('用之前的說法回答') || userText.includes('這題有記憶嗎')) {
        const body = extractCommandBodyFlexible(userText, ['幫我回答', '用之前的說法回答', '這題有記憶嗎']);
        const debugMode = userText.includes('debug');
        replyText = buildMemoryAnswer(body, debugMode);
      } else if (userText.includes('幫我整理') || userText.includes('幫我摘要')) {
        const body = extractCommandBodyFlexible(userText, ['幫我整理', '幫我摘要']);
        replyText = buildSummaryFromBody(body);
      } else if (userText.includes('幫我列待辦') || userText.includes('整理待辦') || userText.includes('誰負責什麼')) {
        const body = extractCommandBodyFlexible(userText, ['幫我列待辦', '整理待辦', '誰負責什麼']);
        replyText = buildTodoFromBody(body);
      } else if (userText.includes('幫我抓結論') || userText.includes('總結一下') || userText.includes('幫我收斂')) {
        const body = extractCommandBodyFlexible(userText, ['幫我抓結論', '總結一下', '幫我收斂']);
        replyText = buildConclusionFromBody(body);
      } else if (inGroup) {
        replyText = '你可以直接這樣叫我：\nG 幫我整理\n（貼上內容）\n\nG 幫我列待辦\n（貼上內容）\n\nG 幫我回答\n（貼上問題）';
      }

      await axios.post(
        'https://api.line.me/v2/bot/message/reply',
        {
          replyToken,
          messages: [{ type: 'text', text: replyText }]
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`
          }
        }
      );
    }

    res.sendStatus(200);
  } catch (error) {
    console.error('LINE webhook error:', error.response?.data || error.message || error);
    res.sendStatus(500);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  ensureMemoryStore();
  console.log(`SmartSimon LINE webhook running on port ${PORT}`);
});
