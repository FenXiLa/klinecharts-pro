# CCXTDataFeeds 浏览器限制说明

## ⚠️ 重要提示

**CCXTDataFeeds 不支持浏览器环境！**

CCXT 库是专为 Node.js 服务器端设计的，它依赖许多 Node.js 特定的模块（如 `node:http`, `node:https`, `http-proxy-agent` 等），这些模块在浏览器环境中无法使用。

## 解决方案

### 方案 1: 使用 OKXDataFeeds（推荐）

如果你需要在浏览器中获取数据，请使用已经针对浏览器优化的 `OKXDataFeeds`：

```typescript
import { KLineChartPro, OKXDataFeeds } from '@klinecharts/pro'

const chart = new KLineChartPro({
  container: 'container',
  datafeed: new OKXDataFeeds(), // ✅ 浏览器环境可用
  // ... 其他配置
})
```

### 方案 2: 后端 API 代理

如果你需要使用 CCXT，可以在后端创建一个 API 代理：

**后端 (Node.js)**
```typescript
// server.ts
import express from 'express'
import CCXTDataFeeds from '@klinecharts/pro/src/CCXTDataFeeds'

const app = express()
const datafeed = new CCXTDataFeeds('okx')

app.get('/api/ohlcv', async (req, res) => {
  const { symbol, timeframe, since, limit } = req.query
  const data = await datafeed._exchange.fetchOHLCV(symbol, timeframe, since, limit)
  res.json(data)
})
```

**前端**
```typescript
// 创建一个适配器
class ProxyDataFeeds implements Datafeed {
  async getHistoryKLineData(symbol, period, from, to) {
    const response = await fetch(`/api/ohlcv?symbol=${symbol.ticker}&...`)
    return response.json()
  }
  // ...
}
```

### 方案 3: 仅用于 Node.js 测试

`CCXTDataFeeds` 可以用于：
- Node.js 环境下的测试（`npm run test:ccxt`）
- 后端服务器
- 开发工具和脚本

## 构建配置

为了支持构建，CCXT 相关的模块已被标记为 `external`，这意味着：

1. ✅ 构建不会失败
2. ⚠️ 但在浏览器中使用时会抛出错误（已在构造函数中检测）
3. ✅ 在 Node.js 环境中可以正常使用

## 测试

在 Node.js 环境中测试 CCXTDataFeeds：

```bash
npm run test:ccxt
```

