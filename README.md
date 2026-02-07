# 🦞 OpenClaw Docker 部署

基于 Docker Compose 的 [OpenClaw](https://github.com/openclaw/openclaw) 一键部署方案，预配置飞书渠道和常用技能。

## 快速开始

### 1. 准备环境变量

```bash
cp .env.example .env
```

编辑 `.env`，填入：
- **飞书凭据**：`FEISHU_APP_ID`、`FEISHU_APP_SECRET`（从 [飞书开放平台](https://open.feishu.cn) 获取）
- **AI API Key**：至少配置一个 Provider（如 `ANTHROPIC_API_KEY`）

### 2. 构建并启动

```bash
docker compose build
docker compose up -d
```

### 3. 访问 Dashboard

打开 http://127.0.0.1:18789/ ，查看 Gateway 状态和管理配置。

### 4. 验证飞书连接

```bash
# 检查日志
docker compose logs -f openclaw-gateway | grep -i feishu
```

在飞书中搜索你的 Bot 名称，发送 "你好" 验证回复。

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
| `docker-essentials` | Docker 容器管理 |
| `work-report` | 工作日报/周报生成 |
| `pr-commit-workflow` | Git 提交与 PR 工作流 |
| `gemini-deep-research` | Gemini 深度研究 |
| `news-aggregator` | 新闻聚合 |
| `pdf-extractor` | PDF 内容提取 |

手动管理技能：

```bash
# 查看已安装技能
docker compose run --profile cli --rm openclaw-cli skills list

# 安装新技能
docker compose run --profile cli --rm openclaw-cli skills install <skill-name>
```

---

## CLI 工具

通过 `openclaw-cli` 服务执行管理命令：

```bash
# 查看状态
docker compose run --profile cli --rm openclaw-cli status

# 查看模型列表
docker compose run --profile cli --rm openclaw-cli models

# 健康检查
docker compose run --profile cli --rm openclaw-cli doctor

# 重启 Gateway
docker compose restart openclaw-gateway
```

---

## 数据持久化

| Volume | 路径 | 内容 |
|:-------|:-----|:-----|
| `openclaw_data` | `/home/node/.openclaw` | 配置、sessions、agents |
| `openclaw_workspace` | `/home/node/.openclaw/workspace` | 技能、工作区文件 |

清理数据：

```bash
docker compose down -v  # 删除容器和 volumes
```

---

## 常见问题

**Q: 飞书没有回复消息？**
- 确认应用已发布版本、权限已审批
- 确认事件订阅方式为「长连接」
- 检查日志：`docker compose logs openclaw-gateway | grep -i feishu`

**Q: AI 模型无响应？**
- 确认 `.env` 中已配置正确的 API Key
- 如需访问境外 API，配置 `HTTP_PROXY` / `HTTPS_PROXY`

**Q: 如何更新 OpenClaw？**
```bash
docker compose build --no-cache
docker compose up -d
```
