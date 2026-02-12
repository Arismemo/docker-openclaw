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

    # 链接自定义 skill 到工作区（不修改内置 skill，独立维护）
    echo "📦 链接自定义 skill..."
    CUSTOM_SKILLS_DIR="/app/custom-skills"
    WORKSPACE_SKILLS="$HOME/.openclaw/workspace/skills"
    if [ -d "$CUSTOM_SKILLS_DIR" ]; then
        for skill_dir in "$CUSTOM_SKILLS_DIR"/*/; do
            skill_name=$(basename "$skill_dir")
            target="$WORKSPACE_SKILLS/$skill_name"
            if [ ! -e "$target" ]; then
                cp -r "$skill_dir" "$target"
                echo "   ✅ 链接: $skill_name"
            fi
        done
    fi

    # 启用内置 memory-lancedb 长期记忆插件（LanceDB 向量存储 + 自动记忆）
    echo "📦 启用 memory-lancedb 记忆插件..."

    # patch 插件以支持 Ollama embedding（3 层 patch）
    echo "   🔧 patch memory-lancedb 支持 Ollama..."

    # 层 1: patch JSON schema — 移除 model enum + 添加 baseUrl 字段
    python3 -c '
import json, os
schema_file = "/app/extensions/memory-lancedb/openclaw.plugin.json"
if os.path.exists(schema_file):
    with open(schema_file) as f:
        schema = json.load(f)
    emb = schema.get("configSchema", {}).get("properties", {}).get("embedding", {})
    emb_props = emb.get("properties", {})
    # 移除 model enum 限制
    if "enum" in emb_props.get("model", {}):
        del emb_props["model"]["enum"]
    # 添加 baseUrl 字段
    if "baseUrl" not in emb_props:
        emb_props["baseUrl"] = {"type": "string"}
    # 允许额外属性
    emb["additionalProperties"] = True
    with open(schema_file, "w") as f:
        json.dump(schema, f, indent=2)
    print("   ✅ JSON schema: 已 patch（baseUrl + model enum）")
else:
    print("   ⚠️ openclaw.plugin.json 不存在")
' || echo "   ⚠️ JSON schema patch 失败"

    # 层 2: patch TypeScript — 添加 nomic-embed-text 维度映射
    MEMORY_CONFIG_TS="/app/extensions/memory-lancedb/config.ts"
    if [ -f "$MEMORY_CONFIG_TS" ]; then
        if ! grep -q 'nomic-embed-text' "$MEMORY_CONFIG_TS"; then
            sed -i 's/"text-embedding-3-large": 3072,/"text-embedding-3-large": 3072,\n  "nomic-embed-text": 768,/' "$MEMORY_CONFIG_TS"
            echo "   ✅ TypeScript: 已添加 nomic-embed-text 维度"
        else
            echo "   ℹ️  TypeScript: nomic-embed-text 已存在"
        fi
    fi

    # 层 3: patch index.ts — OpenAI SDK 构造函数支持 baseURL
    MEMORY_INDEX_TS="/app/extensions/memory-lancedb/index.ts"
    if [ -f "$MEMORY_INDEX_TS" ]; then
        if ! grep -q 'baseURL' "$MEMORY_INDEX_TS"; then
            # 修改 Embeddings 构造函数：接受 baseUrl 参数并传给 OpenAI SDK
            sed -i 's/constructor(/constructor(\n    baseUrl: string | undefined,/' "$MEMORY_INDEX_TS"
            sed -i 's/this.client = new OpenAI({ apiKey });/this.client = new OpenAI({ apiKey, baseURL: baseUrl || undefined });/' "$MEMORY_INDEX_TS"
            # 修改调用处：传入 baseUrl
            sed -i 's/new Embeddings(cfg.embedding.apiKey, cfg.embedding.model!)/new Embeddings((cfg.embedding as any).baseUrl, cfg.embedding.apiKey, cfg.embedding.model!)/' "$MEMORY_INDEX_TS"
            echo "   ✅ index.ts: OpenAI SDK 已支持 baseURL"
        else
            echo "   ℹ️  index.ts: baseURL 已存在"
        fi
    fi

    # 注入 embedding 配置并启用插件
    python3 -c '
import json, os
config_file = os.path.expanduser("~/.openclaw/openclaw.json")
with open(config_file) as f:
    config = json.load(f)
if "plugins" not in config:
    config["plugins"] = {}
entries = config["plugins"].setdefault("entries", {})
entries["memory-lancedb"] = {
    "enabled": True,
    "config": {
        "embedding": {
            "apiKey": os.environ.get("OPENAI_API_KEY", "ollama"),
            "model": "nomic-embed-text",
            "baseUrl": "http://172.17.0.1:11434/v1"
        },
        "autoCapture": True,
        "autoRecall": True
    }
}
config["plugins"]["slots"] = config["plugins"].get("slots", {})
config["plugins"]["slots"]["memory"] = "memory-lancedb"
with open(config_file, "w") as f:
    json.dump(config, f, indent=4, ensure_ascii=False)
print("   ✅ memory-lancedb 配置已注入（Ollama nomic-embed-text）")
' || echo "   ⚠️ memory-lancedb 配置注入失败"

    # 向 AGENTS.md 追加教程触发规则
    AGENTS_FILE="$HOME/.openclaw/workspace/AGENTS.md"
    if [ -f "$AGENTS_FILE" ]; then
        if ! grep -q '教程触发规则' "$AGENTS_FILE" 2>/dev/null; then
            cat >> "$AGENTS_FILE" << 'TUTORIAL_EOF'

## 📖 教程触发规则

当用户输入以下关键词时，调用 `feishu-welcome` skill 发送教程卡片：
- 触发词：「教程」「帮助」「help」「指南」「你能做什么」「功能介绍」
- 调用命令：`python3 {feishu-welcome baseDir}/scripts/send_card.py --type main --chat-id <当前会话的chat_id>`
- 发送卡片后**不要**额外发文字消息

当用户回复教程中的数字 1-7 时：
- **1 画图**：用 `gemini-image-gen` skill 画一张"太空猫"作为演示，完成后发送详解卡片 `--type art`
- **2 搜索**：用联网搜索功能搜索"今天的 AI 新闻"作为演示，完成后发送详解卡片 `--type search`
- **3 记忆**：向用户解释记忆功能并引导他们说出一个偏好，完成后发送详解卡片 `--type memory`
- **4 文档**：向用户介绍文档操作能力，完成后发送详解卡片 `--type doc`
- **5 表格**：向用户介绍多维表格操作能力，完成后发送详解卡片 `--type table`
- **6 提醒**：帮用户设置一个"5分钟后提醒喝水"的演示提醒，完成后发送详解卡片 `--type remind`
- **7 知识库**：列出可用的知识库空间作为演示，完成后发送详解卡片 `--type wiki`

注意：发送详解卡片的命令同样需要 `--chat-id` 参数。

TUTORIAL_EOF
            echo "   ✅ AGENTS.md: 教程触发规则已添加"
        else
            echo "   ℹ️  AGENTS.md: 教程触发规则已存在，跳过"
        fi
    fi

    touch "$INIT_MARKER"
    echo "✅ 初始化完成！"
else
    echo "ℹ️  已完成初始化，跳过插件和技能安装"
fi

# === 以下逻辑每次启动都执行 ===

# 链接自定义 skill（每次启动确保更新到最新版本）
echo "📦 同步自定义 skill..."
CUSTOM_SKILLS_DIR="/app/custom-skills"
WORKSPACE_SKILLS="$HOME/.openclaw/workspace/skills"
mkdir -p "$WORKSPACE_SKILLS"
if [ -d "$CUSTOM_SKILLS_DIR" ]; then
    for skill_dir in "$CUSTOM_SKILLS_DIR"/*/; do
        skill_name=$(basename "$skill_dir")
        target="$WORKSPACE_SKILLS/$skill_name"
        # 每次都覆盖，确保 skill 代码与镜像同步
        rm -rf "$target" 2>/dev/null
        cp -r "$skill_dir" "$target"
        echo "   ✅ 同步: $skill_name"
    done
