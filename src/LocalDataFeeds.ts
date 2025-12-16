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


/**
 * 本地数据源实现
 * 连接到本地 Python 服务器提供的数据接口
 */
export default class LocalDataFeeds implements Datafeed {
  constructor (baseUrl: string = 'http://localhost:8000') {
    this._baseUrl = baseUrl.replace(/\/$/, '') // 移除末尾的斜杠
    this._ws = undefined
    this._currentChannel = undefined
    this._callback = undefined
  }

  private _baseUrl: string
  private _ws?: WebSocket
  private _currentChannel?: string
  private _callback?: DatafeedSubscribeCallback

  /**
   * 转换周期格式：从 KLineChart Period 转换为服务器支持的格式
   */
  private _convertPeriodToTimeframe (period: Period): string {
    const { multiplier, timespan } = period
    
    if (timespan === 'minute') {
      return `${multiplier}m`
    } else if (timespan === 'hour') {
      return `${multiplier}h`
    } else if (timespan === 'day') {
      return `${multiplier}d`
    } else if (timespan === 'week') {
      return `${multiplier * 7}d` // 周转换为天
    } else if (timespan === 'month') {
      return `${multiplier * 30}d` // 月转换为天
    } else {
      return '15m' // 默认
    }
  }

  /**
   * 搜索标的
   */
  async searchSymbols (search?: string): Promise<SymbolInfo[]> {
    try {
      const url = `${this._baseUrl}/api/symbols/search${search ? `?q=${encodeURIComponent(search)}` : ''}`
      const response = await fetch(url)
      
      if (!response.ok) {
        throw new Error(`搜索标的失败: ${response.statusText}`)
      }
      
      const symbols = await response.json()
      return symbols as SymbolInfo[]
    } catch (error) {
      console.error('[LocalDataFeeds] 搜索标的失败:', error)
      return []
    }
  }

  /**
   * 获取历史K线数据
   */
  async getHistoryKLineData (
    symbol: SymbolInfo,
    period: Period,
    from: number,
    to: number
  ): Promise<KLineData[]> {
    try {
      const timeframe = this._convertPeriodToTimeframe(period)
      const url = `${this._baseUrl}/api/klines?symbol=${encodeURIComponent(symbol.ticker)}&timeframe=${timeframe}&from_time=${from}&to_time=${to}`
      
      const response = await fetch(url)
      
      if (!response.ok) {
        throw new Error(`获取历史数据失败: ${response.statusText}`)
      }
      
      const klines = await response.json() as KLineData[]
      
      console.log(`[LocalDataFeeds] 获取到 ${klines.length} 条K线数据: ${symbol.ticker} ${timeframe}`)
      return klines
    } catch (error) {
      console.error('[LocalDataFeeds] 获取历史数据失败:', error)
      return []
    }
  }

  /**
   * 订阅实时数据
   */
  subscribe (symbol: SymbolInfo, period: Period, callback: DatafeedSubscribeCallback): void {
    const timeframe = this._convertPeriodToTimeframe(period)
    const channel = `${symbol.ticker}_${timeframe}`
    
    // 如果已经是同一个 channel 且连接已建立，只需要更新 callback
    if (this._currentChannel === channel && this._ws && this._ws.readyState === WebSocket.OPEN) {
      console.log(`[LocalDataFeeds] 已连接到相同 channel，更新 callback: ${channel}`)
      this._callback = callback
      return
    }
    
    // 如果已有其他订阅，先取消
    if (this._ws) {
      // 只有在连接已建立或正在关闭时才关闭，避免关闭正在建立的连接
      if (this._ws.readyState === WebSocket.OPEN || this._ws.readyState === WebSocket.CLOSING) {
        this.unsubscribe(symbol, period)
      } else {
        // 如果连接正在建立中，等待一下再关闭
        setTimeout(() => {
          if (this._ws && this._currentChannel !== channel) {
            this.unsubscribe(symbol, period)
          }
        }, 100)
      }
    }

    this._currentChannel = channel
    this._callback = callback

    try {
      // 构建 WebSocket URL
      const wsUrl = `${this._baseUrl.replace(/^http/, 'ws')}/ws?symbol=${encodeURIComponent(symbol.ticker)}&timeframe=${timeframe}`
      
      console.log(`[LocalDataFeeds] 连接 WebSocket: ${wsUrl}`)
      
      const ws = new WebSocket(wsUrl)
      this._ws = ws

      ws.onopen = () => {
        // 再次检查 channel 是否仍然匹配（可能在连接过程中被取消）
        if (this._currentChannel === channel) {
          console.log(`[LocalDataFeeds] WebSocket 连接成功: ${channel}`)
        } else {
          console.log(`[LocalDataFeeds] WebSocket 连接成功但 channel 已变更，关闭连接: ${channel}`)
          ws.close()
        }
      }

      ws.onmessage = (event) => {
        try {
          // 检查 channel 是否仍然匹配
          if (this._currentChannel !== channel) {
            return
          }
          
          const data = JSON.parse(event.data) as KLineData
          
          if (this._callback) {
            this._callback(data)
          }
        } catch (error) {
          console.error('[LocalDataFeeds] 解析 WebSocket 消息失败:', error)
        }
      }

      ws.onerror = (error) => {
        console.error(`[LocalDataFeeds] WebSocket 错误: ${channel}`, error)
      }

      ws.onclose = (event) => {
        // 只有在 channel 匹配时才清理（避免清理新连接的资源）
        if (this._currentChannel === channel) {
          console.log(`[LocalDataFeeds] WebSocket 连接关闭: ${channel} (code: ${event.code}, reason: ${event.reason || 'none'})`)
          this._ws = undefined
          this._currentChannel = undefined
        }
      }
    } catch (error) {
      console.error(`[LocalDataFeeds] 订阅失败: ${channel}`, error)
      this._ws = undefined
      this._currentChannel = undefined
    }
  }

  /**
   * 取消订阅
   */
  unsubscribe (symbol: SymbolInfo, period: Period): void {
    if (this._ws) {
      const timeframe = this._convertPeriodToTimeframe(period)
      const channel = `${symbol.ticker}_${timeframe}`
      
      // 只有在 channel 匹配时才取消订阅
      if (this._currentChannel === channel) {
        console.log(`[LocalDataFeeds] 取消订阅: ${channel}`)
        
        // 只有在连接已建立或正在关闭时才关闭
        if (this._ws.readyState === WebSocket.OPEN || this._ws.readyState === WebSocket.CONNECTING) {
          this._ws.close()
        }
        
        this._ws = undefined
        this._currentChannel = undefined
        this._callback = undefined
      } else {
        console.log(`[LocalDataFeeds] 跳过取消订阅（channel 不匹配）: 当前=${this._currentChannel}, 请求=${channel}`)
      }
    }
  }
}

