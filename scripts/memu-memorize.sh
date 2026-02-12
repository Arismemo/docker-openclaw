#!/bin/sh
# memU 记忆存储脚本
# 用法: memu-memorize.sh --user-id <用户ID> --input '<对话JSON>'
# 示例: memu-memorize.sh --user-id dolores --input '[{"role":"user","content":"我喜欢蓝色"},{"role":"assistant","content":"好的"}]'

MEMU_URL="${MEMU_URL:-http://172.17.0.1:8000}"
USER_ID=""
INPUT=""

while [ "$#" -gt 0 ]; do
    case "$1" in
        --user-id) USER_ID="$2"; shift 2 ;;
        --input)   INPUT="$2"; shift 2 ;;
        *)         shift ;;
    esac
done

if [ -z "$INPUT" ]; then
    echo "错误: 缺少 --input 参数" >&2
    exit 1
fi

PAYLOAD=$(cat <<EOF
{"content": $INPUT, "user": {"user_id": "${USER_ID:-default}"}}
EOF
)

RESPONSE=$(curl -s -m 30 -X POST "${MEMU_URL}/memorize" \
    -H "Content-Type: application/json" \
    -d "$PAYLOAD" 2>&1)

EXIT_CODE=$?
if [ $EXIT_CODE -ne 0 ]; then
    echo "错误: memU 服务不可用 (exit=$EXIT_CODE)" >&2
    exit 1
fi

echo "$RESPONSE"
