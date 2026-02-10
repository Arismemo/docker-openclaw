---
name: gemini-image-gen
description: 通过 Gemini 代理的 gemini-3-pro-image 模型生成图片，输出 PNG + HTML 画廊。
homepage: https://gemini.709970.xyz
metadata:
  {
    "openclaw":
      {
        "emoji": "🎨",
        "requires": { "bins": ["python3"], "env": ["GEMINI_API_KEY"] },
        "primaryEnv": "GEMINI_API_KEY",
        "install":
          [
            {
              "id": "python-brew",
              "kind": "brew",
              "formula": "python",
              "bins": ["python3"],
              "label": "Install Python (brew)",
            },
          ],
      },
  }
---

# Gemini Image Gen

通过 Gemini 代理的 `gemini-3-pro-image` 模型生成图片。使用 Chat Completions API 并从响应中提取 base64 图片数据。

## Run

```bash
python3 {baseDir}/scripts/gen.py --prompt "一只可爱的橘猫坐在窗台上看日落"
```

常用参数：

```bash
# 生成单张图片
python3 {baseDir}/scripts/gen.py --prompt "赛博朋克风格的东京夜景" --count 1

# 批量生成（每次 API 请求只能生成 1 张图片，脚本会自动循环调用）
python3 {baseDir}/scripts/gen.py --count 4

# 自定义输出目录
python3 {baseDir}/scripts/gen.py --prompt "水彩风格的山水画" --out-dir ./my-images
```

## Output

- `*.png` 图片文件
- `prompts.json`（prompt → 文件映射）
- `index.html`（缩略图画廊）
