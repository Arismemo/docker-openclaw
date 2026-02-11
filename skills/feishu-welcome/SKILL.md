---
name: feishu-welcome
description: 发送飞书交互式教程卡片，展示 Dolores 的核心能力。用户输入「教程」「帮助」「help」时触发。
homepage: https://github.com/Arismemo/docker-openclaw
metadata:
  {
    "openclaw":
      {
        "emoji": "📖",
        "requires": { "bins": ["python3"] },
      },
  }
---

# 飞书欢迎教程

当用户输入「教程」「帮助」「help」「指南」等关键词时，调用此 skill 发送交互式教程卡片。

## 重要行为准则

- **必须传入 `--chat-id` 参数**，值为当前会话的 chat_id（`oc_` 开头）。
- 发送主教程卡片后，**不要**额外发送文字消息，卡片本身已经包含了所有引导。
- 当用户回复数字 1-5 时：
  1. **先执行对应功能的演示**（如画图、搜索等）
  2. **演示完成后**，再调用此 skill 发送对应的详解卡片

## Run

```bash
# 发送主教程卡片（用户输入「教程」时）
python3 {baseDir}/scripts/send_card.py --type main --chat-id <CHAT_ID>

# 发送画图功能详解卡片（演示完画图后）
python3 {baseDir}/scripts/send_card.py --type art --chat-id <CHAT_ID>

# 发送搜索功能详解卡片
python3 {baseDir}/scripts/send_card.py --type search --chat-id <CHAT_ID>

# 发送记忆功能详解卡片
python3 {baseDir}/scripts/send_card.py --type memory --chat-id <CHAT_ID>

# 发送文档功能详解卡片
python3 {baseDir}/scripts/send_card.py --type doc --chat-id <CHAT_ID>

# 发送表格功能详解卡片
python3 {baseDir}/scripts/send_card.py --type table --chat-id <CHAT_ID>

# 发送定时提醒详解卡片
python3 {baseDir}/scripts/send_card.py --type remind --chat-id <CHAT_ID>

# 发送知识库详解卡片
python3 {baseDir}/scripts/send_card.py --type wiki --chat-id <CHAT_ID>
```

## 卡片类型

| type | 说明 | 触发条件 |
|------|------|---------|
| `main` | 主教程：展示 5 大核心能力 | 用户说「教程」「帮助」 |
| `art` | 画图详解 | 用户回复 1 或「试试画图」，执行演示后 |
| `search` | 搜索详解 | 用户回复 2 或「试试搜索」，执行演示后 |
| `memory` | 记忆详解 | 用户回复 3 或「试试记忆」，执行演示后 |
| `doc` | 文档详解 | 用户回复 4 或「试试文档」，执行演示后 |
| `table` | 表格详解 | 用户回复 5 或「试试表格」，执行演示后 |
| `remind` | 定时提醒详解 | 用户回复 6 或「试试提醒」，执行演示后 |
| `wiki` | 知识库详解 | 用户回复 7 或「试试知识库」，执行演示后 |
