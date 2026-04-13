#!/usr/bin/env bash
# 测试 self-hosted A2A provider
# 先在另一个终端启动: API_TOKEN=test npm start

BASE="http://127.0.0.1:${PORT:-8080}"
TOKEN="${API_TOKEN:-test}"

echo "=== 1. Agent Card (public) ==="
curl -s "$BASE/.well-known/agent.json" | python3 -m json.tool
echo ""

echo "=== 2. Health (public) ==="
curl -s "$BASE/health"
echo -e "\n"

echo "=== 3. 无 token → 401 ==="
curl -s -X POST "$BASE/a2a" \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tasks/send","params":{"message":{"role":"user","parts":[{"type":"text","text":"hi"}]}}}'
echo -e "\n"

echo "=== 4. tasks/send (需要 token) ==="
curl -s -X POST "$BASE/a2a" \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tasks/send",
    "params": {
      "message": {
        "role": "user",
        "parts": [{"type": "text", "text": "Say hello in one sentence."}]
      }
    }
  }' | python3 -m json.tool
echo ""

echo "=== 5. tasks/sendSubscribe (SSE) ==="
timeout 30 curl -s -N -X POST "$BASE/a2a" \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "jsonrpc": "2.0",
    "id": 2,
    "method": "tasks/sendSubscribe",
    "params": {
      "message": {
        "role": "user",
        "parts": [{"type": "text", "text": "Count from 1 to 5."}]
      }
    }
  }'
echo ""
