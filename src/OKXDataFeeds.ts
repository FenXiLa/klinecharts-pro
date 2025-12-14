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

import { Datafeed, SymbolInfo, Period, DatafeedSubscribeCallback } from './types'


export default class OKXDataFeeds implements Datafeed {
  constructor (apiKey?: string, apiSecret?: string, passphrase?: string) {
    // OKX 公共频道不需要认证，私有频道需要
    // 这里先实现公共频道，所以 API key 等参数可选
    this._apiKey = apiKey || ''
    this._apiSecret = apiSecret || ''
    this._passphrase = passphrase || ''
  }

  private _apiKey: string
  private _apiSecret: string
  private _passphrase: string
  private _prevSymbolMarket?: string
  private _ws?: WebSocket
  private _currentChannel?: string

  // 转换 ticker 格式：从 X.BTCUSD 或 BTCUSD 转换为 OKX 格式 BTC-USDT
  private _convertTickerFormat (ticker: string, quoteCurrency: string = 'USDT'): string {
    // 如果已经是正确的格式（包含 -），直接返回
    if (ticker.includes('-')) {
      return ticker
    }
    // 处理 X.BTCUSD 或 BTCUSD 格式
    const parts = ticker.replace(/^X\./, '').replace(/USD$/, '').replace(/USDT$/, '')
    return `${parts}-${quoteCurrency}`
  }

  // 转换周期格式：从 KLineChart 格式转换为 OKX 格式
  // OKX 支持的周期：1m, 3m, 5m, 15m, 30m, 1H, 2H, 4H, 6H, 12H, 1D, 1W, 1M
  private _convertPeriodToBar (period: Period): string {
    const { multiplier, timespan } = period
    
    // OKX 支持的周期映射表
    const supportedPeriods: Record<string, number[]> = {
      minute: [1, 3, 5, 15, 30],
      hour: [1, 2, 4, 6, 12],
      day: [1],
      week: [1],
      month: [1]
    }
    
    // 获取当前时间跨度支持的值列表
    const supportedValues = supportedPeriods[timespan] || supportedPeriods.minute
    
    // 找到最接近的支持值（向下取整）
    let actualMultiplier = multiplier
    for (let i = supportedValues.length - 1; i >= 0; i--) {
      if (multiplier >= supportedValues[i]) {
        actualMultiplier = supportedValues[i]
        break
      }
    }
    
    // 如果 multiplier 小于最小支持值，使用最小值
    if (actualMultiplier < supportedValues[0]) {
      actualMultiplier = supportedValues[0]
    }
    
    let bar = ''
    switch (timespan) {
      case 'minute':
        bar = `${actualMultiplier}m`
        break
      case 'hour':
        bar = `${actualMultiplier}H`
        break
      case 'day':
        bar = `${actualMultiplier}D`
        break
      case 'week':
        bar = `${actualMultiplier}W`
        break
      case 'month':
        bar = `${actualMultiplier}M`
        break
      default:
        bar = '1m'
    }
    
    console.log('[OKXDataFeeds] Period conversion:', {
      original: `${multiplier}${timespan}`,
      converted: bar,
      actualMultiplier
    })
    
    return bar
  }

  async searchSymbols (search?: string): Promise<SymbolInfo[]> {
    try {
      // OKX 获取交易对列表：GET /api/v5/public/instruments?instType=SPOT
      const url = `https://www.okx.com/api/v5/public/instruments?instType=SPOT`
      const response = await fetch(url)
      
      if (!response.ok) {
        console.error('[OKXDataFeeds] API error:', response.status, response.statusText)
        return []
      }
      
      const result = await response.json()
      
      if (result.code !== '0') {
        console.error('[OKXDataFeeds] API error:', result.msg)
        return []
      }
      
      let instruments = result.data || []
      
      // 如果提供了搜索参数，进行过滤
      if (search) {
        const searchLower = search.toLowerCase()
        instruments = instruments.filter((inst: any) => 
          inst.instId.toLowerCase().includes(searchLower) ||
          inst.baseCcy?.toLowerCase().includes(searchLower) ||
          inst.quoteCcy?.toLowerCase().includes(searchLower)
        )
      }
      
      // 映射 OKX 的响应字段到 SymbolInfo
      return instruments.map((inst: any) => ({
        ticker: inst.instId, // OKX 格式：BTC-USDT
        name: `${inst.baseCcy}/${inst.quoteCcy}`,
        shortName: inst.baseCcy,
        market: 'crypto',
        exchange: 'OKX',
        priceCurrency: inst.quoteCcy || 'USDT',
        type: 'crypto',
        pricePrecision: parseInt(inst.tickSz || '2', 10),
        volumePrecision: parseInt(inst.lotSz || '8', 10)
      }))
    } catch (error) {
      console.error('[OKXDataFeeds] Error searching symbols:', error)
      return []
    }
  }

