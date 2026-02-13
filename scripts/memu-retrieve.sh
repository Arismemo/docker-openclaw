#!/bin/sh
# memU 记忆检索脚本
# 用法: memu-retrieve.sh --user-id <用户ID> --query "查询内容"
# 示例: memu-retrieve.sh --user-id dolores --query "用户喜欢什么颜色"

MEMU_URL="${MEMU_URL:-http://172.17.0.1:8000}"
USER_ID=""
QUERY=""

while [ "$#" -gt 0 ]; do
    case "$1" in
        --user-id) USER_ID="$2"; shift 2 ;;
        --query)   QUERY="$2"; shift 2 ;;
        *)         shift ;;
    esac
done

if [ -z "$QUERY" ]; then
    echo "错误: 缺少 --query 参数" >&2
    exit 1
fi

PAYLOAD=$(cat <<EOF
{"query": "$QUERY", "user": {"user_id": "${USER_ID:-default}"}}
EOF
)

RESPONSE=$(curl -s -m 60 -X POST "${MEMU_URL}/retrieve" \
    -H "Content-Type: application/json" \
    -d "$PAYLOAD" 2>&1)

EXIT_CODE=$?
if [ $EXIT_CODE -ne 0 ]; then
    echo "错误: memU 服务不可用 (exit=$EXIT_CODE)" >&2
    exit 1
fi

echo "$RESPONSE"
