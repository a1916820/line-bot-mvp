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
    .filter(t => t.length >= 2);

  let score = 0;
  for (const token of tokens) {
    if (m.includes(token)) score += 1;
  }
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
  return /(^|\s)g(\s|$)|@g|幫我整理|幫我摘要|幫我列待辦|幫我抓結論|總結一下|誰負責什麼|幫我回答|用之前的說法回答|這題有記憶嗎/i.test(text);
}

function extractBodyAfterCommand(text = '', commandRegex) {
  const cleaned = normalizeText(text);
  const match = cleaned.match(commandRegex);
  if (!match) return '';
  return cleaned.slice(match[0].length).trim();
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

function buildMemoryAnswer(question = '') {
  const best = findBestMemory(question);
  if (!best) {
    return '目前找不到相符的既有記憶。\n如果你要，我可以先幫你整理一版建議回覆。';
  }
  return `根據目前既有口徑：\n- ${best.content}`;
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
      } else if (/^(g\s*)?幫我回答/i.test(userText) || /^(g\s*)?用之前的說法回答/i.test(userText) || /^(g\s*)?這題有記憶嗎/i.test(userText)) {
        const body = extractBodyAfterCommand(userText, /^(g\s*)?(幫我回答|用之前的說法回答|這題有記憶嗎)\s*/i);
        replyText = buildMemoryAnswer(body);
      } else if (/^(g\s*)?幫我整理/i.test(userText) || /^(g\s*)?幫我摘要/i.test(userText)) {
        const body = extractBodyAfterCommand(userText, /^(g\s*)?(幫我整理|幫我摘要)\s*/i);
        replyText = buildSummaryFromBody(body);
      } else if (/^(g\s*)?(幫我列待辦|整理待辦|誰負責什麼)/i.test(userText)) {
        const body = extractBodyAfterCommand(userText, /^(g\s*)?(幫我列待辦|整理待辦|誰負責什麼)\s*/i);
        replyText = buildTodoFromBody(body);
      } else if (/^(g\s*)?(幫我抓結論|總結一下|幫我收斂)/i.test(userText)) {
        const body = extractBodyAfterCommand(userText, /^(g\s*)?(幫我抓結論|總結一下|幫我收斂)\s*/i);
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
