const express = require('express');
const axios = require('axios');
require('dotenv').config();

const app = express();
app.use(express.json());

function isGroupContext(event) {
  return event.source?.type === 'group' || event.source?.type === 'room';
}

function isMentionedOrDirectCommand(text = '') {
  return /smartsimon|@smartsimon|幫我整理|幫我摘要|幫我列待辦|幫我抓結論|總結一下|誰負責什麼/i.test(text);
}

function buildSummaryTemplate() {
  return '群組重點\n- 請貼上要整理的內容\n- 我會幫你整理成條列\n\n目前結論\n- 待補';
}

function buildTodoTemplate() {
  return '待辦事項\n- [ ] 請貼上要整理的內容\n- [ ] 我會幫你列出下一步\n\n負責人\n- 未明確\n\n下一步\n- 待補';
}

function buildConclusionTemplate() {
  return '本段結論\n- 請貼上要整理的內容\n- 我會幫你收斂結論\n\n未解問題\n- 待補';
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

      const userText = (event.message.text || '').trim();
      const replyToken = event.replyToken;
      if (!replyToken) continue;

      const inGroup = isGroupContext(event);

      // 群組模式：只有被點名或明確要求整理時才回
      if (inGroup && !isMentionedOrDirectCommand(userText)) {
        continue;
      }

      let replyText = '我是 SmartSimon，已成功連線。';

      if (/^(hi|hello|你好|哈囉|在嗎)$/i.test(userText)) {
        replyText = inGroup
          ? '我在。若需要我整理群組重點，請直接說：幫我整理剛剛重點。'
          : '嗨，我是 SmartSimon，已成功連線。';
      } else if (/^(help|你可以做什麼|你是誰)$/i.test(userText)) {
        replyText = inGroup
          ? '我是 SmartSimon，公司總助理。\n群組中可叫我：\n- 幫我整理剛剛重點\n- 幫我列待辦\n- 幫我抓結論'
          : '我是 SmartSimon，公司總助理。\n目前可用功能：\n- 幫我摘要\n- 幫我列待辦\n- 幫我整理重點';
      } else if (userText.includes('幫我摘要') || userText.includes('幫我整理重點') || userText.includes('幫我整理剛剛重點')) {
        replyText = inGroup
          ? buildSummaryTemplate()
          : '收到。你可以直接貼上要整理的內容，我會幫你摘要成重點。';
      } else if (userText.includes('幫我列待辦') || userText.includes('整理待辦') || userText.includes('誰負責什麼')) {
        replyText = inGroup
          ? buildTodoTemplate()
          : '收到。請把內容貼給我，我會幫你整理成待辦事項與下一步。';
      } else if (userText.includes('幫我抓結論') || userText.includes('總結一下') || userText.includes('幫我收斂')) {
        replyText = buildConclusionTemplate();
      } else if (inGroup) {
        replyText = '我可以幫你整理群組內容。你可以直接說：幫我整理剛剛重點、幫我列待辦、幫我抓結論。';
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
