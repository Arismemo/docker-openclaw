#!/bin/bash
# ============================================================
# OpenClaw 容器初始化脚本
# 功能：
#   1. 首次启动时安装飞书插件和常用技能
#   2. 启动 Gateway
# ============================================================

set -e

INIT_MARKER="$HOME/.openclaw/.initialized"
CONFIG_FILE="$HOME/.openclaw/openclaw.json"

echo "🦞 OpenClaw Docker 启动中..."

# 如果配置文件不存在，从模板复制
if [ ! -f "$CONFIG_FILE" ]; then
    echo "📝 未发现配置文件，从模板复制..."
    cp /app/config/openclaw.json "$CONFIG_FILE" 2>/dev/null || echo "   ⚠️ 模板不存在，将使用默认配置"
fi

# 首次启动时安装插件和技能
if [ ! -f "$INIT_MARKER" ]; then
    echo "🔧 首次启动，安装插件和技能..."

    # 启用飞书渠道插件（已内置，仅需启用）
    echo "📦 启用飞书渠道插件..."
    openclaw plugins enable feishu 2>/dev/null || echo "   ⚠️ 飞书插件启用失败，稍后可手动启用"
    # 立即应用配置变更（启用飞书等）
    openclaw doctor --fix 2>/dev/null || true

    # 通过 ClawHub 安装外部技能
    echo "📦 安装 ClawHub 外部技能..."
    SKILLS=(
        "deep-research-pro"
        "gemini-deep-research"
        "exa-web-search-free"
    )

    for skill in "${SKILLS[@]}"; do
        echo "   📥 安装: $skill"
        npx -y clawhub install "$skill" 2>/dev/null || echo "   ⚠️ $skill 安装失败，跳过"
    done

    # 安装 memu-engine 记忆插件（自动记忆 + 向量检索）
    echo "📦 安装 memU 记忆引擎..."
    mkdir -p ~/.openclaw/extensions
    git clone --depth 1 https://github.com/duxiaoxiong/memu-engine-for-OpenClaw.git \
        ~/.openclaw/extensions/memu-engine 2>/dev/null || echo "   ⚠️ memU 安装失败"

    touch "$INIT_MARKER"
    echo "✅ 初始化完成！"
else
    echo "ℹ️  已完成初始化，跳过插件和技能安装"
fi

# 每次启动时自动修复配置问题（非首次启动时）
if [ -f "$INIT_MARKER" ]; then
    echo "🔧 运行 doctor --fix..."
    openclaw doctor --fix 2>/dev/null || true
fi

# 读取或生成 Gateway Token（确保持久化，重启后不变）
EXISTING_TOKEN=$(node -e "
try {
  const c = JSON.parse(require('fs').readFileSync('$HOME/.openclaw/openclaw.json', 'utf-8'));
  if (c.gateway?.auth?.token) process.stdout.write(c.gateway.auth.token);
} catch(e) {}
" 2>/dev/null || true)

if [ -n "$EXISTING_TOKEN" ]; then
    export OPENCLAW_GATEWAY_TOKEN="$EXISTING_TOKEN"
    echo "🔑 复用已有 Gateway Token: $OPENCLAW_GATEWAY_TOKEN"
elif [ -z "$OPENCLAW_GATEWAY_TOKEN" ]; then
    export OPENCLAW_GATEWAY_TOKEN=$(openssl rand -hex 16 2>/dev/null || echo "auto-$(date +%s)")
    echo "🔑 首次生成 Gateway Token: $OPENCLAW_GATEWAY_TOKEN"
    # 写入配置文件持久化
    node -e "
const fs = require('fs');
const f = '$HOME/.openclaw/openclaw.json';
try {
  const c = JSON.parse(fs.readFileSync(f, 'utf-8'));
  if (!c.gateway) c.gateway = {};
  if (!c.gateway.auth) c.gateway.auth = {};
  c.gateway.auth.token = process.env.OPENCLAW_GATEWAY_TOKEN;
  fs.writeFileSync(f, JSON.stringify(c, null, 2));
} catch(e) {}
" 2>/dev/null || true
fi

# 启动 Gateway（前台运行模式，适用于容器环境）
echo "🚀 启动 OpenClaw Gateway..."
exec openclaw gateway run \
    --port 18789 \
    --bind lan \
    --token "$OPENCLAW_GATEWAY_TOKEN" \
    --verbose \
    --allow-unconfigured