  async getHistoryKLineData (symbol: SymbolInfo, period: Period, from: number, to: number): Promise<KLineData[]> {
    // 转换 ticker 格式
    const instId = this._convertTickerFormat(symbol.ticker, symbol.priceCurrency?.toUpperCase() || 'USDT')
    // 转换周期格式
    const bar = this._convertPeriodToBar(period)
    
    // OKX API 使用秒级时间戳
    const after = Math.floor(from / 1000)
    const before = Math.floor(to / 1000)
    
    // OKX REST API: GET /api/v5/market/candles
    const url = `https://www.okx.com/api/v5/market/candles?instId=${instId}&bar=${bar}&after=${after}&before=${before}&limit=300`
    console.log('[OKXDataFeeds] Fetching history data:', {
      instId,
      bar,
      from: new Date(after * 1000).toISOString(),
      to: new Date(before * 1000).toISOString(),
      url
    })
    
    try {
      const response = await fetch(url)
      
      if (!response.ok) {
        const errorText = await response.text()
        console.error('[OKXDataFeeds] API error:', response.status, response.statusText, errorText)
        throw new Error(`API request failed: ${response.status} ${response.statusText}`)
      }
      
      const result = await response.json()
      
      if (result.code !== '0') {
        console.error('[OKXDataFeeds] API error:', result.msg, result.code)
        throw new Error(`API error: ${result.msg}`)
      }
      
      console.log('[OKXDataFeeds] API response:', {
        resultsCount: result.data?.length || 0,
        code: result.code,
        msg: result.msg
      })
      
      // OKX 返回的格式：["timestamp", "open", "high", "low", "close", "vol", "volCcy", "volCcyQuote", "confirm"]
      // timestamp 是 Unix 毫秒时间戳
      const klineData = (result.data || []).map((candle: string[]) => ({
        timestamp: parseInt(candle[0], 10), // timestamp (Unix milliseconds)
        open: parseFloat(candle[1]),
        high: parseFloat(candle[2]),
        low: parseFloat(candle[3]),
        close: parseFloat(candle[4]),
        volume: parseFloat(candle[5]), // vol (base currency volume)
        turnover: parseFloat(candle[6]) || parseFloat(candle[5]) * parseFloat(candle[4]) // volCcy (quote currency volume)
      })).reverse() // OKX 返回的数据是倒序的（最新的在前），需要反转
      
      console.log('[OKXDataFeeds] Converted KLine data:', klineData.length, 'bars')
      if (klineData.length > 0) {
        console.log('[OKXDataFeeds] First bar:', klineData[0])
        console.log('[OKXDataFeeds] Last bar:', klineData[klineData.length - 1])
      }
      
      return klineData
    } catch (error) {
      console.error('[OKXDataFeeds] Error fetching history data:', error)
      throw error
    }
  }