fi

# patch memory-lancedb 支持 Ollama（每次启动都执行，因为镜像文件每次 docker run 都是新的）
MEMORY_PLUGIN_JSON="/app/extensions/memory-lancedb/openclaw.plugin.json"
MEMORY_CONFIG_TS="/app/extensions/memory-lancedb/config.ts"
MEMORY_INDEX_TS="/app/extensions/memory-lancedb/index.ts"
if [ -f "$MEMORY_PLUGIN_JSON" ]; then
    echo "🔧 patch memory-lancedb 支持 Ollama..."
    # 层 1: JSON schema — 移除 model enum + 添加 baseUrl + 允许额外属性
    python3 -c '
import json
f = "'"$MEMORY_PLUGIN_JSON"'"
with open(f) as fh:
    s = json.load(fh)
emb = s.get("configSchema",{}).get("properties",{}).get("embedding",{})
props = emb.get("properties",{})
if "enum" in props.get("model",{}): del props["model"]["enum"]
if "baseUrl" not in props: props["baseUrl"] = {"type": "string"}
emb["additionalProperties"] = True
with open(f,"w") as fh:
    json.dump(s,fh,indent=2)
print("   ✅ schema: baseUrl + model enum")
' 2>/dev/null || true

    # 层 2: TypeScript — 添加 nomic-embed-text 维度映射
    if [ -f "$MEMORY_CONFIG_TS" ] && ! grep -q 'nomic-embed-text' "$MEMORY_CONFIG_TS"; then
        sed -i 's/"text-embedding-3-large": 3072,/"text-embedding-3-large": 3072,\n  "nomic-embed-text": 768,/' "$MEMORY_CONFIG_TS" 2>/dev/null && \
            echo "   ✅ config.ts: nomic-embed-text 维度" || true
    fi

    # 层 3: index.ts — OpenAI SDK 构造函数支持 baseURL
    if [ -f "$MEMORY_INDEX_TS" ] && ! grep -q 'baseURL' "$MEMORY_INDEX_TS"; then
        sed -i 's/this.client = new OpenAI({ apiKey });/this.client = new OpenAI({ apiKey, baseURL: (globalThis as any).__memoryBaseUrl || undefined });/' "$MEMORY_INDEX_TS"
        # 在插件初始化处注入 baseUrl 到全局变量
        sed -i 's/const embeddings = new Embeddings(cfg.embedding.apiKey, cfg.embedding.model!);/(globalThis as any).__memoryBaseUrl = (cfg.embedding as any).baseUrl; const embeddings = new Embeddings(cfg.embedding.apiKey, cfg.embedding.model!);/' "$MEMORY_INDEX_TS"
        echo "   ✅ index.ts: OpenAI SDK baseURL" 2>/dev/null || true
    fi

    # 确保 memory-lancedb 配置存在（volume 中可能缺失）
    python3 -c '
