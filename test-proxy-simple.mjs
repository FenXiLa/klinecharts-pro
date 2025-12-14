// 简单的代理测试脚本 - 使用 Node.js 内置模块和 curl 方式
import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

const proxyUrl = process.env.https_proxy || process.env.HTTPS_PROXY || process.env.http_proxy || process.env.HTTP_PROXY || 'http://127.0.0.1:7890'

console.log('🔍 代理测试')
console.log('使用的代理:', proxyUrl)
console.log('')

// 使用 curl 测试代理（更可靠）
async function testWithCurl(useProxy = false) {
  try {
    let command
    if (useProxy) {
      command = `curl --proxy ${proxyUrl} --connect-timeout 5 --max-time 10 -s "https://api64.ipify.org/?format=json"`
    } else {
      command = 'curl --connect-timeout 5 --max-time 10 -s "https://api64.ipify.org/?format=json"'
    }
    
    const { stdout, stderr } = await execAsync(command)
    
    if (stderr && !stderr.includes('Warning')) {
      throw new Error(stderr)
    }
    
    const result = JSON.parse(stdout.trim())
    return result.ip
  } catch (error) {
    return null
  }
}

// 测试代理服务器是否可达
async function testProxyServer() {
  try {
    const url = new URL(proxyUrl)
    const command = `nc -zv ${url.hostname} ${url.port || 7890} 2>&1 || timeout 3 bash -c "</dev/tcp/${url.hostname}/${url.port || 7890}" 2>&1 || echo "连接失败"`
    
    try {
      const { stdout } = await execAsync(command, { timeout: 3000 })
      if (stdout.includes('succeeded') || stdout.includes('open')) {
        return true
      }
      return false
    } catch {
      return false
    }
  } catch {
    return false
  }
}

// 运行测试
async function run() {
  console.log('1. 测试代理服务器连接:')
  const proxyOk = await testProxyServer()
  if (proxyOk) {
    console.log('✅ 代理服务器可达')
  } else {
    console.log('⚠️  代理服务器可能未运行或无法连接')
  }
  
  console.log('\n2. 测试直接访问:')
  const directIP = await testWithCurl(false)
  if (directIP) {
    console.log(`✅ 真实 IP: ${directIP}`)
  } else {
    console.log('❌ 无法获取 IP（直接访问失败）')
  }
  
  console.log('\n3. 测试通过代理访问:')
  const proxyIP = await testWithCurl(true)
  if (proxyIP) {
    console.log(`✅ 代理后的 IP: ${proxyIP}`)
  } else {
    console.log('❌ 无法获取 IP（代理访问失败）')
  }
  
  console.log('\n结果对比:')
  console.log('  直接访问 IP:', directIP || '未获取到')
  console.log('  代理访问 IP:', proxyIP || '未获取到')
  
  if (directIP && proxyIP) {
    if (directIP !== proxyIP) {
      console.log('✅ 代理工作正常！IP 地址已更改')
      console.log(`   IP 变化: ${directIP} → ${proxyIP}`)
    } else {
      console.log('⚠️  代理可能未生效，IP 地址相同')
    }
  } else if (!proxyIP && proxyOk) {
    console.log('❌ 代理服务器可达，但通过代理访问失败')
    console.log('   可能是代理配置问题或目标网站访问受限')
  }
}

run().catch(console.error)
