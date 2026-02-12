"""
自定义 memU-server 入口文件
Hybrid 方案：Zhipu GLM-4.5-Air 做 chat/summarize，Ollama 做 embedding
"""

import json
import os
import traceback
import uuid
from pathlib import Path
from typing import Any, Dict

import httpx
from openai import AsyncOpenAI
from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse
from memu.app import MemoryService

app = FastAPI()

# ===== 配置 =====
# Ollama 用于 embedding
ollama_base_url = os.getenv("OPENAI_BASE_URL", "http://host.docker.internal:11434/v1")
embed_model = os.getenv("DEFAULT_EMBED_MODEL", "nomic-embed-text")

# Zhipu 用于 chat/summarize
zhipu_api_key = os.getenv("ZHIPU_API_KEY", "")
zhipu_base_url = os.getenv("ZHIPU_BASE_URL", "https://open.bigmodel.cn/api/paas/v4")
chat_model = os.getenv("DEFAULT_LLM_MODEL", "glm-4.5-air")

print(f"🔧 memU hybrid 配置:")
print(f"   Chat:  {zhipu_base_url} / {chat_model}")
print(f"   Embed: {ollama_base_url} / {embed_model}")

# 初始化 MemoryService（用 Ollama 做 embedding）
service = MemoryService(
    llm_config={
        "api_key": "ollama",
        "base_url": ollama_base_url,
        "chat_model": chat_model,
        "embed_model": embed_model,
    }
)

# 增加 Ollama embedding client 的超时（CPU 推理可能较慢）
service.openai.client.timeout = httpx.Timeout(connect=30.0, read=120.0, write=120.0, pool=120.0)

# 创建 Zhipu chat client 并替换 summarize 方法
zhipu_client = AsyncOpenAI(
    api_key=zhipu_api_key,
    base_url=zhipu_base_url,
    timeout=httpx.Timeout(connect=10.0, read=120.0, write=120.0, pool=120.0),
)

# Monkey-patch: 让 chat/summarize 走 Zhipu，embedding 保持走 Ollama
_original_summarize = service.openai.summarize.__func__


async def _zhipu_summarize(self, text, *, max_tokens=None, system_prompt=None):
    """使用 Zhipu GLM-4.5-Air 做 summarize"""
    prompt = system_prompt or "Summarize the text in one short paragraph."
    messages = [
        {"role": "system", "content": prompt},
        {"role": "user", "content": text},
    ]
    response = await zhipu_client.chat.completions.create(
        model=chat_model,
        messages=messages,
        temperature=1,
        max_tokens=max_tokens,
    )
    return response.choices[0].message.content or ""


import types
service.openai.summarize = types.MethodType(_zhipu_summarize, service.openai)

print(f"✅ Hybrid 配置完成: chat → Zhipu, embedding → Ollama")

# 对话文件存储目录
storage_dir = Path(os.getenv("MEMU_STORAGE_DIR", "./data"))
storage_dir.mkdir(parents=True, exist_ok=True)


@app.post("/memorize")
async def memorize(payload: Dict[str, Any]):
    try:
        file_path = storage_dir / f"conversation-{uuid.uuid4().hex}.json"
        with file_path.open("w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False)

        result = await service.memorize(resource_url=str(file_path), modality="conversation")
        return JSONResponse(content={"status": "success", "result": result})
    except Exception as exc:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(exc))


@app.post("/retrieve")
async def retrieve(payload: Dict[str, Any]):
    if "query" not in payload:
        raise HTTPException(status_code=400, detail="Missing 'query' in request body")
    try:
        result = await service.retrieve([payload["query"]])
        return JSONResponse(content={"status": "success", "result": result})
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@app.get("/")
async def root():
    return {"message": "Hello MemU user!"}
