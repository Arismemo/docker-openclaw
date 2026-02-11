#!/usr/bin/env python3
"""飞书欢迎教程卡片发送脚本。

通过飞书 REST API 发送交互式消息卡片，展示 Dolores 的核心能力。
凭据从 OpenClaw 配置文件中读取。
"""
import argparse
import json
import os
import sys
import urllib.request
import urllib.error

# ── 配置读取 ──────────────────────────────────────────────

def load_feishu_config():
    """从 OpenClaw 配置文件读取飞书凭据。"""
    config_path = os.path.expanduser("~/.openclaw/openclaw.json")
    if not os.path.exists(config_path):
        print(f"❌ 配置文件不存在: {config_path}", file=sys.stderr)
        sys.exit(1)
    with open(config_path) as f:
        config = json.load(f)
    feishu = config.get("channels", {}).get("feishu", {})
    app_id = feishu.get("appId", "")
    app_secret = feishu.get("appSecret", "")
    if not app_id or not app_secret:
        print("❌ 飞书 appId 或 appSecret 未配置", file=sys.stderr)
        sys.exit(1)
    domain = feishu.get("domain", "feishu")
    base = "https://open.larksuite.com" if domain == "lark" else "https://open.feishu.cn"
    return app_id, app_secret, base


def get_tenant_token(app_id, app_secret, base_url):
    """获取 tenant_access_token。"""
    url = f"{base_url}/open-apis/auth/v3/tenant_access_token/internal"
    data = json.dumps({"app_id": app_id, "app_secret": app_secret}).encode()
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=10) as resp:
        result = json.loads(resp.read())
    if result.get("code") != 0:
        print(f"❌ 获取 token 失败: {result.get('msg')}", file=sys.stderr)
        sys.exit(1)
    return result["tenant_access_token"]


# ── 卡片模板 ──────────────────────────────────────────────

def card_main():
    """主教程卡片：展示所有核心能力。"""
    return {
        "header": {
            "title": {"tag": "plain_text", "content": "🤖 Dolores 使用指南"},
            "template": "blue"
        },
        "elements": [
            {
                "tag": "div",
                "text": {
                    "tag": "lark_md",
                    "content": "你好！我是 **Dolores**，你的 AI 助手。\n以下是我的核心能力，回复对应 **数字** 即可体验 👇"
                }
            },
            {"tag": "hr"},
            {
                "tag": "div",
                "text": {
                    "tag": "lark_md",
                    "content": "**🎨 1. 画图生成**\n输入提示词，我用 AI 帮你生成精美图片。\n💡 试试说：「帮我画一只太空猫」"
                }
            },
            {"tag": "hr"},
            {
                "tag": "div",
                "text": {
                    "tag": "lark_md",
                    "content": "**🔍 2. 联网搜索**\n实时搜索互联网，获取最新资讯和答案。\n💡 试试说：「搜索今天的 AI 新闻」"
                }
            },
            {"tag": "hr"},
            {
                "tag": "div",
                "text": {
                    "tag": "lark_md",
                    "content": "**💾 3. 长期记忆**\n告诉我你的偏好，我会跨对话记住。\n💡 试试说：「记住我喜欢猫」"
                }
            },
            {"tag": "hr"},
            {
                "tag": "div",
                "text": {
                    "tag": "lark_md",
                    "content": "**📝 4. 飞书文档**\n帮你读取、创建、编辑飞书云文档。\n💡 试试说：「帮我创建一个会议纪要」"
                }
            },
            {"tag": "hr"},
            {
                "tag": "div",
                "text": {
                    "tag": "lark_md",
                    "content": "**📊 5. 数据表格**\n操作飞书多维表格，查询和整理数据。\n💡 试试说：「查看项目进度表」"
                }
            },
            {"tag": "hr"},
            {
                "tag": "note",
                "elements": [
                    {
                        "tag": "plain_text",
                        "content": "💬 回复 1-5 体验对应功能 ｜ 随时输入「教程」重新查看本指南"
                    }
                ]
            }
        ]
    }


def card_art():
    """画图功能详解卡片。"""
    return {
        "header": {
            "title": {"tag": "plain_text", "content": "🎨 画图功能详解"},
            "template": "green"
        },
        "elements": [
            {
                "tag": "div",
                "text": {
                    "tag": "lark_md",
                    "content": "AI 已为你生成了一张演示图片！✨\n\n**更多玩法：**"
                }
            },
            {"tag": "hr"},
            {
                "tag": "div",
                "text": {
                    "tag": "lark_md",
                    "content": "• 「画一组 25 个猫咪鞋饰」— 批量商品图\n• 「用水彩风格画一幅山水画」— 指定风格\n• 「生成 4 张赛博朋克风格的图」— 多张生成"
                }
            },
            {"tag": "hr"},
            {
                "tag": "note",
                "elements": [
                    {"tag": "plain_text", "content": "ℹ️ 支持中英文提示词 ｜ 支持批量生成 ｜ 图片直接发送到对话"}
                ]
            }
        ]
    }


