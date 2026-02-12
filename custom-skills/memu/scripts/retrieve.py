#!/usr/bin/env python3
"""
memU 记忆检索脚本
调用 memU-server 的 /retrieve API 检索相关记忆
"""

import argparse
import json
import sys
import urllib.request
import urllib.error
import os

MEMU_API_URL = os.environ.get("MEMU_API_URL", "http://memu-server:8000")


def retrieve(user_id: str, query: str) -> dict:
    """从 memU 检索相关记忆"""
    payload = {
        "query": query,
        "where": {"user_id": user_id}
    }

    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        f"{MEMU_API_URL}/retrieve",
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
    parser = argparse.ArgumentParser(description="memU 记忆检索")
    parser.add_argument("--user-id", required=True, help="机器人 ID（如 dolores）")
    parser.add_argument("--query", required=True, help="检索关键词或问题")
    args = parser.parse_args()

    result = retrieve(args.user_id, args.query)

    if "error" in result:
        print(f"❌ {result['error']}", file=sys.stderr)
        sys.exit(1)

    # 格式化输出记忆内容
    items = result.get("items", [])
    categories = result.get("categories", [])

    if not items and not categories:
        print("ℹ️ 未找到相关记忆")
    else:
        if categories:
            print(f"📂 相关分类: {', '.join(str(c) for c in categories)}")
        if items:
            print(f"📝 找到 {len(items)} 条相关记忆:")
            for i, item in enumerate(items, 1):
                text = item.get("content", item.get("text", str(item)))
                print(f"  {i}. {text}")

    # 同时输出原始 JSON 供 agent 解析
    print("\n--- 原始数据 ---")
    print(json.dumps(result, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
