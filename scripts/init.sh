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

    # 注入 memorySearch 配置（使用 Ollama nomic-embed-text 做本地 embedding 向量搜索）
    python3 -c '
import json, os
config_file = os.path.expanduser("~/.openclaw/openclaw.json")
with open(config_file) as f:
    config = json.load(f)
agents = config.setdefault("agents", {})
defaults = agents.setdefault("defaults", {})
if "memorySearch" not in defaults:
    defaults["memorySearch"] = {
        "provider": "openai",
        "model": "nomic-embed-text",
        "remote": {
            "baseUrl": "http://172.17.0.1:11434/v1/",
            "apiKey": "ollama"
        }
    }
    with open(config_file, "w") as f:
        json.dump(config, f, indent=4, ensure_ascii=False)
    print("   ✅ memorySearch 配置已注入（Ollama nomic-embed-text）")
else:
    print("   ℹ️  memorySearch 配置已存在")
' || echo "   ⚠️ memorySearch 配置注入失败"

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

# 确保 SOUL.md 包含 gemini-image-gen 使用指引
SOUL_FILE="$HOME/.openclaw/workspace/SOUL.md"
if [ -f "$SOUL_FILE" ] && ! grep -q 'gemini-image-gen' "$SOUL_FILE"; then
    cat >> "$SOUL_FILE" << 'SOUL_EOF'

## 工具使用

### 图片生成
当用户要求画图/生成图片时，**必须使用 `gemini-image-gen` skill**（不是 openai-image-gen）。
调用方式：
```bash
python3 {baseDir}/scripts/gen.py --prompt "描述内容"
```
SOUL_EOF
    echo "📝 SOUL.md: 已添加 gemini-image-gen 指引"
fi

# 安装 memU 记忆系统脚本到 bot 的 .openclaw 目录
MEMU_SCRIPTS_DIR="/home/node/.openclaw/scripts"
mkdir -p "$MEMU_SCRIPTS_DIR"

cat > "$MEMU_SCRIPTS_DIR/memu-memorize.sh" << 'MEMORIZE_SCRIPT'
#!/bin/sh
MEMU_URL="${MEMU_URL:-http://172.17.0.1:8000}"
USER_ID=""; INPUT=""
while [ "$#" -gt 0 ]; do
    case "$1" in --user-id) USER_ID="$2"; shift 2 ;; --input) INPUT="$2"; shift 2 ;; *) shift ;; esac
done
[ -z "$INPUT" ] && echo "错误: 缺少 --input" >&2 && exit 1
curl -s -m 120 -X POST "${MEMU_URL}/memorize" -H "Content-Type: application/json" \
    -d "{\"content\": $INPUT, \"user\": {\"user_id\": \"${USER_ID:-default}\"}}"
MEMORIZE_SCRIPT
chmod +x "$MEMU_SCRIPTS_DIR/memu-memorize.sh"

cat > "$MEMU_SCRIPTS_DIR/memu-retrieve.sh" << 'RETRIEVE_SCRIPT'
#!/bin/sh
MEMU_URL="${MEMU_URL:-http://172.17.0.1:8000}"
USER_ID=""; QUERY=""
while [ "$#" -gt 0 ]; do
    case "$1" in --user-id) USER_ID="$2"; shift 2 ;; --query) QUERY="$2"; shift 2 ;; *) shift ;; esac
done
[ -z "$QUERY" ] && echo "错误: 缺少 --query" >&2 && exit 1
curl -s -m 60 -X POST "${MEMU_URL}/retrieve" -H "Content-Type: application/json" \
    -d "{\"query\": \"$QUERY\", \"user\": {\"user_id\": \"${USER_ID:-default}\"}}"
RETRIEVE_SCRIPT
chmod +x "$MEMU_SCRIPTS_DIR/memu-retrieve.sh"
echo "📦 memU 脚本已安装到 $MEMU_SCRIPTS_DIR"

# 确保 SOUL.md 包含 memU 记忆系统指引
if [ -f "$SOUL_FILE" ] && ! grep -q 'memu' "$SOUL_FILE"; then
    cat >> "$SOUL_FILE" << 'MEMU_EOF'

### 长期记忆（memU）
你拥有 memU 长期记忆系统，可存储和检索跨 session 的记忆。

**自动存储**：当对话中出现用户偏好、重要事实、或用户要求记住的内容时，主动调用：
```bash
sh /home/node/.openclaw/scripts/memu-memorize.sh --user-id "$USER_ID" --input '[{"role":"user","content":"..."},{"role":"assistant","content":"..."}]'
```

**自动检索**：在新 session 开始、或用户提到"你还记得"时，主动调用：
```bash
sh /home/node/.openclaw/scripts/memu-retrieve.sh --user-id "$USER_ID" --query "查询内容"
```
MEMU_EOF
    echo "📝 SOUL.md: 已添加 memU 记忆系统指引"
fi

# 启动 Gateway（前台运行模式，适用于容器环境）
echo "🚀 启动 OpenClaw Gateway..."
exec openclaw gateway run \
    --port 18789 \
    --bind lan \
    --token "$OPENCLAW_GATEWAY_TOKEN" \
    --verbose \
    --allow-unconfigured
