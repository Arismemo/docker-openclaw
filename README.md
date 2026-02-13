# 🦞 OpenClaw Docker 部署

基于 Docker Compose 的 [OpenClaw](https://github.com/openclaw/openclaw) 一键部署方案，预配置飞书渠道、常用技能和 memU 长期记忆系统。

## 架构概览

```
┌──────────────┐     ┌──────────────────┐     ┌───────────────┐
│  管理面板     │     │  Bot 容器         │     │  memU 记忆系统  │
│  :3001       │────▶│  openclaw-dolores │────▶│  memu-server   │
│  admin       │     │  :18789           │     │  :8000         │
└──────────────┘     └──────────────────┘     └───────┬───────┘
                            │                         │
                       飞书/Telegram              ┌───┴───┐
                                            ┌────┤       ├────┐
                                            │    └───────┘    │
                                     memu-postgres    memu-temporal
                                     Ollama(embed)    Zhipu(chat)
```

## 快速开始

### 1. 准备环境变量

```bash
cp .env.example .env
```

编辑 `.env`，填入：
- **飞书凭据**：`FEISHU_APP_ID`、`FEISHU_APP_SECRET`（从 [飞书开放平台](https://open.feishu.cn) 获取）
- **AI API Key**：`ZHIPU_API_KEY`（智谱 Coding Plan）
- **Gemini API Key**：`GEMINI_API_KEY`（可选，用于图片生成）

### 2. 构建并启动

```bash
# 构建 Bot 镜像
docker compose build

# 启动所有服务（管理面板 + memU）
docker compose up -d
```

### 3. 通过管理面板创建 Bot

打开 http://localhost:3001，通过 Web 面板创建和管理 Bot 实例。

### 4. 验证飞书连接

在飞书中搜索 Bot 名称，发送「你好」验证回复。

---

## memU 长期记忆系统

memU 为 Bot 提供跨 session 的长期记忆能力，自动存储用户偏好和重要信息。

### 架构

| 组件 | 用途 |
|:-----|:-----|
| `memu-server` | memU API 服务（FastAPI + uvicorn） |
| `memu-postgres` | 记忆数据存储 |
| `memu-temporal` | 异步任务编排 |
| **Ollama**（宿主机） | 本地 embedding（`nomic-embed-text`） |
| **Zhipu API** | 云端 chat/summarize（`glm-4.5-air`） |

### 前置条件

宿主机安装并运行 [Ollama](https://ollama.ai)，拉取 embedding 模型：

```bash
ollama pull nomic-embed-text
```

### 启动

```bash
docker compose up -d memu-postgres memu-temporal memu-server
```

### 验证

```bash
# 存储记忆
curl -X POST http://localhost:8000/memorize \
  -H 'Content-Type: application/json' \
  -d '{"content":[{"role":"user","content":"我喜欢蓝色"}]}'

# 检索记忆
curl -X POST http://localhost:8000/retrieve \
  -H 'Content-Type: application/json' \
  -d '{"query":"用户喜欢什么颜色"}'
```

### 配置

memU 的 chat 和 embedding 使用 **Hybrid 方案**：
- **Chat/Summarize** → Zhipu GLM-4.5-Air（Coding Plan 专用 URL）
- **Embedding** → Ollama nomic-embed-text（本地免费）

关键配置文件：
- `config/memu-main.py` — Hybrid 入口（Zhipu chat + Ollama embed）
- `scripts/memu-entrypoint.sh` — Ollama 健康检查 + 预热 + 启动

---

## 飞书配置指南

### 前置步骤（飞书开放平台）

1. 登录 [飞书开放平台](https://open.feishu.cn)，创建**自建应用**
2. 在「应用能力」中启用**机器人**能力
3. 在「凭证与基础信息」中获取 **App ID** 和 **App Secret**
4. 在「事件与回调」中：
   - 订阅方式选择**长连接**
   - 添加事件 `im.message.receive_v1`（接收消息）
5. 在「权限管理」中添加：`im:message`、`im:message:send_as_bot`、`im:message.receive_v1`
6. 发布应用版本

### 配置参数

| 环境变量 | 说明 |
|:---------|:-----|
| `FEISHU_APP_ID` | 飞书应用 App ID |
| `FEISHU_APP_SECRET` | 飞书应用 App Secret |
| `FEISHU_DOMAIN` | `feishu`（国内）或 `lark`（国际版） |

---

## 预装技能

| 技能 | 用途 |
|:-----|:-----|
| `deep-research` | 深度研究/网络调研 |
| `github` | GitHub Issue/PR 管理 |
| `web-scraper` | 网页抓取与结构化数据 |
| `agent-browser` | 浏览器自动化 |
| `gemini-image-gen` | 图片生成（Gemini） |
| `docker-essentials` | Docker 容器管理 |
| `work-report` | 工作日报/周报生成 |
| `pr-commit-workflow` | Git 提交与 PR 工作流 |
| `news-aggregator` | 新闻聚合 |
| `pdf-extractor` | PDF 内容提取 |

---

## 环境变量

| 变量 | 必填 | 说明 |
|:-----|:----:|:-----|
| `ZHIPU_API_KEY` | ✅ | 智谱 API Key（Bot 主模型 + memU chat） |
| `FEISHU_APP_ID` | ✅ | 飞书应用 App ID |
| `FEISHU_APP_SECRET` | ✅ | 飞书应用 App Secret |
| `GEMINI_API_KEY` | | Gemini API Key（图片生成） |
| `ADMIN_PASS` | | 管理面板登录密码 |
| `HTTP_PROXY` | | 代理设置（访问境外 API） |

---

## 数据持久化

| 数据 | 路径/Volume | 内容 |
|:-----|:------------|:-----|
| Bot 数据 | `./clients/<名称>/` | 配置、sessions、SOUL.md |
| memU 数据 | `memu-postgres-data` | 长期记忆（PostgreSQL） |

---

## 常见问题

**Q: 飞书没有回复消息？**
- 确认应用已发布版本、权限已审批
- 确认事件订阅为「长连接」
- 检查日志：`docker logs openclaw-dolores | grep -i feishu`

**Q: memU memorize 超时？**
- 确认 Ollama 在宿主机运行：`curl http://localhost:11434/v1/models`
- 确认 `nomic-embed-text` 模型已拉取
- 确认 `.env` 中 `ZHIPU_API_KEY` 有效

**Q: 如何更新？**
```bash
git pull
docker compose build --no-cache    # 重建 Bot 镜像（更新 init.sh）
docker compose up -d               # 重启所有服务
```
