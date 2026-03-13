const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const app = express();
app.use(express.json());

const DATA_DIR = path.join(__dirname, 'data');
const MEMORY_FILE = path.join(DATA_DIR, 'memory.json');

function ensureMemoryStore() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(MEMORY_FILE)) {
    fs.writeFileSync(MEMORY_FILE, JSON.stringify({ notes: [] }, null, 2), 'utf8');
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
  return /(^|\s)g(\s|$)|@g|幫我整理|幫我摘要|幫我列待辦|幫我抓結論|總結一下|誰負責什麼|幫我回答|用之前的說法回答|這題有記憶嗎|幫我生成文案|生成文案|幫我整理商品文案/i.test(text);
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

function extractFabric(text = '') {
  const match = text.match(/(?:材質|面料|Fabric)[:：]?\s*([^\n。；;]+)/i);
  return match ? match[1].trim() : '';
}

function extractSizeList(text = '') {
  const matches = text.match(/\b(?:XS|S|M|L|XL|2XL|3XL|F)\b/gi) || [];
  const unique = [...new Set(matches.map(s => s.toUpperCase()))];
  return unique.join('/');
}

function extractSizeInfo(text = '') {
  const lines = text
    .split(/\n|。/)
    .map(line => line.trim())
    .filter(line => /(胸圍|肩寬|衣長|長度|袖長|腰圍|臀圍)/.test(line))
    .slice(0, 8);

  return lines.join('\n');
}

function extractModelInfo(text = '') {
  const lines = text
    .split(/\n|。/)
    .map(line => line.trim())
    .filter(line => /(模特|MODEL|身高|體重|試穿)/i.test(line))
    .slice(0, 3);

  return lines.join('\n');
}

function parseProductFields(html = '', platform = '') {
  const text = stripHtml(html);
  const title = extractTitleFromHtml(html);
  const productInfo = title || text.slice(0, 120);

  return {
    productInfo,
    fabric: extractFabric(text),
    sizeList: extractSizeList(text),
    sizeInfo: extractSizeInfo(text),
    modelInfo: extractModelInfo(text),
    sourcePlatform: platform
  };
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
  const html = await fetchRawPage(url);
  const parsed = parseProductFields(html, platform);
  return normalizeProductData(parsed);
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

      if (!inGroup && /^(g\s*)?記住[:：]?/i.test(userText)) {
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
