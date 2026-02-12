#!/bin/sh
# memU-server 自定义启动脚本

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

# 3. 启动 uvicorn
echo "🚀 启动 uvicorn..."
exec python3 -m uvicorn app.main:app --host 0.0.0.0 --port 8000
