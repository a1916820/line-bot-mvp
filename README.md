# SmartSimon LINE Bot MVP

這是一個最小可用版本的 LINE webhook 專案。

## 已包含功能
- LINE webhook 接收文字訊息
- 固定回覆測試
- `hi / 你好 / 在嗎` 回應
- `help / 你可以做什麼 / 你是誰` 回應
- 摘要 / 待辦的基礎入口提示

## 本機啟動
```bash
cd line-bot-mvp
npm install
cp .env.example .env
# 編輯 .env，填入你的 LINE_CHANNEL_ACCESS_TOKEN
npm start
```

## Webhook 路徑
```text
POST /webhook/line
```

## 健康檢查
```text
GET /
GET /health
```

## Render 部署
1. 建立新的 Web Service
2. 上傳這個專案到 GitHub，或直接從 repo 連接
3. Build Command: `npm install`
4. Start Command: `npm start`
5. Environment Variable:
   - `LINE_CHANNEL_ACCESS_TOKEN`
6. 部署成功後，拿到網址：
   - `https://<your-render-app>.onrender.com/webhook/line`
7. 到 LINE Developers 貼上該網址

## 之後可擴充
- 摘要功能接 LLM
- 群組模式
- Shopify / Google Sheet 查詢
- 正式網域綁定 `bot.gubanstore.com.tw`
