const express = require('express');
const axios = require('axios');
require('dotenv').config();

const app = express();
app.use(express.json());

function isGroupContext(event) {
  return event.source?.type === 'group' || event.source?.type === 'room';
}

function normalizeText(text = '') {
  return text.replace(/\r/g, '').trim();
}

function isMentionedOrDirectCommand(text = '') {
  return /(^|\s)g(\s|$)|@g|幫我整理|幫我摘要|幫我列待辦|幫我抓結論|總結一下|誰負責什麼/i.test(text);
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

      // 群組模式：只有被點名或明確要求整理時才回
      if (inGroup && !isMentionedOrDirectCommand(userText)) {
        continue;
      }

      let replyText = '我是 G，已成功連線。';

      if (/^(hi|hello|你好|哈囉|在嗎)$/i.test(userText)) {
        replyText = inGroup
          ? '我在。若需要我整理群組內容，請直接用：G 幫我整理。'
          : '嗨，我是 G，已成功連線。';
      } else if (/^(help|你可以做什麼|你是誰)$/i.test(userText)) {
        replyText = inGroup
          ? '我是 G，公司總助理。\n群組中可叫我：\n- G 幫我整理\n- G 幫我列待辦\n- G 幫我抓結論'
          : '我是 G，公司總助理。\n目前可用功能：\n- G 幫我整理\n- G 幫我列待辦\n- G 幫我抓結論';
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
        replyText = '你可以直接這樣叫我：\nG 幫我整理\n（貼上內容）\n\n或\nG 幫我列待辦\n（貼上內容）';
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
  console.log(`SmartSimon LINE webhook running on port ${PORT}`);
});
