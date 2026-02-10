# ============================================================
# OpenClaw Docker 部署 - 自定义 Dockerfile
# 基于官方 Node.js 22，从源码构建 OpenClaw 并预装飞书插件+常用技能
# ============================================================

FROM node:22-slim AS builder

# 安装构建依赖
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    python3 \
    make \
    g++ \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# 安装 pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /build

# 克隆 OpenClaw 源码（使用最新稳定版本）
RUN git clone --depth 1 https://github.com/openclaw/openclaw.git .

# 安装依赖并构建
RUN pnpm install --frozen-lockfile
RUN pnpm run build
RUN pnpm ui:build

# ============================================================
# 运行阶段
# ============================================================
FROM node:22-slim

# 安装运行时依赖（增强版 —— 激活更多技能）
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    curl \
    ca-certificates \
    chromium \
    # session-logs 技能
    jq \
    ripgrep \
    # video-frames 技能
    ffmpeg \
    # tmux 技能
    tmux \
    # openai-image-gen / nano-banana-pro 等技能
    python3 python3-pip python3-venv \
    # gh (GitHub CLI) 安装依赖
    gpg \
    && rm -rf /var/lib/apt/lists/*

# 安装 GitHub CLI → github 技能
RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
    | gpg --dearmor -o /usr/share/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
    | tee /etc/apt/sources.list.d/github-cli.list > /dev/null \
    && apt-get update && apt-get install -y gh \
    && rm -rf /var/lib/apt/lists/*

# 安装 uv (Python 包管理器) → local-places / nano-banana-pro 技能
RUN curl -LsSf --retry 3 --retry-delay 5 --connect-timeout 30 https://astral.sh/uv/install.sh | sh \
    && ln -sf /root/.local/bin/uv /usr/local/bin/uv

# 安装 pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# 创建应用目录和 openclaw 配置目录
RUN mkdir -p /home/node/.openclaw/workspace/skills \
    && chown -R node:node /home/node

WORKDIR /app

# 从构建阶段复制产物
COPY --from=builder /build /app
RUN chown -R node:node /app

# 设置 pnpm 全局目录并链接 openclaw
ENV PNPM_HOME="/home/node/.local/share/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN mkdir -p $PNPM_HOME && cd /app && pnpm link --global

# 安装 clawhub CLI → clawhub 技能（技能市场）
RUN npm install -g clawhub 2>/dev/null || true

# 复制配置模板（保留在 /app/config/ 供 init.sh 使用）
COPY --chown=node:node config/openclaw.json /app/config/openclaw.json

# 复制初始化脚本
COPY --chown=node:node scripts/init.sh /app/scripts/init.sh
RUN chmod +x /app/scripts/init.sh

# 复制自定义 skill（gemini-image-gen 图片生成）
COPY --chown=node:node skills/ /app/custom-skills/

# 修复权限（pnpm link / npm install -g 可能以 root 修改了 /home/node）
RUN chown -R node:node /home/node

# 切换到非 root 用户
USER node

# Gateway 默认端口
EXPOSE 18789

# 健康检查
HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
    CMD curl -sf http://localhost:18789/health || exit 1

# 启动入口
ENTRYPOINT ["/app/scripts/init.sh"]
