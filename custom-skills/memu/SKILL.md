---
name: memu
description: memU 长期记忆系统 — 存储对话记忆并跨 session 检索
---

# memU 记忆技能

## 功能

memU 是 proactive memory 系统，能自动提取对话中的关键信息、分类存储、并在未来对话中主动召回。

## 使用场景

1. **存储记忆**：在重要对话结束后，调用 memorize 保存对话内容
2. **检索记忆**：在新 session 开始或需要历史上下文时，调用 retrieve 获取相关记忆

## 命令

### 存储对话记忆

```bash
python3 {memu baseDir}/scripts/memorize.py \
  --user-id <机器人ID，如 dolores> \
  --input '<JSON格式的对话内容>'
```

输入格式：
```json
[
  {"role": "user", "content": "我喜欢蓝色"},
  {"role": "assistant", "content": "好的，我记住了，你喜欢蓝色！"}
]
```

### 检索相关记忆

```bash
python3 {memu baseDir}/scripts/retrieve.py \
  --user-id <机器人ID，如 dolores> \
  --query "用户的颜色偏好是什么"
```

## 自动行为

- 当对话中出现用户偏好、重要事实、人物关系等信息时，**主动调用 memorize** 存储
- 当新 session 开始时，**主动调用 retrieve** 获取该用户的相关历史记忆
- 当用户提到"你还记得..."或引用历史对话时，调用 retrieve 检索

## 注意事项

- `--user-id` 必须固定为当前机器人的 ID（如 `dolores`），确保记忆隔离
- memU 服务运行在 `http://memu-server:8000`（容器内部网络）
