"""
自定义 memU-server 入口文件
基于 Docker 镜像中的实际代码结构，注入 Ollama 的 base_url / embed_model / chat_model
"""

import json
import os
import traceback
import uuid
from pathlib import Path
from typing import Any, Dict

from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse
from memu.app import MemoryService

app = FastAPI()

# 从环境变量获取配置
api_key = os.getenv("OPENAI_API_KEY", "ollama")
base_url = os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1")
chat_model = os.getenv("DEFAULT_LLM_MODEL", "qwen2.5:0.5b")
embed_model = os.getenv("DEFAULT_EMBED_MODEL", "nomic-embed-text")

# 初始化 MemoryService，传入完整的 llm_config
service = MemoryService(
    llm_config={
        "api_key": api_key,
        "base_url": base_url,
        "chat_model": chat_model,
        "embed_model": embed_model,
    }
)

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
