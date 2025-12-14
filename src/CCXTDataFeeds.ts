/**
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { KLineData } from 'klinecharts'
// @ts-ignore - CCXT 可能没有完整的 TypeScript 类型定义
import ccxt from 'ccxt'

import { Datafeed, SymbolInfo, Period, DatafeedSubscribeCallback } from './types'

// CCXT 类型定义（简化版，用于 TypeScript 编译）
type CCXTExchange = any
type CCXTMarket = {
  symbol: string
  base?: string
  quote?: string
  baseId?: string
  quoteId?: string
  type?: string
  active?: boolean
  precision?: {
    price?: number
    amount?: number
  }
}
type CCXTMarkets = Record<string, CCXTMarket>

/**
 * CCXT 数据源实现
 * 使用 CCXT 库统一访问多个交易所的数据
 * 
 * 支持的交易所：'okx', 'binance', 'coinbase' 等
 * 
 * @example
 * ```typescript
 * // 使用 OKX 交易所（公共频道，无需 API key）
 * const datafeed = new CCXTDataFeeds('okx')
 * 
 * // 或使用带 API key 的交易所
 * const datafeed = new CCXTDataFeeds('okx', {
 *   apiKey: 'your-api-key',
 *   secret: 'your-secret',
 *   password: 'your-password' // 某些交易所需要
 * })
 * ```
 */
export default class CCXTDataFeeds implements Datafeed {
  private _exchange: CCXTExchange
  private _exchangeId: string
  private _markets?: CCXTMarkets
  private _prevSymbolMarket?: string
  private _ws?: any
  private _currentCallback?: DatafeedSubscribeCallback
  private _pollingInterval?: number
  private _lastTimestamp?: number