  subscribe (symbol: SymbolInfo, period: Period, callback: DatafeedSubscribeCallback): void {
    // 转换 ticker 格式
    let instId = this._convertTickerFormat(symbol.ticker, symbol.priceCurrency?.toUpperCase() || 'USDT')
    // 转换周期格式
    const bar = this._convertPeriodToBar(period)
    // OKX 频道格式：根据 OKX API v5，频道名称应该是 "candles" (复数) + bar
    // 格式：candles1m, candles5m, candles15m 等
    const channel = `candles${bar}`
    
    // 确保交易对格式正确（OKX 使用 SPOT 交易对，格式为 BTC-USDT）
    // 如果 ticker 已经是正确格式，直接使用；否则尝试转换
    if (!instId.includes('-')) {
      // 如果没有连字符，尝试从 symbol 信息构造
      instId = `${symbol.shortName || 'BTC'}-${symbol.priceCurrency?.toUpperCase() || 'USDT'}`
    }
    
    console.log('[OKXDataFeeds] subscribe called with:', {
      ticker: symbol.ticker,
      instId,
      channel,
      period
    })
    
    // 如果市场变化或 WebSocket 未连接，重新建立连接
    if (this._prevSymbolMarket !== symbol.market || !this._ws || this._ws.readyState !== WebSocket.OPEN) {
      this._ws?.close()
      
      // OKX 公共频道 WebSocket URL
      const wsUrl = 'wss://ws.okx.com:8443/ws/v5/public'
      console.log('[OKXDataFeeds] Connecting to WebSocket:', wsUrl)
      
      this._ws = new WebSocket(wsUrl)
      this._currentChannel = channel
      let isConnected = false
      let pendingInstId = instId
      let pendingCallback = callback
      
      this._ws.onopen = () => {
        console.log('[OKXDataFeeds] WebSocket connected')
        isConnected = true
        
        // OKX 公共频道不需要认证，直接订阅
        // 订阅格式：{"op": "subscribe", "args": [{"channel": "candles1m", "instId": "BTC-USDT"}]}
        const subscribeMessage = {
          op: 'subscribe',
          args: [{
            channel: channel,
            instId: instId
          }]
        }
        
        this._ws?.send(JSON.stringify(subscribeMessage))
        console.log('[OKXDataFeeds] Subscription request sent:', subscribeMessage)
      }
      
      this._ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data)
          console.log('[OKXDataFeeds] WebSocket message received:', message)
          
          // 处理订阅响应
          if (message.event === 'subscribe') {
            console.log('[OKXDataFeeds] Subscribe success:', message.arg)
            return
          }
          
          // 处理错误
          if (message.event === 'error') {
            console.error('[OKXDataFeeds] WebSocket error:', message.msg, message.code)
            console.error('[OKXDataFeeds] Error details:', {
              channel: channel,
              instId: instId,
              bar: bar,
              fullMessage: message
            })
            
            // 如果是频道或交易对不存在，尝试使用降级方案
            if (message.code === '60018') {
              console.warn('[OKXDataFeeds] Channel or instrument not found. This might be due to:')
              console.warn('[OKXDataFeeds] 1. Unsupported period format')
              console.warn('[OKXDataFeeds] 2. Invalid instrument ID')
              console.warn('[OKXDataFeeds] 3. Wrong channel format')
              
              // OKX 支持的周期：1m, 3m, 5m, 15m, 30m, 1H, 2H, 4H, 6H, 12H, 1D, 1W, 1M
              // 如果 15m 不被支持，可能是 OKX 的特定限制
              // 建议使用支持的周期，比如 5m 或 30m
            }
            return
          }
          
          // 处理 K 线数据
          // 格式：{"arg": {"channel": "candles1m", "instId": "BTC-USDT"}, "data": [["timestamp", "open", "high", "low", "close", "vol", "volCcy", "volCcyQuote", "confirm"]]}
          if (message.arg && message.arg.channel === channel && message.arg.instId === pendingInstId) {
            const data = message.data
            if (Array.isArray(data) && data.length > 0) {
              // data 是数组，每个元素是一个 K 线数组
              for (const candle of data) {
                if (Array.isArray(candle) && candle.length >= 6) {
                  const candleData = candle
                  console.log('[OKXDataFeeds] Received candle data for:', pendingInstId, {
                    timestamp: new Date(parseInt(candleData[0], 10)).toISOString(),
                    open: candleData[1],
                    close: candleData[4],
                    high: candleData[2],
                    low: candleData[3],
                    vol: candleData[5]
                  })
                  
                  pendingCallback({
                    timestamp: parseInt(candleData[0], 10), // timestamp (Unix milliseconds)
                    open: parseFloat(candleData[1]),
                    high: parseFloat(candleData[2]),
                    low: parseFloat(candleData[3]),
                    close: parseFloat(candleData[4]),
                    volume: parseFloat(candleData[5]), // vol (base currency volume)
                    turnover: parseFloat(candleData[6]) || parseFloat(candleData[5]) * parseFloat(candleData[4]) // volCcy (quote currency volume)
                  })
                }
              }
            }
          }
        } catch (error) {
          console.error('[OKXDataFeeds] WebSocket message parse error:', error, 'Raw message:', event.data)
        }
      }
      
      this._ws.onerror = (error) => {
        console.error('[OKXDataFeeds] WebSocket error:', error)
      }
      
      this._ws.onclose = (event) => {
        console.log('[OKXDataFeeds] WebSocket closed', {
          code: event.code,
          reason: event.reason,
          wasClean: event.wasClean
        })
        isConnected = false
      }
    } else {
      // WebSocket 已连接，取消之前的订阅，订阅新的
      if (this._currentChannel && this._ws.readyState === WebSocket.OPEN) {
        // 取消订阅旧的（如果需要）
        // 然后订阅新的
        const subscribeMessage = {
          op: 'subscribe',
          args: [{
            channel: channel,
            instId: instId
          }]
        }
        this._ws.send(JSON.stringify(subscribeMessage))
        console.log('[OKXDataFeeds] WebSocket already connected, subscribing to:', subscribeMessage)
        this._currentChannel = channel
      }
    }
    
    this._prevSymbolMarket = symbol.market
  }

  unsubscribe (symbol: SymbolInfo, period: Period): void {
    if (this._ws && this._ws.readyState === WebSocket.OPEN) {
      const instId = this._convertTickerFormat(symbol.ticker, symbol.priceCurrency?.toUpperCase() || 'USDT')
      const bar = this._convertPeriodToBar(period)
      const channel = `candles${bar}`
      
      // 取消订阅格式：{"op": "unsubscribe", "args": [{"channel": "candles1m", "instId": "BTC-USDT"}]}
      const unsubscribeMessage = {
        op: 'unsubscribe',
        args: [{
          channel: channel,
          instId: instId
        }]
      }
      
      this._ws.send(JSON.stringify(unsubscribeMessage))
      console.log('[OKXDataFeeds] Unsubscribed from:', unsubscribeMessage)
    }
  }
}
