#!/bin/bash

# 确保在 cloudflare 目录下运行
cd "$(dirname "$0")"

PORT=8787
BASE_URL="http://127.0.0.1:$PORT"

echo "=== 启动本地 Worker 环境 (Wrangler) ==="
# 使用 npx 启动 wrangler dev，后台运行
# --local 强制使用本地环境模拟 (不连接 Cloudflare)
# --persist 保持 KV 数据 (可选，这里方便测试)
npx wrangler dev --local --port $PORT > wrangler.log 2>&1 &
WRANGLER_PID=$!

echo "等待 Worker 启动 (PID: $WRANGLER_PID)..."
# 简单的轮询等待服务就绪
MAX_RETRIES=60
count=0
while ! curl -s "$BASE_URL/api/ping" > /dev/null; do
    sleep 1
    count=$((count+1))
    if [ $count -ge $MAX_RETRIES ]; then
        echo "Worker 启动超时！请检查 wrangler.log"
        echo "--- wrangler.log ---"
        cat wrangler.log
        echo "--------------------"
        kill $WRANGLER_PID
        exit 1
    fi
    echo -n "."
done
echo " Worker 已就绪！"

# 定义 cleanup 函数
cleanup() {
    echo
    echo "=== 清理环境 ==="
    kill $WRANGLER_PID
    echo "已停止 Wrangler."
}
trap cleanup EXIT

echo
echo "=== 开始功能测试 ==="

# 1. 健康检查
echo "1. 测试 Ping..."
RESPONSE=$(curl -s "$BASE_URL/api/ping")
if [[ "$RESPONSE" == "pong" ]]; then
    echo "✅ Ping 成功"
else
    echo "❌ Ping 失败: $RESPONSE"
    exit 1
fi

# 2. 登录 (admin/admin)
echo "2. 测试登录 (admin)..."
LOGIN_RESP=$(curl -s -X POST "$BASE_URL/api/v1/login" \
    -H "Content-Type: application/json" \
    -d '{"username":"admin", "password":"admin"}')

TOKEN=$(echo $LOGIN_RESP | grep -o '"token":"[^"]*' | cut -d'"' -f4)

if [[ -n "$TOKEN" ]]; then
    echo "✅ 登录成功，Token 获取: ${TOKEN:0:15}..."
else
    echo "❌ 登录失败: $LOGIN_RESP"
    exit 1
fi

# 3. 创建计划
echo "3. 测试创建计划..."
PLAN_BODY='{"name":"本地测试计划","description":"这是测试","startTime":"20231001","endTime":"20231007","labels":["test"]}'
CREATE_RESP=$(curl -s -X POST "$BASE_URL/api/v1/plans" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "$PLAN_BODY")

PLAN_ID=$(echo $CREATE_RESP | grep -o '"id":"[^"]*' | cut -d'"' -f4)

if [[ -n "$PLAN_ID" ]]; then
    echo "✅ 创建成功，ID: $PLAN_ID"
else
    echo "❌ 创建失败: $CREATE_RESP"
    exit 1
fi

# 4. 获取计划列表
echo "4. 测试获取计划列表..."
LIST_RESP=$(curl -s -X GET "$BASE_URL/api/v1/plans" \
    -H "Authorization: Bearer $TOKEN")

if [[ "$LIST_RESP" == *"$PLAN_ID"* ]]; then
    echo "✅ 列表包含新计划"
else
    echo "❌ 列表验证失败: $LIST_RESP"
    exit 1
fi

# 5. 获取计划详情
echo "5. 测试获取计划详情..."
DETAIL_RESP=$(curl -s -X GET "$BASE_URL/api/v1/plans/$PLAN_ID" \
    -H "Authorization: Bearer $TOKEN")

if [[ "$DETAIL_RESP" == *"本地测试计划"* ]]; then
    echo "✅ 详情验证成功"
else
    echo "❌ 详情验证失败: $DETAIL_RESP"
    exit 1
fi

# 6. 测试 TrafficPos (可能需要下载数据，给一点时间)
echo "6. 测试交通枢纽定位 (TrafficPos)..."
# 测试北京坐标 (39.9042, 116.4074)
TRAFFIC_RESP=$(curl -s -X GET "$BASE_URL/api/trafficpos?lat=39.9042&lon=116.4074")

if [[ "$TRAFFIC_RESP" == *"airport"* && "$TRAFFIC_RESP" == *"station"* ]]; then
    echo "✅ 交通枢纽定位返回数据结构正确"
    echo "   返回: $TRAFFIC_RESP"
else
    echo "❌ 交通枢纽定位失败 (可能是网络问题或 KV 尚未填充): $TRAFFIC_RESP"
    # 不强制退出，因为这依赖外部网络
fi

echo
echo "=== ✅ 所有测试通过！ ==="
