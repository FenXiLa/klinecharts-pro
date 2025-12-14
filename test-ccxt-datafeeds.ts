/**
 * CCXTDataFeeds 独立测试脚本
 * 用于测试 CCXTDataFeeds 的各项功能
 * 
 * 运行方式：
 * 1. 确保已安装依赖：npm install
 * 2. 使用 npm 脚本运行：npm run test:ccxt
 * 3. 或者直接使用 tsx：npx tsx test-ccxt-datafeeds.ts
 */

import CCXTDataFeeds from './src/CCXTDataFeeds'

async function testSearchSymbols () {
  console.log('\n=== 测试 1: 搜索标的 ===')
  try {
    const datafeed = new CCXTDataFeeds('okx')
    
    // 测试搜索 BTC
    console.log('\n搜索 "BTC"...')
    const btcSymbols = await datafeed.searchSymbols('BTC')
    console.log(`找到 ${btcSymbols.length} 个匹配的标的`)
    
    if (btcSymbols.length > 0) {
      console.log('前 5 个结果:')
      btcSymbols.slice(0, 5).forEach((symbol, index) => {
        console.log(`  ${index + 1}. ${symbol.ticker} - ${symbol.name} (${symbol.exchange})`)
      })
    }
    
    return btcSymbols.length > 0 ? btcSymbols[0] : null
  } catch (error) {
    console.error('❌ 搜索标的失败:', error)
    return null
  }
}

async function testGetHistoryData (symbol: any) {
  console.log('\n=== 测试 2: 获取历史数据 ===')
  
  if (!symbol) {
    console.log('⚠️  跳过测试：没有可用的标的')
    return
  }
  
  try {
    const datafeed = new CCXTDataFeeds('okx')
    
    // 测试获取最近 7 天的 15 分钟 K 线数据
    const to = Date.now()
    const from = to - 7 * 24 * 60 * 60 * 1000 // 7 天前
    
    console.log(`\n获取 ${symbol.ticker} 的历史数据:`)
    console.log(`  周期: 15 分钟`)
    console.log(`  时间范围: ${new Date(from).toISOString()} 到 ${new Date(to).toISOString()}`)
    
    const period = {
      multiplier: 15,
      timespan: 'minute',
      text: '15m'
    }
    
    const klineData = await datafeed.getHistoryKLineData(symbol, period, from, to)
    
    console.log(`\n✅ 成功获取 ${klineData.length} 根 K 线`)
    
    if (klineData.length > 0) {
      console.log('\n前 3 根 K 线数据:')
      klineData.slice(0, 3).forEach((candle, index) => {
        console.log(`  ${index + 1}. ${new Date(candle.timestamp).toISOString()}`)
        console.log(`     O: ${candle.open}, H: ${candle.high}, L: ${candle.low}, C: ${candle.close}`)
        console.log(`     V: ${candle.volume}, T: ${candle.turnover}`)
      })
      
      console.log('\n最后 1 根 K 线数据:')
      const last = klineData[klineData.length - 1]
      console.log(`  时间: ${new Date(last.timestamp).toISOString()}`)
      console.log(`  O: ${last.open}, H: ${last.high}, L: ${last.low}, C: ${last.close}`)
      console.log(`  V: ${last.volume}, T: ${last.turnover}`)
    } else {
      console.log('⚠️  没有获取到数据')
    }
    
    return klineData.length > 0
  } catch (error) {
    console.error('❌ 获取历史数据失败:', error)
    if (error instanceof Error) {
      console.error('   错误信息:', error.message)
      console.error('   堆栈:', error.stack)
    }
    return false
  }
}

async function testSubscribe (symbol: any) {
  console.log('\n=== 测试 3: 订阅实时数据 ===')
  
  if (!symbol) {
    console.log('⚠️  跳过测试：没有可用的标的')
    return
  }
  
  try {
    const datafeed = new CCXTDataFeeds('okx')
    
    const period = {
      multiplier: 15,
      timespan: 'minute',
      text: '15m'
    }
    
    console.log(`\n订阅 ${symbol.ticker} 的实时数据 (15分钟)...`)
    console.log('等待 10 秒接收数据...')
    
    let receivedCount = 0
    const startTime = Date.now()
    
    datafeed.subscribe(symbol, period, (candle) => {
      receivedCount++
      console.log(`\n📊 收到第 ${receivedCount} 根实时 K 线:`)
      console.log(`  时间: ${new Date(candle.timestamp).toISOString()}`)
      console.log(`  O: ${candle.open}, H: ${candle.high}, L: ${candle.low}, C: ${candle.close}`)
      console.log(`  V: ${candle.volume}, T: ${candle.turnover}`)
    })
    
    // 等待 10 秒
    await new Promise(resolve => setTimeout(resolve, 10000))
    
    // 取消订阅
    datafeed.unsubscribe(symbol, period)
    
    console.log(`\n✅ 订阅测试完成，共收到 ${receivedCount} 根 K 线`)
    
    return receivedCount > 0
  } catch (error) {
    console.error('❌ 订阅实时数据失败:', error)
    if (error instanceof Error) {
      console.error('   错误信息:', error.message)
    }
    return false
  }
}

async function testMultipleExchanges () {
  console.log('\n=== 测试 4: 测试多个交易所 ===')
  
  const exchanges = ['okx', 'binance', 'coinbase']
  
  for (const exchangeId of exchanges) {
    console.log(`\n测试交易所: ${exchangeId}`)
    try {
      const datafeed = new CCXTDataFeeds(exchangeId)
      
      // 尝试搜索 BTC
      const symbols = await datafeed.searchSymbols('BTC/USDT')
      console.log(`  ✅ ${exchangeId} 可用，找到 ${symbols.length} 个标的`)
      
      if (symbols.length > 0) {
        const symbol = symbols.find(s => s.ticker.includes('BTC') && s.ticker.includes('USDT'))
        if (symbol) {
          console.log(`  示例标的: ${symbol.ticker}`)
        }
      }
    } catch (error) {
      console.log(`  ❌ ${exchangeId} 测试失败:`, error instanceof Error ? error.message : error)
    }
  }
}

async function runAllTests () {
  console.log('🚀 开始测试 CCXTDataFeeds')
  console.log('='.repeat(50))
  
  try {
    // 测试 1: 搜索标的
    const symbol = await testSearchSymbols()
    
    // 测试 2: 获取历史数据
    const historySuccess = await testGetHistoryData(symbol)
    
    // 测试 3: 订阅实时数据（仅在历史数据成功时测试）
    if (historySuccess) {
      await testSubscribe(symbol)
    }
    
    // 测试 4: 测试多个交易所
    await testMultipleExchanges()
    
    console.log('\n' + '='.repeat(50))
    console.log('✅ 所有测试完成！')
  } catch (error) {
    console.error('\n❌ 测试过程中发生错误:', error)
    if (error instanceof Error) {
      console.error('   错误信息:', error.message)
      console.error('   堆栈:', error.stack)
    }
    process.exit(1)
  }
}

// 运行测试（ES modules 兼容）
// 直接执行所有测试
runAllTests().catch(error => {
  console.error('未捕获的错误:', error)
  process.exit(1)
})

export { runAllTests, testSearchSymbols, testGetHistoryData, testSubscribe }

