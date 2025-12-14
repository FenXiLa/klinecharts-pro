#!/bin/bash

# 代理测试脚本
PROXY=${https_proxy:-${HTTPS_PROXY:-${http_proxy:-${HTTP_PROXY:-http://127.0.0.1:7890}}}}

echo "🔍 代理测试"
echo "使用的代理: $PROXY"
echo ""

echo "1. 测试代理服务器连接:"
PROXY_HOST=$(echo $PROXY | sed -E 's|https?://([^:]+):.*|\1|')
PROXY_PORT=$(echo $PROXY | sed -E 's|https?://[^:]+:([0-9]+).*|\1|')

if timeout 2 bash -c "echo > /dev/tcp/$PROXY_HOST/$PROXY_PORT" 2>/dev/null; then
  echo "✅ 代理服务器可达 ($PROXY_HOST:$PROXY_PORT)"
  PROXY_OK=true
else
  echo "⚠️  代理服务器不可达 ($PROXY_HOST:$PROXY_PORT)"
  PROXY_OK=false
fi

echo ""
echo "2. 测试直接访问获取 IP:"
DIRECT_IP=$(curl -s --connect-timeout 5 --max-time 10 "https://api64.ipify.org/?format=json" 2>/dev/null | grep -o '"ip":"[^"]*"' | cut -d'"' -f4)
if [ -n "$DIRECT_IP" ]; then
  echo "✅ 真实 IP: $DIRECT_IP"
else
  echo "❌ 无法获取 IP"
  DIRECT_IP="未获取到"
fi

echo ""
echo "3. 测试通过代理访问获取 IP:"
PROXY_IP=$(curl --proxy "$PROXY" -s --connect-timeout 5 --max-time 10 "https://api64.ipify.org/?format=json" 2>/dev/null | grep -o '"ip":"[^"]*"' | cut -d'"' -f4)
if [ -n "$PROXY_IP" ]; then
  echo "✅ 代理后的 IP: $PROXY_IP"
else
  echo "❌ 无法获取 IP（代理访问失败）"
  PROXY_IP="未获取到"
fi

echo ""
echo "结果对比:"
echo "  直接访问 IP: $DIRECT_IP"
echo "  代理访问 IP: $PROXY_IP"

if [ "$DIRECT_IP" != "未获取到" ] && [ "$PROXY_IP" != "未获取到" ]; then
  if [ "$DIRECT_IP" != "$PROXY_IP" ]; then
    echo "✅ 代理工作正常！IP 地址已更改"
    echo "   IP 变化: $DIRECT_IP → $PROXY_IP"
  else
    echo "⚠️  代理可能未生效，IP 地址相同"
  fi
fi

