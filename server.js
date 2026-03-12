const express = require('express');
const axios = require('axios');
require('dotenv').config();

const app = express();
app.use(express.json());

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

      let replyText = '我是 SmartSimon，已成功連線。';

      if (/^(hi|hello|你好|哈囉|在嗎)$/i.test(userText)) {
        replyText = '嗨，我是 SmartSimon，已成功連線。';
      } else if (/^(help|你可以做什麼|你是誰)$/i.test(userText)) {
        replyText = '我是 SmartSimon，公司總助理。\n目前可用功能：\n- 幫我摘要\n- 幫我列待辦\n- 幫我整理重點';
      } else if (userText.includes('幫我摘要')) {
        replyText = '收到。你可以直接貼上要整理的內容，我會幫你摘要成重點。';
      } else if (userText.includes('幫我列待辦')) {
        replyText = '收到。請把內容貼給我，我會幫你整理成待辦事項與下一步。';
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
