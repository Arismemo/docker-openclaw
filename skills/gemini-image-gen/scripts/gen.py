#!/usr/bin/env python3
"""通过 Gemini 代理的 Chat Completions API 生成图片。

使用 gemini-3-pro-image 模型，通过 /v1/chat/completions 端点生成图片，
从响应 content 中提取 base64 编码的图片数据。
"""
import argparse
import base64
import datetime as dt
import json
import os
import random
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path


def slugify(text: str) -> str:
    text = text.lower().strip()
    text = re.sub(r"[^a-z0-9]+", "-", text)
    text = re.sub(r"-{2,}", "-", text).strip("-")
    return text or "image"


def default_out_dir() -> Path:
    now = dt.datetime.now().strftime("%Y-%m-%d-%H-%M-%S")
    preferred = Path.home() / "Projects" / "tmp"
    base = preferred if preferred.is_dir() else Path("./tmp")
    base.mkdir(parents=True, exist_ok=True)
    return base / f"gemini-image-gen-{now}"


def pick_prompts(count: int) -> list[str]:
    """随机生成结构化的图片提示词"""
    subjects = [
        "a lobster astronaut",
        "a brutalist lighthouse",
        "a cozy reading nook",
        "a cyberpunk noodle shop",
        "a Vienna street at dusk",
        "a minimalist product photo",
        "a surreal underwater library",
        "a cute orange cat on a windowsill",
        "a futuristic Tokyo skyline",
    ]
    styles = [
        "ultra-detailed studio photo",
        "35mm film still",
        "isometric illustration",
        "editorial photography",
        "soft watercolor",
        "architectural render",
        "high-contrast monochrome",
        "digital art",
    ]
    lighting = [
        "golden hour",
        "overcast soft light",
        "neon lighting",
        "dramatic rim light",
        "candlelight",
        "foggy atmosphere",
    ]
    prompts: list[str] = []
    for _ in range(count):
        prompts.append(
            f"{random.choice(styles)} of {random.choice(subjects)}, {random.choice(lighting)}"
        )
    return prompts


def extract_base64_image(content: str) -> bytes | None:
    """从 Chat Completions 响应内容中提取 base64 图片数据。

    Gemini 返回的图片数据格式：
    1. data:image/xxx;base64,<data> (内嵌 data URI)
    2. 超长的 base64 字符串
    """
    if not content:
        return None

    # 尝试提取 data URI 中的 base64 数据
    if "base64," in content:
        b64_str = content.split("base64,")[1].split('"')[0].split(")")[0].strip()
        try:
            return base64.b64decode(b64_str)
        except Exception:
            pass

    # 尝试直接作为 base64 解码（超长内容）
    if len(content) > 1000:
        # 移除可能的前后缀
        cleaned = re.sub(r'[^A-Za-z0-9+/=]', '', content)
        if len(cleaned) > 500:
            try:
                return base64.b64decode(cleaned)
            except Exception:
                pass

    return None


def request_image(
    api_key: str,
    base_url: str,
    prompt: str,
    model: str = "gemini-3-pro-image",
) -> bytes:
    """通过 Chat Completions API 请求生成图片，返回图片二进制数据。"""
    url = f"{base_url}/chat/completions"
    body = json.dumps({
        "model": model,
        "messages": [{"role": "user", "content": f"Generate an image: {prompt}"}],
        "max_tokens": 8192,
    }).encode("utf-8")

    req = urllib.request.Request(
        url,
        method="POST",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        data=body,
    )
    try:
        with urllib.request.urlopen(req, timeout=300) as resp:
            result = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        payload = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Gemini Images API failed ({e.code}): {payload}") from e

    content = result.get("choices", [{}])[0].get("message", {}).get("content", "")
    image_data = extract_base64_image(content)
    if not image_data:
        raise RuntimeError(
            f"No image data in response. Content length: {len(content)}, "
            f"preview: {content[:200]}"
        )
    return image_data


def write_gallery(out_dir: Path, items: list[dict]) -> None:
    """生成 HTML 缩略图画廊"""
    thumbs = "\n".join(
        [
            f"""
<figure>
  <a href="{it["file"]}"><img src="{it["file"]}" loading="lazy" /></a>
  <figcaption>{it["prompt"]}</figcaption>
</figure>
""".strip()
            for it in items
        ]
    )
    html = f"""<!doctype html>
<meta charset="utf-8" />
<title>gemini-image-gen</title>
<style>
  :root {{ color-scheme: dark; }}
  body {{ margin: 24px; font: 14px/1.4 ui-sans-serif, system-ui; background: #0b0f14; color: #e8edf2; }}
  h1 {{ font-size: 18px; margin: 0 0 16px; }}
  .grid {{ display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 16px; }}
  figure {{ margin: 0; padding: 12px; border: 1px solid #1e2a36; border-radius: 14px; background: #0f1620; }}
  img {{ width: 100%; height: auto; border-radius: 10px; display: block; }}
  figcaption {{ margin-top: 10px; color: #b7c2cc; }}
  code {{ color: #9cd1ff; }}
</style>
<h1>🎨 Gemini Image Gen</h1>
<p>Output: <code>{out_dir.as_posix()}</code></p>
<div class="grid">
{thumbs}
</div>
"""
    (out_dir / "index.html").write_text(html, encoding="utf-8")


def main() -> int:
    ap = argparse.ArgumentParser(description="通过 Gemini 代理生成图片。")
    ap.add_argument("--prompt", help="图片提示词。不指定则随机生成。")
    ap.add_argument("--count", type=int, default=1, help="生成图片数量（默认 1）。")
    ap.add_argument("--model", default="gemini-3-pro-image", help="图片模型 ID。")
    ap.add_argument("--out-dir", default="", help="输出目录。")
    args = ap.parse_args()

    api_key = (os.environ.get("GEMINI_API_KEY") or "").strip()
    if not api_key:
        print("Missing GEMINI_API_KEY", file=sys.stderr)
        return 2

    base_url = (
        os.environ.get("GEMINI_BASE_URL") or "https://gemini.709970.xyz/v1"
    ).rstrip("/")

    out_dir = Path(args.out_dir).expanduser() if args.out_dir else default_out_dir()
    out_dir.mkdir(parents=True, exist_ok=True)

    prompts = [args.prompt] * args.count if args.prompt else pick_prompts(args.count)

    items: list[dict] = []
    for idx, prompt in enumerate(prompts, start=1):
        print(f"[{idx}/{len(prompts)}] {prompt}")
        try:
            image_data = request_image(api_key, base_url, prompt, args.model)
            filename = f"{idx:03d}-{slugify(prompt)[:40]}.png"
            filepath = out_dir / filename
            filepath.write_bytes(image_data)
            items.append({"prompt": prompt, "file": filename})
            print(f"  ✅ saved: {filename} ({len(image_data)} bytes)")
        except Exception as e:
            print(f"  ❌ failed: {e}", file=sys.stderr)
            continue

    if items:
        (out_dir / "prompts.json").write_text(
            json.dumps(items, indent=2, ensure_ascii=False), encoding="utf-8"
        )
        write_gallery(out_dir, items)
        print(f"\nWrote: {(out_dir / 'index.html').as_posix()}")
    else:
        print("\n⚠️ No images generated.", file=sys.stderr)
        return 1

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
