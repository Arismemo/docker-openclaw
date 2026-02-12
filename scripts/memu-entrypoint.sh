#!/bin/sh
# memU-server 自定义启动脚本
# 在启动前 patch main.py，注入 embed_model 配置

MAIN_PY="/app/app/main.py"
EMBED_MODEL="${DEFAULT_EMBED_MODEL:-nomic-embed-text}"
OLLAMA_URL="${OPENAI_BASE_URL:-http://host.docker.internal:11434/v1}"

# 1. 等待 Ollama 可用
echo "⏳ 等待 Ollama ($OLLAMA_URL) 可用..."
for i in $(seq 1 30); do
    if python3 -c "
import urllib.request
try:
    r = urllib.request.urlopen('${OLLAMA_URL}/models', timeout=5)
    print('✅ Ollama 可用')
    exit(0)
except Exception as e:
    exit(1)
" 2>/dev/null; then
        break
    fi
    echo "   重试 $i/30..."
    sleep 2
done

# 2. 预热 embedding 模型
echo "🔥 预热 embedding 模型: $EMBED_MODEL"
python3 -c "
import urllib.request, json
url = '${OLLAMA_URL}/embeddings'
data = json.dumps({'model': '$EMBED_MODEL', 'input': ['warmup']}).encode()
req = urllib.request.Request(url, data=data, headers={'Content-Type': 'application/json'})
try:
    r = urllib.request.urlopen(req, timeout=30)
    print('✅ 预热完成')
except Exception as e:
    print(f'⚠️  预热失败: {e}')
" 2>&1

# 3. Patch main.py 注入 embed_model
if ! grep -q 'embed_model' "$MAIN_PY"; then
    echo "🔧 patch memU main.py: 注入 embed_model=$EMBED_MODEL"
    sed -i "/\"model\": os.getenv/a\\            \"embed_model\": \"$EMBED_MODEL\"," "$MAIN_PY"
    echo "   ✅ patch 完成"
else
    echo "ℹ️  embed_model 已存在，跳过 patch"
fi

# 4. 显示 patched 的 llm_profiles 部分
echo "📋 patched main.py llm_profiles:"
grep -A5 'llm_profiles' "$MAIN_PY" | head -10

# 5. 启动 gunicorn (增加 timeout 到 120 秒，给 initialize_categories 足够时间)
echo "🚀 启动 gunicorn..."
exec gunicorn app.main:app \
    -k uvicorn.workers.UvicornWorker \
    --bind 0.0.0.0:8000 \
    --timeout 120 \
    --graceful-timeout 30
