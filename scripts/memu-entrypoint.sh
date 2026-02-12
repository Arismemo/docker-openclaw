#!/bin/sh
# memU-server 自定义启动脚本
# 在启动前 patch main.py，注入 embed_model 配置

MAIN_PY="/app/app/main.py"
EMBED_MODEL="${DEFAULT_EMBED_MODEL:-nomic-embed-text}"

# 检查是否已经 patch 过
if ! grep -q 'embed_model' "$MAIN_PY"; then
    echo "🔧 patch memU main.py: 注入 embed_model=$EMBED_MODEL"
    # 在 "model": ... 行后插入 embed_model 行
    sed -i "/\"model\": os.getenv/a\\            \"embed_model\": \"$EMBED_MODEL\"," "$MAIN_PY"
    echo "   ✅ patch 完成"
else
    echo "ℹ️  embed_model 已存在，跳过 patch"
fi

# 启动 gunicorn
exec gunicorn app.main:app -k uvicorn.workers.UvicornWorker --bind 0.0.0.0:8000
