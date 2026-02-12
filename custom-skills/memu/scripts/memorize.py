#!/usr/bin/env python3
"""
memU 记忆存储脚本
调用 memU-server 的 /memorize API 存储对话内容
"""

import argparse
import json
import sys
import urllib.request
import urllib.error
import os
from datetime import datetime

MEMU_API_URL = os.environ.get("MEMU_API_URL", "http://memu-server:8000")


def memorize(user_id: str, messages: list) -> dict:
    """存储对话到 memU"""
    # 构造 memU 格式的 payload
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    content = []
    for msg in messages:
        content.append({
            "role": msg.get("role", "user"),
            "content": {"text": msg.get("content", "")},
            "created_at": msg.get("created_at", now)
        })

    payload = {
        "content": content,
        "user": {"user_id": user_id}
    }

    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        f"{MEMU_API_URL}/memorize",
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST"
    )

    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            result = json.loads(resp.read().decode("utf-8"))
            return result
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8") if e.fp else ""
        return {"error": f"HTTP {e.code}: {body}"}
    except urllib.error.URLError as e:
        return {"error": f"连接失败: {e.reason}"}


def main():
    parser = argparse.ArgumentParser(description="memU 记忆存储")
    parser.add_argument("--user-id", required=True, help="机器人 ID（如 dolores）")
    parser.add_argument("--input", required=True, help="JSON 格式的对话内容")
    args = parser.parse_args()

    try:
        messages = json.loads(args.input)
    except json.JSONDecodeError as e:
        print(f"❌ JSON 解析失败: {e}", file=sys.stderr)
        sys.exit(1)

    if not isinstance(messages, list):
        print("❌ 输入必须是 JSON 数组", file=sys.stderr)
        sys.exit(1)

    result = memorize(args.user_id, messages)

    if "error" in result:
        print(f"❌ {result['error']}", file=sys.stderr)
        sys.exit(1)

    print(f"✅ 已存储 {len(messages)} 条消息到 memU（user: {args.user_id}）")
    print(json.dumps(result, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