import json, os
config_file = os.path.expanduser("~/.openclaw/openclaw.json")
with open(config_file) as f:
    config = json.load(f)
plugins = config.setdefault("plugins", {})
entries = plugins.setdefault("entries", {})
if "memory-lancedb" not in entries or not entries["memory-lancedb"].get("enabled"):
    entries["memory-lancedb"] = {
        "enabled": True,
        "config": {
            "embedding": {
                "apiKey": os.environ.get("OPENAI_API_KEY", "ollama"),
                "model": "nomic-embed-text",
                "baseUrl": "http://172.17.0.1:11434/v1"
            },
            "autoCapture": True,
            "autoRecall": True
        }
    }
    plugins["slots"] = plugins.get("slots", {})
    plugins["slots"]["memory"] = "memory-lancedb"
    with open(config_file, "w") as f:
        json.dump(config, f, indent=4, ensure_ascii=False)
    print("   ✅ memory-lancedb 配置已注入")
else:
    print("   ℹ️  memory-lancedb 配置已存在")
' 2>/dev/null || true
fi

# patch 飞书 media.ts：修复图片上传 Readable.from(buffer) 兼容性问题
# @larksuiteoapi SDK 的 form-data 不支持 Readable.from(buffer)，会导致 400 错误
FEISHU_MEDIA="/app/extensions/feishu/src/media.ts"
if [ -f "$FEISHU_MEDIA" ]; then
    if grep -q 'Readable.from(image)' "$FEISHU_MEDIA"; then
        echo "🔧 patch 飞书 media.ts 图片上传方式..."
        # 将 Readable.from(buffer) 替换为写临时文件 + createReadStream
        sed -i 's|const imageStream = typeof image === "string" ? fs.createReadStream(image) : Readable.from(image);|const imageStream = (() => { if (typeof image === "string") return fs.createReadStream(image); const tmpPath = "/tmp/feishu-upload-" + Date.now() + ".png"; fs.writeFileSync(tmpPath, image); const stream = fs.createReadStream(tmpPath); stream.on("close", () => { try { fs.unlinkSync(tmpPath); } catch {} }); return stream; })();|' "$FEISHU_MEDIA" 2>/dev/null && \
            echo "   ✅ 飞书 media.ts: 图片上传方式已修复" || echo "   ⚠️ 飞书 media.ts patch 失败"
    else
        echo "   ℹ️  飞书 media.ts: 已修复或格式不匹配，跳过"
    fi
fi

# 确保启动配置正确（gateway + 飞书插件）
node -e "
const fs = require('fs');
const f = '$HOME/.openclaw/openclaw.json';
try {
  const c = JSON.parse(fs.readFileSync(f, 'utf-8'));
  // gateway 必须为 local + lan
  c.gateway = c.gateway || {};
  c.gateway.mode = 'local';
  c.gateway.bind = 'lan';
  // 确保飞书插件启用
  if (c.plugins?.entries?.feishu && !c.plugins.entries.feishu.enabled) {
    c.plugins.entries.feishu.enabled = true;
    console.log('   ✅ 飞书插件已启用');
  }
  fs.writeFileSync(f, JSON.stringify(c, null, 2));
} catch(e) {}
" 2>/dev/null || true

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
