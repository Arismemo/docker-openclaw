"""
自定义 memU-server 入口文件
Hybrid 方案：Zhipu GLM-4.5-Air 做 ALL chat 调用，Ollama 做 embedding
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
ollama_base_url = os.getenv("OPENAI_BASE_URL", "http://172.17.0.1:11434/v1")
embed_model = os.getenv("DEFAULT_EMBED_MODEL", "nomic-embed-text")

# Zhipu 用于所有 LLM chat 调用
zhipu_api_key = os.getenv("ZHIPU_API_KEY", "")
zhipu_base_url = os.getenv("ZHIPU_BASE_URL", "https://open.bigmodel.cn/api/coding/paas/v4")
chat_model = os.getenv("DEFAULT_LLM_MODEL", "glm-4.5-air")

# Ollama 上可用的 fallback chat 模型（用于非关键调用）
ollama_chat_model = os.getenv("OLLAMA_CHAT_MODEL", "qwen2.5:1.5b")

print(f"🔧 memU hybrid 配置:")
print(f"   Chat:  {zhipu_base_url} / {chat_model}")
print(f"   Embed: {ollama_base_url} / {embed_model}")
print(f"   Ollama chat fallback: {ollama_chat_model}")

# 初始化 MemoryService
# 关键修复：chat_model 必须是 Ollama 上实际存在的模型
# 因为 MemoryService 内部的某些方法直接调用 self.openai.client（指向 Ollama）
service = MemoryService(
    llm_config={
        "api_key": "ollama",
        "base_url": ollama_base_url,
        "chat_model": ollama_chat_model,  # 使用 Ollama 上实际存在的模型
        "embed_model": embed_model,
    }
)

# 增加 Ollama client 超时（CPU 推理）
service.openai.client.timeout = httpx.Timeout(connect=30.0, read=120.0, write=120.0, pool=120.0)

# 创建 Zhipu chat client
zhipu_client = AsyncOpenAI(
    api_key=zhipu_api_key,
    base_url=zhipu_base_url,
    timeout=httpx.Timeout(connect=10.0, read=120.0, write=120.0, pool=120.0),
)

# Monkey-patch: 让所有 summarize 调用走 Zhipu（质量更高）
# 其他直接的 chat 调用会走 Ollama fallback 模型
import types


async def _zhipu_summarize(self, text, *, max_tokens=None, system_prompt=None):
    """使用 Zhipu 做 summarize（核心记忆提取方法）"""
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


service.openai.summarize = types.MethodType(_zhipu_summarize, service.openai)

print(f"✅ Hybrid 配置完成: summarize → Zhipu, chat fallback → Ollama, embedding → Ollama")

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
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(exc))


@app.get("/")
async def root():
    return {"message": "Hello MemU user!"}