  /**
   * @param exchangeId 交易所 ID，如 'okx', 'binance', 'coinbase'
   * @param credentials 可选的 API 凭证（公共频道不需要）
   * @param proxies 可选的代理配置，格式: { http?: string, https?: string }
   *                也可以从环境变量读取: https_proxy, http_proxy
   */
  constructor (exchangeId: string = 'okx', credentials?: {
    apiKey?: string
    secret?: string
    password?: string
    sandbox?: boolean
  }, proxies?: {
    http?: string
    https?: string
  }) {
    this._exchangeId = exchangeId.toLowerCase()
    
    // 检查是否在浏览器环境中
    if (typeof window !== 'undefined') {
      throw new Error(
        'CCXTDataFeeds 不支持浏览器环境。CCXT 库是专为 Node.js 设计的。\n' +
        '请使用以下替代方案：\n' +
        '1. 使用 OKXDataFeeds（已针对浏览器优化）\n' +
        '2. 在后端服务器上使用 CCXT，通过 API 提供数据\n' +
        '3. 使用代理服务器处理 CCXT 请求'
      )
    }
    
    // 检查 ccxt 是否可用
    if (typeof ccxt === 'undefined' || !ccxt) {
      throw new Error(
        'CCXT 库未加载。请确保：\n' +
        '1. 已安装 ccxt: npm install ccxt\n' +
        '2. 在 Node.js 环境中运行（不是在浏览器中）'
      )
    }
    
    // 根据交易所 ID 创建 CCXT 交易所实例
    const ExchangeClass = ccxt[this._exchangeId as keyof typeof ccxt] as typeof ccxt.Exchange
    if (!ExchangeClass) {
      throw new Error(`Unsupported exchange: ${exchangeId}. Please check CCXT documentation for supported exchanges.`)
    }

    // 准备代理配置
    // 优先使用传入的代理，其次从环境变量读取
    const proxyConfig: { http?: string, https?: string } = {}
    
    if (proxies) {
      proxyConfig.http = proxies.http
      proxyConfig.https = proxies.https
    } else {
      // 从环境变量读取代理配置
      // @ts-ignore - process 在 Node.js 环境中可用
      const httpsProxy = typeof process !== 'undefined' && process.env ? (process.env.https_proxy || process.env.HTTPS_PROXY) : undefined
      // @ts-ignore
      const httpProxy = typeof process !== 'undefined' && process.env ? (process.env.http_proxy || process.env.HTTP_PROXY) : undefined
      // @ts-ignore
      const allProxy = typeof process !== 'undefined' && process.env ? (process.env.all_proxy || process.env.ALL_PROXY) : undefined
      
      // 优先使用 https_proxy，其次 all_proxy
      if (httpsProxy) {
        proxyConfig.https = httpsProxy
        proxyConfig.http = httpProxy || httpsProxy
      } else if (allProxy) {
        // all_proxy 通常是 socks5，但也可以用于 http/https
        proxyConfig.https = allProxy.replace(/^socks5:\/\//, 'http://')
        proxyConfig.http = proxyConfig.https
      } else if (httpProxy) {
        proxyConfig.http = httpProxy
        proxyConfig.https = httpProxy
      }
    }
    
    // 创建交易所实例
    const exchangeOptions: any = {
      apiKey: credentials?.apiKey,
      secret: credentials?.secret,
      password: credentials?.password,
      sandbox: credentials?.sandbox || false,
      enableRateLimit: true, // 启用速率限制
      timeout: 60000 // 增加到 60 秒超时
    }
    
    // 如果配置了代理，添加到选项中
    // CCXT 支持多种代理配置方式
    if (proxyConfig.http || proxyConfig.https) {
      // CCXT 使用 'proxy' 选项（单个代理）或 'proxies' 对象
      // 优先使用 https 代理
      exchangeOptions.proxy = proxyConfig.https || proxyConfig.http
      exchangeOptions.proxies = {
        http: proxyConfig.http || proxyConfig.https,
        https: proxyConfig.https || proxyConfig.http
      }
      console.log(`[CCXTDataFeeds] Using proxy:`, {
        proxy: exchangeOptions.proxy,
        proxies: exchangeOptions.proxies
      })
    }

    this._exchange = new ExchangeClass(exchangeOptions) as CCXTExchange

    console.log(`[CCXTDataFeeds] Initialized with exchange: ${exchangeId}`)
  }

  /**
   * 转换周期格式：从 KLineChart Period 转换为 CCXT timeframe
   */
  private _convertPeriodToTimeframe (period: Period): string {
    const { multiplier, timespan } = period
    
    // CCXT 标准时间框架格式
    let timeframe = ''
    
    switch (timespan) {
      case 'minute':
        timeframe = `${multiplier}m`
        break
      case 'hour':
        timeframe = `${multiplier}h`
        break
      case 'day':
        timeframe = `${multiplier}d`
        break
      case 'week':
        timeframe = `${multiplier}w`
        break
      case 'month':
        timeframe = `${multiplier}M`
        break
      default:
        timeframe = '1m'
    }
    
    // CCXT 会自动处理时间框架的标准化
    // 如果交易所不支持该时间框架，CCXT 会使用最接近的支持值
    console.log('[CCXTDataFeeds] Period conversion:', {
      original: `${multiplier}${timespan}`,
      timeframe
    })
    
    return timeframe
  }

  /**
   * 转换 ticker 格式为 CCXT 标准符号
   */
  private _convertTickerToSymbol (symbol: SymbolInfo): string {
    // CCXT 使用统一的符号格式，通常是 BASE/QUOTE，如 BTC/USDT
    // 如果 ticker 已经包含 /，直接使用
    if (symbol.ticker.includes('/')) {
      return symbol.ticker
    }
    
    // 如果 ticker 包含 -，转换为 /
    if (symbol.ticker.includes('-')) {
      return symbol.ticker.replace('-', '/')
    }
    
    // 否则根据 shortName 和 priceCurrency 构造
    const base = symbol.shortName || symbol.ticker.replace(/USD[T]?$/, '')
    const quote = symbol.priceCurrency?.toUpperCase() || 'USDT'
    
    return `${base}/${quote}`
  }

  /**
   * 确保市场数据已加载
   */
  private async _ensureMarketsLoaded (): Promise<void> {
    if (!this._markets) {
      console.log('[CCXTDataFeeds] Loading markets...')
      try {
        const markets = await this._exchange.loadMarkets()
        this._markets = markets as CCXTMarkets
        console.log(`[CCXTDataFeeds] Markets loaded: ${Object.keys(this._markets).length} symbols`)
      } catch (error) {
        console.error('[CCXTDataFeeds] Error loading markets:', error)
        throw new Error(`Failed to load markets: ${error}`)
      }
    }
  }

  /**
   * 模糊搜索标的
   */
  async searchSymbols (search?: string): Promise<SymbolInfo[]> {
    try {
      await this._ensureMarketsLoaded()
      
      if (!this._markets) {
        return []
      }
      
      let symbols = Object.values(this._markets as CCXTMarkets) as CCXTMarket[]
      
      // 过滤：只返回现货交易对
      symbols = symbols.filter((market: CCXTMarket) => {
        return market.type === 'spot' && market.active !== false
      })
      
      // 如果提供了搜索参数，进行过滤
      if (search) {
        const searchLower = search.toLowerCase()
        symbols = symbols.filter((market: CCXTMarket) => {
          return (
            market.symbol.toLowerCase().includes(searchLower) ||
            market.base?.toLowerCase().includes(searchLower) ||
            market.quote?.toLowerCase().includes(searchLower) ||
            market.baseId?.toLowerCase().includes(searchLower) ||
            market.quoteId?.toLowerCase().includes(searchLower)
          )
        })
      }
      
      // 映射 CCXT Market 到 SymbolInfo
      return symbols.map((market: CCXTMarket) => ({
        ticker: market.symbol, // CCXT 标准格式：BTC/USDT
        name: `${market.base}/${market.quote}`,
        shortName: market.base,
        market: 'crypto',
        exchange: this._exchangeId.toUpperCase(),
        priceCurrency: market.quote,
        type: 'crypto',
        pricePrecision: market.precision?.price || 2,
        volumePrecision: market.precision?.amount || 8
      }))
    } catch (error) {
      console.error('[CCXTDataFeeds] Error searching symbols:', error)
      return []
    }
  }

  /**
   * 获取历史 K 线数据
   */
  async getHistoryKLineData (symbol: SymbolInfo, period: Period, from: number, to: number): Promise<KLineData[]> {
    try {
      await this._ensureMarketsLoaded()
      
      const ccxtSymbol = this._convertTickerToSymbol(symbol)
      const timeframe = this._convertPeriodToTimeframe(period)
      
      // CCXT 使用毫秒时间戳
      const since = from
      const limit = 1000 // CCXT 最大限制通常是 1000
      
      console.log('[CCXTDataFeeds] Fetching history data:', {
        symbol: ccxtSymbol,
        timeframe,
        from: new Date(from).toISOString(),
        to: new Date(to).toISOString(),
        since,
        limit
      })
      
      // 使用 CCXT 的 fetchOHLCV 方法
      // CCXT 会自动处理不同交易所的 API 差异
      const ohlcv = await this._exchange.fetchOHLCV(ccxtSymbol, timeframe, since, limit)
      
      console.log('[CCXTDataFeeds] Received OHLCV data:', ohlcv.length, 'candles')
      
      if (ohlcv.length === 0) {
        console.warn('[CCXTDataFeeds] No data received. This might be due to:')
        console.warn('[CCXTDataFeeds] 1. Invalid symbol:', ccxtSymbol)
        console.warn('[CCXTDataFeeds] 2. Unsupported timeframe:', timeframe)
        console.warn('[CCXTDataFeeds] 3. Date range issue')
        return []
      }
      
      // 转换 CCXT OHLCV 格式到 KLineData
      // CCXT 返回格式: [timestamp, open, high, low, close, volume]
      const klineData: KLineData[] = ohlcv
        .filter((candle: number[]) => {
          // 过滤时间范围
          const timestamp = candle[0]
          return timestamp >= from && timestamp <= to
        })
        .map((candle: number[]) => {
          const [timestamp, open, high, low, close, volume] = candle
          return {
            timestamp, // Unix 毫秒时间戳
            open: open as number,
            high: high as number,
            low: low as number,
            close: close as number,
            volume: volume as number,
            turnover: (close as number) * (volume as number) // 估算 turnover
          }
        })
      
      console.log('[CCXTDataFeeds] Converted KLine data:', klineData.length, 'bars')
      if (klineData.length > 0) {
        console.log('[CCXTDataFeeds] First bar:', {
          timestamp: new Date(klineData[0].timestamp).toISOString(),
          close: klineData[0].close
        })
        console.log('[CCXTDataFeeds] Last bar:', {
          timestamp: new Date(klineData[klineData.length - 1].timestamp).toISOString(),
          close: klineData[klineData.length - 1].close
        })
      }
      
      return klineData
    } catch (error) {
      console.error('[CCXTDataFeeds] Error fetching history data:', error)
      console.error('[CCXTDataFeeds] Error details:', {
        symbol: symbol.ticker,
        period: `${period.multiplier}${period.timespan}`,
        exchange: this._exchangeId
      })
      throw error
    }
  }

  /**
   * 订阅实时数据
   * 
   * 注意：由于浏览器环境的限制，这里使用轮询方式获取实时数据
   * 如果交易所支持 WebSocket，可以后续优化为 WebSocket 订阅
   */
  subscribe (symbol: SymbolInfo, period: Period, callback: DatafeedSubscribeCallback): void {
    const ccxtSymbol = this._convertTickerToSymbol(symbol)
    const timeframe = this._convertPeriodToTimeframe(period)
    
    console.log('[CCXTDataFeeds] subscribe called with:', {
      symbol: ccxtSymbol,
      timeframe,
      exchange: this._exchangeId
    })
    
    // 清除之前的订阅
    this.unsubscribe(symbol, period)
    
    // 保存回调
    this._currentCallback = callback
    
    // 检查交易所是否支持 WebSocket
    if (this._exchange.has['watchOHLCV']) {
      // 使用 WebSocket（如果支持）
      this._subscribeWebSocket(ccxtSymbol, timeframe, callback)
    } else {
      // 降级到轮询方式
      console.log('[CCXTDataFeeds] WebSocket not supported, using polling')
      this._subscribePolling(ccxtSymbol, timeframe, callback)
    }
    
    this._prevSymbolMarket = symbol.market
  }

  /**
   * WebSocket 订阅（如果交易所支持）
   */
  private async _subscribeWebSocket (symbol: string, timeframe: string, callback: DatafeedSubscribeCallback): Promise<void> {
    try {
      console.log('[CCXTDataFeeds] Attempting WebSocket subscription...')
      
      // 使用 CCXT 的 watchOHLCV
      const watchHandler = async () => {
        try {
          while (this._currentCallback) {
            const ohlcv = await this._exchange.watchOHLCV(symbol, timeframe)
            if (ohlcv && ohlcv.length > 0) {
              const latestCandle = ohlcv[ohlcv.length - 1]
              const [timestamp, open, high, low, close, volume] = latestCandle
              
              callback({
                timestamp: timestamp as number,
                open: open as number,
                high: high as number,
                low: low as number,
                close: close as number,
                volume: volume as number,
                turnover: (close as number) * (volume as number)
              })
            }
            
            // 防止过于频繁的调用
            await new Promise(resolve => setTimeout(resolve, 100))
          }
        } catch (error) {
          console.error('[CCXTDataFeeds] WebSocket error:', error)
          // 如果 WebSocket 失败，降级到轮询
          this._subscribePolling(symbol, timeframe, callback)
        }
      }
      
      watchHandler()
    } catch (error) {
      console.error('[CCXTDataFeeds] WebSocket subscription failed, falling back to polling:', error)
      this._subscribePolling(symbol, timeframe, callback)
    }
  }

  /**
   * 轮询方式订阅（适用于不支持 WebSocket 的情况）
   */
  private _subscribePolling (symbol: string, timeframe: string, callback: DatafeedSubscribeCallback): void {
    console.log('[CCXTDataFeeds] Starting polling subscription')
    
    // 清除之前的轮询
    if (this._pollingInterval) {
      clearInterval(this._pollingInterval)
    }
    
    // 轮询间隔（根据时间框架调整）
    const interval = this._getPollingInterval(timeframe)
    
    const fetchLatest = async () => {
      if (!this._currentCallback) {
        return
      }
      
      try {
        // 获取最新的 K 线数据
        const since = this._lastTimestamp || Date.now() - interval * 2
        const ohlcv = await this._exchange.fetchOHLCV(symbol, timeframe, since, 1)
        
        if (ohlcv && ohlcv.length > 0) {
          const latestCandle = ohlcv[ohlcv.length - 1]
          const [timestamp, open, high, low, close, volume] = latestCandle
          
          // 只处理新的数据
          if (!this._lastTimestamp || timestamp > this._lastTimestamp) {
            this._lastTimestamp = timestamp as number
            
            callback({
              timestamp: timestamp as number,
              open: open as number,
              high: high as number,
              low: low as number,
              close: close as number,
              volume: volume as number,
              turnover: (close as number) * (volume as number)
            })
          }
        }
      } catch (error) {
        console.error('[CCXTDataFeeds] Polling error:', error)
      }
    }
    
    // 立即获取一次
    fetchLatest()
    
    // 设置定时轮询
    // 使用全局 setInterval（在浏览器和 Node.js 中都可用）
    this._pollingInterval = (typeof setInterval !== 'undefined' ? setInterval : (() => {
      // 降级方案（如果 setInterval 不可用）
      return 0
    })) as unknown as number
    if (typeof setInterval !== 'undefined') {
      this._pollingInterval = setInterval(fetchLatest, interval) as unknown as number
    }
  }

  /**
   * 根据时间框架获取轮询间隔
   */
  private _getPollingInterval (timeframe: string): number {
    // 根据时间框架设置合适的轮询间隔
    if (timeframe.endsWith('m')) {
      const minutes = parseInt(timeframe.replace('m', ''))
      return Math.min(minutes * 60 * 1000, 60000) // 最多 1 分钟
    } else if (timeframe.endsWith('h')) {
      return 5 * 60 * 1000 // 5 分钟
    } else if (timeframe.endsWith('d')) {
      return 15 * 60 * 1000 // 15 分钟
    }
    return 60000 // 默认 1 分钟
  }

  /**
   * 取消订阅
   */
  unsubscribe (symbol: SymbolInfo, period: Period): void {
    console.log('[CCXTDataFeeds] unsubscribe called')
    
    // 清除回调
    this._currentCallback = undefined
    this._lastTimestamp = undefined
    
    // 清除轮询
    if (this._pollingInterval) {
      clearInterval(this._pollingInterval)
      this._pollingInterval = undefined
    }
    
    // 关闭 WebSocket（如果有）
    if (this._ws) {
      try {
        if (typeof this._ws.close === 'function') {
          this._ws.close()
        }
      } catch (error) {
        console.error('[CCXTDataFeeds] Error closing WebSocket:', error)
      }
      this._ws = undefined
    }
  }
}

