/**
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at

 * http://www.apache.org/licenses/LICENSE-2.0

 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { KLineData } from 'klinecharts'

import { Datafeed, SymbolInfo, Period, DatafeedSubscribeCallback } from './types'


export default class DefaultDatafeed implements Datafeed {
  constructor (apiKey: string) {
    this._apiKey = apiKey
  }

  private _apiKey: string

  private _prevSymbolMarket?: string

  private _ws?: WebSocket

  // 转换 ticker 格式：从 X.BTCUSD 转换为 BTC-USD
  private _convertTickerFormat (ticker: string): string {
    // 如果已经是正确的格式，直接返回
    if (ticker.includes('-')) {
      return ticker
    }
    // 处理 X.BTCUSD 或 BTCUSD 格式
    const parts = ticker.replace(/^X\./, '').split('USD')
    if (parts.length === 2) {
      return `${parts[0]}-USD`
    }
    // 如果格式不对，尝试其他转换
    return ticker
  }

  // 转换 timespan 格式：从 KLineChart 格式转换为 Massive.com 格式
  private _convertTimespan (timespan: string): string {
    const map: Record<string, string> = {
      minute: 'minute',
      hour: 'hour',
      day: 'day',
      week: 'week',
      month: 'month',
      year: 'year'
    }
    return map[timespan] || timespan
  }

  async searchSymbols (search?: string): Promise<SymbolInfo[]> {
    // 根据文档，添加 market=crypto 参数来筛选加密货币
    const searchParam = search ? `&search=${encodeURIComponent(search)}` : ''
    const url = `https://api.massive.com/v3/reference/tickers?apiKey=${this._apiKey}&active=true&market=crypto${searchParam}`
    const response = await fetch(url)
    const result = await response.json()
    // 映射 Massive.com 的响应字段到 SymbolInfo（跳过 logo 生成）
    return (result.results || []).map((data: any) => ({
      ticker: data.ticker, // Massive.com 返回的 ticker 格式可能是 BTC-USD
      name: data.name || data.ticker,
      shortName: data.ticker,
      market: data.market || 'crypto',
      exchange: data.primary_exchange || 'crypto',
      priceCurrency: data.currency_name || 'USD',
      type: data.type || 'crypto',
      pricePrecision: 2, // 默认价格精度
      volumePrecision: 0  // 默认成交量精度（跳过 logo 生成）iVBORw0KGgoAAAANSUhEUgAAAIAAAACACAYAAADDPmHLAAAAAXNSR0IArs4c6QAAAARzQklUCAgICHwIZIgAAA66SURBVHic7Z17cFTVGcB/527AiKGgRA0ShGhKoQjFMb4qUMCMPIrWqdbHSEdlHDGgI9V2aq2d1hmKtVbRsSTGEcQRp4pStaZQlNYUwYLiSKU0SCMBDRCmoQSJGGF3T/84d2VZk+w9d899hf3NMBnl3ns+5vtyHt/5HoIehpQIaijDYjiSciRlwCCgBCgG+gNFQCGCAvUScaADaAfagFagBdiFoAlBI0m2UkWTEMgA/lmeIYIWIFdkLQNJMBbBJUjOA8agFOwF7cAmBO8hWUeMtWIWezwayxciZwByGb1pZTyCaUguA0YGLNIWBK8jWUExa8Q1HA5YHi0iYQByGTH2UYnkBmA6cHLQMnXBfqAOwXMMYLW4hkTQAmUj1AYgqzkLuAXBTUgGBi2PFoI9SJYAT4nZbA9anK4IpQHIhUzE4i4k04OWxQiCOpI8IubwZtCiZBIqA5A1TEdyH3Bh0LJ4xAYE80QVdUELkiIUBiCf4FIk85FcELQsviB4B8G94jb+GrwoASKfZBgJHkUyNUg5AkOwkhhzxa1sC06EAJALKUJwL3A30DsIGULEYeBhJPPFHNr9Htx3A5A1TECyGCjze+yQ04Rgpqii3s9BfTMAWUsfksxD8iO/xowkggVY3Cdmccif4XxAPskw4rwCjPBjvB5AAwVc6cfewPJ6AFnNzcTZSF75OowgzkZZzc1eD+SZAUiJkNX8FlgM9PVqnB5MX2CxrOa3Uno3U3vyYVlLPxIshR7iyQueOmLMELM4YPrDxg1A1jKQJKuQjDL97eMawWYsJpu+fjZqAPL3DMFiNVBu8rt5vqSRJJXidnaa+qAxA5CPU0aMvwFDTX0zT6fsIMEkcQdNJj5mxADs3/x68sr3ix0kmWBiJsjZAOyQrDXkp32/aSTG+Fz3BDkZgKylH0neym/4AkJtDMflcjpw7QeQEkGCpXnlB4hkFAmW5uIncO8IquFB8uf8MDDd1oUrXFmO7aJc7HbQPJ4wU8zmad2XtA3AvtjZSN69GzYOUkCF7gWSlgHIWvqQyF/shJgGYlToXCXr7QGSzCOv/DAzwtaRYxzPAHYkT+jCmvN0gmCi08giRwZgx/B9QD6MKyo0IRntJMbQ2RKgAjjzyo8OZbbOspJ1BrB3/ZvJR+9GjcMUMCrbqSD7DJDgUfLKjyK9bd11S7czgHyCS0my2pxMIaHvUCgshl5FUFQKQtWJ4FALHGmHz5rhizY43BaomEawqOwuA6mg25cl840L5DexQiithNMvhNMvglMr4IT+zt5t3QS762H332FXfTQNQumwy1zLLmcAO1HzNU+E8oNTK+AbN8KwGc4V3h3JODS9Av98GPauz/17fiK4vKuE1K4NoJr1RDFLd+BY+PYCOK3CuzH2rof3fg07Q5Pkm40NYjYXdfYXnRqAXMhEBH/zVibDFBbDRQ/AiFv8G3PbUlhTpfYNYUcyqbP6BJ2fAizu8lwgkwwcC9c3+Kt8UMvLtZuhZKy/47qhC51+ZQawy7J85LlApjhjAkx7Te3ogyIZhz9PhebQH5jOzixX09kM4POvUQ6cdTVc/kawygewCmDKy2omCjdf0e0xM4BdjeuTSBRk6jtUTb9BKz+djlZ4eRy0bQ1aks4R7GEAg9Orlx07A6hSbOFXPsCkp8OlfFAb0UnaQTn+IRnIPirT/1dBxgM3+CqQW0beptZ+NyTj0LIW9m6A//0L2puP/l1RKXytHAZ9RzmNYoX63z/9IrU53LbUnXxeo3S8KvWfXy4BdgXOFsJbhFFhFcAPP4E+JXrvJeOw+TH44NFjld4VfUrg3Htg5Cx9QzjUAn8YEVbP4X6KKUlVND26BLQynrArH9TGT1f5h1pg+fnw9o+dKT/1zrq58MeL4UCj3nh9StQsFU5OtnUNpBuAYFog4ugy5Lt6z3/RBq9OVH59N7RuUu93tOq9N3KWu/H8IE3XRw1AFV4OP2dO0Xt+4/2578o/a1YePx36DoXiMbmN6xVpurbAzu8Lvup2dgqL1R+nHGmHLU+YGfujl/RnkUGV2Z8JhpG2zu0ZIEHoPRgA9NPMP21eDYkOc+M3LNJ7/rTzzI1tGlvnygAElwQqjFPc7MZNouvq1TVYP7F1rgxAddrIkw3dvYTOcuU3ts4L7B47Id2tZHBwh97zXvwGNr4AfU539uyhvebHN8cYKREiUrd/sUK49XPnzyfj8FyZ87P/8cfZFhbDg5bCMYkOdSRzilUAFz/knTxRx2K4hYxYaZcdmmFY5ddBxa88ESXySMotu69edNi+XP+d838Jlz4bvtvDoJGUWaimitFhz1p3a/qwGXBdg/qZJ8UgC9VRMzokOuDdX7h7t6hUzQTX2fGDbq57exYlQlbzb6KY83/1uyr2PxeOtKtY/w+fUQkgybgJyaJEg5DV7IaIRAGlc8o58P1/mFvXj7SrOP+df4aP/6J/+xdN9ghZzadEtd7PmVNg6mvquGeSZFzNCB8th8bnwxrYYYKDQlZzGOgVtCSuGXELjK8xbwQpEh3KCLbURi8lLDtHhKwhiYcNCXzhzClw2YveH/N218O796ufPQGB7BkGANB/OEx9Wf30mubV8NYd4Q3/dopAWkh6xta3bSssO1clbZqMAeiM0kq45n3lYfRq6fEDSTzam8Cu6FcOYx/XDx9zw+56eON687EH/nDQAv+7VXrOgUaVq/fyOHXO9/J8f8YE+N6b4Q7+6Jr26DqCdOhXDufcrgpGmCgW0RmHWuCVcfoh5MHSIGQ1a4BxQUviC7FCtSycdRUMmW7eGNq2wkvnR6NegOItIatZBvwgaEl8xypQ03f5tcooTio1892ddbDicjPf8p4XC4BdQUsRCMm4Os6lAj1PrYCzr1bLhG7mUTpDpsM3boIPl5iQ0mt2WQgz3aciz383wvp74NnBsOoH7jOJAC5ZAL092muYRNBkIYjUrsVzknHY/hK8eK77490J/WH0XPOymUbQaJEk4u4sD2l8Hl4YBZ+syv5sJqPmhN9JlGSrRRVN9ERfgCk6WmHlldCyTu+9wmL3NQz8oZ0qmiwhkEAOC95xQKIDVl2tf7wbPNkbecywSQikmqME7yFDnB/Yq0jVBXDK5y0qqMMkh1rgg8fgvJ87fyes2cGgdE6qRIxkHXBnkPJ0i27tnb3rzRsAKLeyjgGE2T2sdG7nBsZYG6gw2dD15Zty6mTy3416z+fiT/AaW+cWgN1/dkugAnXHZ816629RqXeJmTqZSeGNOt6S6jmcXiLm9cDEcYLuJcsQj5qanhji32qnpOk6vUTMikCEcYru9DvMg4p3/cr1zvY6s4WfpOn6qAEUswbYH4Q8jtB1xpRWmp8Fvq6ZVfTpDrPjm2G/rWsgzQDsunHhLYD/8V9UxS8dxj1ubiN2UimMuVvvnX2hdK/UpWoEQmapWMFzvovjlCPt+jV6+g5V0Tp9h+Y2dp8SuMJFUeqPXbiQvSZDx8cawABWI9TuMJS8/xv9jJ3+w1VR6dFz3fnmB09RGUi60cZftIWvfLwqFn2MUMcYgLiGBJIlvgqlQ0crvP0T/fd6Fakr2hv3qJ+Dp3R/TDzlHPjmbXDVuzB9pbsZpGGR99HJukiWpFcKh6g2jJhWp18xtDMOtSglpa58+5QcbSeXC+3N6hYxfCllX2kY0XnPoBpeQ+LRQdoAJ5Wq7OCwetpWXB6+hlKCOlHFV2LVOu8ZlOQRzwXKhc+aVf3eMMbiNywKn/KhS51Gu21c/+Fqlx+WmWD7cnjjujDWGeiybVzXvYMF8zwTxxRtW1Usfi7xe6b48JmwKr9bXXbfO7iGDUguMC+RYawCuGAefOtu/8OwjrSrjOF//s7fcZ0ieEdUdT2Td9893GEP+sBJxlVE7/Mj1J29XzS9qnb7YVU+ZNVh1rRwWcMKJFPNSeQDp5yjHD/l15qvGZDoUEbWsCh8jp5MBCtFVfeNQLIbwJMMI85moLcxwfwilQo2eLJq5uQ2ROuLNnUbuX05/CcyJWMOU8AocSvbunvIUWEIWc184GdGxAqSXkWqzWvxGCgcoJw+J2Y4flI3eAd3qq5i+zZFLeEzxQNidvYl3JkBLKQIwQcQsaqixy9NSEaLOdnD/bvfBNqIObQjmJm7XHl8QTDTifLBoQEAiCrqESxwL1UeXxAsEFXUO33csQHYT98HNGiKlMc/GmwdOUa7Oph9KthIT6srFH0OUkBFtl1/JnozAGAPEN4kkuOXO3WVDy4MAEDM5mkg34ojPDxk60Qb1wUi7WZTf4IQxw0cH9RRxRV2kq82rmYAACGQxJiBYLPbb+TJEcFmYsxwq3zIwQAAxCwOYDEZ8lVGAqARi8liFgdy+UhOBgB2XmGSSmBHrt/K45gdJKlM5fflQs4GACBuZycJJpE3Aj/YQYJJ4nZ2mviYEQMAEHfQRJIJ5JcDL2kkyQRxh7nKbsbLxMtaBpJkFZJRpr99XCPYbK/5RhN3jM0AKcQs9mAxjjDnGUaPOizGmVY+eDADpLD9BA8CLlJ58qTxEFX8NJejXnd43ilEVnMz8Bj5uwNdDgJ3uvXwOcWXVjH2BdIr9PSy9OZooIAr3fj2dTG+B+gMcSvbiFGRjydwgGABMf1bPffD+YysYQKSxeTDyzJpQjBTJ5jDBL7MAOmIKuqRjAYegKOVKo5jDgMPIBntt/IhgBkgHfkkw0jwaOTyDkwhWEmMuX5N952LEALkE1yKZH4k0tBMIHgHwb3iNv4avCghQtYwHcl9hD0r2T0bEMwTVeFxkoXKAFLIhUzE4q5QF6nQQVBHkkfEHN4MWpRMQmkAKexyNbcguAkZsRb3gj12vaWnMsuyhIlQG0AKuYwY+6hEcgMqBO3koGXqgv1AHYLnGMDqzIJMYSQSBpCOXEZvWhmPYBqSy4CRAYu0BcHrSFZQzJr0IoxRIHIGkImsZSAJxiK4BMl5wBjAqz7y7cAmu8HGOmKs9eKGzk8ibwCZ2LeQZVgMR1KOpAwYBJQAxUB/lIEUIr5smBEHOlAKbgNagRZgF4ImBI0k2UoVTV7dygXF/wF+fTz59Jc5ygAAAABJRU5ErkJggg=='
    }))
  }

  async getHistoryKLineData (symbol: SymbolInfo, period: Period, from: number, to: number): Promise<KLineData[]> {
    // 转换 ticker 格式：X.BTCUSD -> BTC-USD
    const ticker = this._convertTickerFormat(symbol.ticker)
    // 转换 timespan 格式
    const timespan = this._convertTimespan(period.timespan)
    
    // 将时间戳转换为秒（如果 Massive.com 使用秒）
    const fromSec = Math.floor(from / 1000)
    const toSec = Math.floor(to / 1000)
    
    const url = `https://api.massive.com/v2/aggs/ticker/${ticker}/range/${period.multiplier}/${timespan}/${fromSec}/${toSec}?apiKey=${this._apiKey}`
    console.log('[DefaultDatafeed] Fetching history data:', {
      ticker,
      period: `${period.multiplier}${timespan}`,
      from: new Date(fromSec * 1000).toISOString(),
      to: new Date(toSec * 1000).toISOString(),
      url: url.replace(this._apiKey, 'API_KEY')
    })
    
    try {
      const response = await fetch(url)
      if (!response.ok) {
        const errorText = await response.text()
        console.error('[DefaultDatafeed] API error:', response.status, response.statusText, errorText)
        throw new Error(`API request failed: ${response.status} ${response.statusText}`)
      }
      
      const result = await response.json()
      console.log('[DefaultDatafeed] API response:', {
        resultsCount: result.results?.length || 0,
        status: result.status,
        queryCount: result.queryCount,
        apiResultsCount: result.resultsCount
      })
      
      // Massive.com 返回的字段：
      // s: start timestamp (Unix milliseconds)
      // e: end timestamp (Unix milliseconds)  
      // o: open, h: high, l: low, c: close, v: volume, vw: volume weighted average price
      const klineData = (result.results || []).map((data: any) => ({
        timestamp: data.s || data.t, // 使用 start timestamp，如果没有 s 则使用 t
        open: data.o,
        high: data.h,
        low: data.l,
        close: data.c,
        volume: data.v,
        turnover: data.vw || (data.c * data.v) // 如果没有 vw，用 close * volume 估算
      }))
      
      console.log('[DefaultDatafeed] Converted KLine data:', klineData.length, 'bars')
      if (klineData.length > 0) {
        console.log('[DefaultDatafeed] First bar:', klineData[0])
        console.log('[DefaultDatafeed] Last bar:', klineData[klineData.length - 1])
      }
      
      return klineData
    } catch (error) {
      console.error('[DefaultDatafeed] Error fetching history data:', error)
      throw error
    }
  }

  subscribe (symbol: SymbolInfo, period: Period, callback: DatafeedSubscribeCallback): void {
    // 转换 ticker 格式：X.BTCUSD -> BTC-USD
    const ticker = this._convertTickerFormat(symbol.ticker)
    console.log('[DefaultDatafeed] subscribe called with ticker:', symbol.ticker, '-> converted to:', ticker)
    
    // 如果市场变化或 WebSocket 未连接，重新建立连接
    if (this._prevSymbolMarket !== symbol.market || !this._ws || this._ws.readyState !== WebSocket.OPEN) {
      this._ws?.close()
      
      // 根据提供的 WebSocket 连接方式：
      // 1. 连接到 wss://socket.massive.com/crypto
      // 2. 发送认证消息：{"action":"auth","params":"API_KEY"}
      // 3. 发送订阅消息：{"action":"subscribe", "params":"XA.BTC-USD"}
      const wsUrl = `wss://socket.massive.com/crypto`
      console.log('[DefaultDatafeed] Connecting to WebSocket:', wsUrl)
      
      this._ws = new WebSocket(wsUrl)
      let isAuthenticated = false
      let pendingSubscription = ticker
      
      this._ws.onopen = () => {
        console.log('[DefaultDatafeed] WebSocket connected')
        // 第一步：发送认证消息
        this._ws?.send(JSON.stringify({
          action: 'auth',
          params: this._apiKey
        }))
        console.log('[DefaultDatafeed] Authentication request sent')
      }
      
      this._ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data)
          console.log('[DefaultDatafeed] WebSocket message received:', message)
          
          // Massive.com 可能返回数组格式或单个对象
          const messages = Array.isArray(message) ? message : [message]
          
          for (const data of messages) {
            // 处理认证响应和状态消息
            if (data.ev === 'status' || data.status || data.type === 'status' || data.action) {
              console.log('[DefaultDatafeed] WebSocket status/auth response:', data)
              
              // 检查认证失败
              if (data.status === 'auth_failed') {
                console.warn('[DefaultDatafeed] WebSocket authentication failed:', data.message)
                console.warn('[DefaultDatafeed] Your plan does not include WebSocket access. Real-time updates will not be available.')
                console.warn('[DefaultDatafeed] Historical data via REST API should still work.')
                // 关闭 WebSocket 连接
                this._ws?.close()
                return
              }
              
              // 如果认证成功，发送订阅消息
              if (!isAuthenticated && (data.status === 'auth_success' || data.status === 'success' || data.message?.includes('success'))) {
                isAuthenticated = true
                // 订阅格式：XA.BTC-USD（XA 表示 aggregates per minute）
                const subscribeParams = `XA.${pendingSubscription}`
                this._ws?.send(JSON.stringify({
                  action: 'subscribe',
                  params: subscribeParams
                }))
                console.log('[DefaultDatafeed] Subscription request sent:', subscribeParams)
              }
              continue
            }
            
            // 处理数据消息
            // 根据文档 https://massive.com/docs/websocket/crypto/aggregates-per-minute
            // 响应格式：{ ev: 'XA', pair: 'BTC-USD', o, c, h, l, v, s, e, vw }
            // ev 为 'XA' 表示 aggregates per minute 事件
            // s 为开始时间戳（Unix 毫秒），e 为结束时间戳（Unix 毫秒）
            if (data.ev === 'XA') {
              const dataTicker = data.pair
              // 验证 ticker 是否匹配
              if (dataTicker === pendingSubscription) {
                console.log('[DefaultDatafeed] Received XA data for:', dataTicker, {
                  timestamp: new Date(data.s).toISOString(),
                  o: data.o,
                  c: data.c,
                  h: data.h,
                  l: data.l,
                  v: data.v
                })
                callback({
                  timestamp: data.s, // start timestamp (Unix milliseconds)
                  open: data.o,
                  high: data.h,
                  low: data.l,
                  close: data.c,
                  volume: data.v,
                  turnover: data.vw || (data.c * data.v) // volume weighted average price
                })
              } else {
                console.log('[DefaultDatafeed] Received XA data for different ticker:', dataTicker, 'expected:', pendingSubscription)
              }
            }
          }
        } catch (error) {
          console.error('[DefaultDatafeed] WebSocket message parse error:', error, 'Raw message:', event.data)
        }
      }
      
      this._ws.onerror = (error) => {
        console.error('[DefaultDatafeed] WebSocket error:', error)
      }
      
      this._ws.onclose = (event) => {
        console.log('[DefaultDatafeed] WebSocket closed', {
          code: event.code,
          reason: event.reason,
          wasClean: event.wasClean
        })
        isAuthenticated = false
      }
    } else {
      // WebSocket 已连接，只需订阅新的 ticker
      console.log('[DefaultDatafeed] WebSocket already connected, subscribing to:', `XA.${ticker}`)
      this._ws.send(JSON.stringify({
        action: 'subscribe',
        params: `XA.${ticker}`
      }))
    }
    
    this._prevSymbolMarket = symbol.market
  }

  unsubscribe(symbol: SymbolInfo, period: Period): void {
    if (this._ws && this._ws.readyState === WebSocket.OPEN) {
      const ticker = this._convertTickerFormat(symbol.ticker)
      // 取消订阅格式：XA.BTC-USD
      this._ws.send(JSON.stringify({
        action: 'unsubscribe',
        params: `XA.${ticker}`
      }))
      console.log('[DefaultDatafeed] Unsubscribed from:', `XA.${ticker}`)
    }
  }
}