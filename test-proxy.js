// 测试代理是否工作
// 运行方式: npx tsx test-proxy.js

import https from 'https'
import http from 'http'
import { HttpsProxyAgent } from 'https-proxy-agent'

async function testProxy() {
  console.log('🔍 测试代理连接')
  console.log('='.repeat(50))
  
  // 获取代理配置
  const proxyUrl = process.env.https_proxy || process.env.HTTPS_PROXY || process.env.http_proxy || process.env.HTTP_PROXY || 'http://127.0.0.1:7890'
  
  console.log(`\n使用的代理: ${proxyUrl}`)
  
  // 测试 1: 检查代理是否可达
  console.log('\n1. 测试代理连接...')
  try {
    const url = new URL(proxyUrl)
    const testReq = http.request({
      hostname: url.hostname,
      port: url.port || 7890,
      path: '/',
      method: 'GET',
      timeout: 5000
    }, (res) => {
      console.log(`✅ 代理服务器连接成功 (${url.hostname}:${url.port || 7890})`)
    })
    
    testReq.on('error', (error) => {
      console.log(`⚠️  代理服务器连接测试失败: ${error.message}`)
      console.log(`   请确保代理服务正在运行: ${url.hostname}:${url.port || 7890}`)
    })
    
    testReq.on('timeout', () => {
      testReq.destroy()
      console.log('⚠️  代理服务器连接超时')
    })
    
    testReq.end()
    
    // 等待一下
    await new Promise(resolve => setTimeout(resolve, 2000))
  } catch (error) {
    console.log(`❌ 代理配置解析失败: ${error.message}`)
  }
  
  // 测试 2: 不使用代理直接访问（获取真实 IP）
  console.log('\n2. 测试不使用代理的 IP 地址...')
  await testIP(false, proxyUrl)
  
  // 测试 3: 使用代理访问（获取代理后的 IP）
  console.log('\n3. 测试使用代理后的 IP 地址...')
  await testIP(true, proxyUrl)
  
  console.log('\n' + '='.repeat(50))
  console.log('✅ 代理测试完成')
}

async function testIP(useProxy, proxyUrl) {
  return new Promise((resolve) => {
    const options = {
      hostname: 'api.ipify.org',
      port: 443,
      path: '/?format=json',
      method: 'GET',
      timeout: 10000
    }
    
    if (useProxy && proxyUrl) {
      try {
        const agent = new HttpsProxyAgent(proxyUrl)
        options.agent = agent
        console.log(`   通过代理 ${proxyUrl} 访问...`)
      } catch (error) {
        console.log(`   ⚠️  创建代理 agent 失败: ${error.message}`)
        resolve()
        return
      }
    } else {
      console.log('   直接访问（不使用代理）...')
    }
    
    const req = https.request(options, (res) => {
      let data = ''
      
      res.on('data', (chunk) => {
        data += chunk
      })
      
      res.on('end', () => {
        try {
          const result = JSON.parse(data)
          if (useProxy) {
            console.log(`   ✅ 代理后的 IP 地址: ${result.ip}`)
          } else {
            console.log(`   ✅ 真实 IP 地址: ${result.ip}`)
          }
        } catch (error) {
          console.log(`   ❌ 解析响应失败: ${error.message}`)
          console.log(`   响应内容: ${data}`)
        }
        resolve()
      })
    })
    
    req.on('error', (error) => {
      if (useProxy) {
        console.log(`   ❌ 通过代理访问失败: ${error.message}`)
        console.log(`      可能是代理配置不正确或代理服务未运行`)
      } else {
        console.log(`   ❌ 直接访问失败: ${error.message}`)
      }
      resolve()
    })
    
    req.on('timeout', () => {
      req.destroy()
      if (useProxy) {
        console.log(`   ⚠️  通过代理访问超时`)
      } else {
        console.log(`   ⚠️  直接访问超时`)
      }
      resolve()
    })
    
    req.end()
  })
}

// 运行测试
testProxy().catch(error => {
  console.error('❌ 测试失败:', error)
  process.exit(1)
})

