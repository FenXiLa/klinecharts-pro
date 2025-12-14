// 简化版测试脚本 - 使用 tsx 运行
// 运行方式: 
//   npm run test:simple
//   或: npx tsx test-simple.js
import CCXTDataFeeds from './src/CCXTDataFeeds.ts'

async function runTest() {
  console.log('🚀 开始测试 CCXTDataFeeds');
  console.log('='.repeat(50));
  
  try {
    // 创建实例（支持代理）
    console.log('\n1. 创建 CCXTDataFeeds 实例...');
    
    // 从环境变量读取代理配置，如果没有则使用默认代理
    let proxies = undefined
    
    const httpsProxy = process.env.https_proxy || process.env.HTTPS_PROXY
    const httpProxy = process.env.http_proxy || process.env.HTTP_PROXY
    const allProxy = process.env.all_proxy || process.env.ALL_PROXY
    
    // 优先使用环境变量中的代理，如果没有则使用默认值
    if (httpsProxy || httpProxy || allProxy) {
      proxies = {
        http: httpProxy || httpsProxy || allProxy?.replace(/^socks5:\/\//, 'http://'),
        https: httpsProxy || httpProxy || allProxy?.replace(/^socks5:\/\//, 'http://')
      }
    } else {
      // 使用默认代理（如果环境变量都没有设置）
      proxies = {
        http: 'http://127.0.0.1:7890',
        https: 'http://127.0.0.1:7890'
      }
    }
    
    console.log('代理配置:', proxies)
    const datafeed = new CCXTDataFeeds('okx', undefined, proxies);
    console.log('✅ 实例创建成功');
    
    // 测试搜索
    console.log('\n2. 测试搜索标的...');
    const symbols = await datafeed.searchSymbols('BTC');
    console.log(`✅ 找到 ${symbols.length} 个标的`);
    
    if (symbols.length > 0) {
      const symbol = symbols[0];
      console.log(`   示例: ${symbol.ticker} - ${symbol.name}`);
      
      // 测试获取历史数据
      console.log('\n3. 测试获取历史数据...');
      const to = Date.now();
      const from = to - 24 * 60 * 60 * 1000; // 1天前
      
      const period = {
        multiplier: 15,
        timespan: 'minute',
        text: '15m'
      };
      
      const klineData = await datafeed.getHistoryKLineData(symbol, period, from, to);
      console.log(`✅ 成功获取 ${klineData.length} 根 K 线`);
      
      if (klineData.length > 0) {
        console.log(`   第一根: ${new Date(klineData[0].timestamp).toISOString()}, Close: ${klineData[0].close}`);
        console.log(`   最后一根: ${new Date(klineData[klineData.length - 1].timestamp).toISOString()}, Close: ${klineData[klineData.length - 1].close}`);
      }
    }
    
    console.log('\n' + '='.repeat(50));
    console.log('✅ 测试完成！');
    process.exit(0);
  } catch (error) {
    console.error('\n❌ 测试失败:', error);
    console.error('错误详情:', error.message);
    if (error.stack) {
      console.error('堆栈:', error.stack);
    }
    process.exit(1);
  }
}

runTest();