def card_search():
    """搜索功能详解卡片。"""
    return {
        "header": {
            "title": {"tag": "plain_text", "content": "🔍 联网搜索详解"},
            "template": "orange"
        },
        "elements": [
            {
                "tag": "div",
                "text": {
                    "tag": "lark_md",
                    "content": "搜索结果已为你整理好了！📰\n\n**更多用法：**"
                }
            },
            {"tag": "hr"},
            {
                "tag": "div",
                "text": {
                    "tag": "lark_md",
                    "content": "• 「XX 公司最新融资消息」— 商业情报\n• 「Python 3.13 新特性是什么」— 技术查询\n• 「今天北京天气怎么样」— 实时信息"
                }
            },
            {"tag": "hr"},
            {
                "tag": "note",
                "elements": [
                    {"tag": "plain_text", "content": "ℹ️ 基于 Brave Search ｜ 实时联网 ｜ 自动整理摘要"}
                ]
            }
        ]
    }


def card_memory():
    """记忆功能详解卡片。"""
    return {
        "header": {
            "title": {"tag": "plain_text", "content": "💾 长期记忆详解"},
            "template": "purple"
        },
        "elements": [
            {
                "tag": "div",
                "text": {
                    "tag": "lark_md",
                    "content": "我会记住你告诉我的信息！🧠\n\n**记忆能力：**"
                }
            },
            {"tag": "hr"},
            {
                "tag": "div",
                "text": {
                    "tag": "lark_md",
                    "content": "• 「记住我的项目叫 PixelMerchant」— 项目信息\n• 「我喜欢简洁的设计风格」— 个人偏好\n• 「我的团队有 5 个人」— 团队背景"
                }
            },
            {"tag": "hr"},
            {
                "tag": "note",
                "elements": [
                    {"tag": "plain_text", "content": "ℹ️ 跨对话保持记忆 ｜ 自动关联上下文 ｜ 越用越懂你"}
                ]
            }
        ]
    }


def card_doc():
    """飞书文档功能详解卡片。"""
    return {
        "header": {
            "title": {"tag": "plain_text", "content": "📝 飞书文档详解"},
            "template": "turquoise"
        },
        "elements": [
            {
                "tag": "div",
                "text": {
                    "tag": "lark_md",
                    "content": "直接在对话中操作云文档！📄\n\n**支持操作：**"
                }
            },
            {"tag": "hr"},
            {
                "tag": "div",
                "text": {
                    "tag": "lark_md",
                    "content": "• 「帮我创建一个会议纪要」— 新建文档\n• 「读取这个文档的内容」+ 文档链接 — 读取\n• 「帮我写一份周报」— AI 辅助撰写"
                }
            },
            {"tag": "hr"},
            {
                "tag": "note",
                "elements": [
                    {"tag": "plain_text", "content": "ℹ️ 支持飞书云文档读写 ｜ 支持 Markdown ｜ AI 辅助撰写"}
                ]
            }
        ]
    }


def card_table():
    """数据表格功能详解卡片。"""
    return {
        "header": {
            "title": {"tag": "plain_text", "content": "📊 数据表格详解"},
            "template": "red"
        },
        "elements": [
            {
                "tag": "div",
                "text": {
                    "tag": "lark_md",
                    "content": "操作飞书多维表格，轻松管理数据！📋\n\n**支持操作：**"
                }
            },
            {"tag": "hr"},
            {
                "tag": "div",
                "text": {
                    "tag": "lark_md",
                    "content": "• 「查看项目进度表」— 查询记录\n• 「添加一条新的任务记录」— 新增数据\n• 「统计本月完成的任务数」— 数据分析"
                }
            },
            {"tag": "hr"},
            {
                "tag": "note",
                "elements": [
                    {"tag": "plain_text", "content": "ℹ️ 支持多维表格 CRUD ｜ 自然语言查询 ｜ 数据统计"}
                ]
            }
        ]
    }


CARD_MAP = {
    "main": card_main,
    "art": card_art,
    "search": card_search,
    "memory": card_memory,
    "doc": card_doc,
    "table": card_table,
}


# ── 发送逻辑 ──────────────────────────────────────────────

def send_card(token, base_url, chat_id, card_json):
    """发送卡片消息到指定会话。"""
    url = f"{base_url}/open-apis/im/v1/messages?receive_id_type=chat_id"
    payload = {
        "receive_id": chat_id,
        "msg_type": "interactive",
        "content": json.dumps(card_json)
    }
    data = json.dumps(payload).encode()
    req = urllib.request.Request(url, data=data, headers={
        "Content-Type": "application/json; charset=utf-8",
        "Authorization": f"Bearer {token}"
    })
    with urllib.request.urlopen(req, timeout=15) as resp:
        result = json.loads(resp.read())
    if result.get("code") != 0:
        print(f"❌ 发送卡片失败: {result.get('msg')}", file=sys.stderr)
        sys.exit(1)
    return result


def main():
    parser = argparse.ArgumentParser(description="发送飞书欢迎教程卡片")
    parser.add_argument("--type", choices=list(CARD_MAP.keys()), default="main",
                        help="卡片类型：main(主教程) / art(画图) / search(搜索) / memory(记忆) / doc(文档) / table(表格)")
    parser.add_argument("--chat-id", required=True,
                        help="飞书会话 ID（oc_ 开头的 chat_id）")
    args = parser.parse_args()

    app_id, app_secret, base_url = load_feishu_config()
    token = get_tenant_token(app_id, app_secret, base_url)
    card = CARD_MAP[args.type]()
    result = send_card(token, base_url, args.chat_id, card)
    msg_id = result.get("data", {}).get("message_id", "unknown")
    print(f"✅ 卡片已发送 (type={args.type}, message_id={msg_id})")


if __name__ == "__main__":
    main()
