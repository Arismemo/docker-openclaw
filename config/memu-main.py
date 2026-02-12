"""
自定义 memU-server 入口文件
覆盖默认配置，使用 Ollama 做 embedding 和 chat
"""

import json
import os
import traceback
import uuid
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse
from memu.app import MemoryService

from app.database import get_database_url

app = FastAPI(title="memU Server", version="0.1.0")

# 环境变量
openai_api_key = os.getenv("OPENAI_API_KEY", "ollama")
openai_base_url = os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1")
chat_model = os.getenv("DEFAULT_LLM_MODEL", "gpt-4o-mini")
embed_model = os.getenv("DEFAULT_EMBED_MODEL", "text-embedding-3-small")

# 数据库 URL
database_url = get_database_url()

service = MemoryService(
    llm_profiles={
        "default": {
            "provider": "openai",
            "api_key": openai_api_key,
            "base_url": openai_base_url,
            "model": chat_model,
            "embed_model": embed_model,
        }
    },
    database_config={"url": database_url},
)

# 对话文件存储目录
storage_dir = Path(os.getenv("STORAGE_PATH") or os.getenv("MEMU_STORAGE_DIR") or "./data")
storage_dir.mkdir(parents=True, exist_ok=True)


@app.post("/memorize")
async def memorize(payload: dict[str, Any]):
    try:
        file_path = storage_dir / f"conversation-{uuid.uuid4().hex}.json"
        with file_path.open("w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False)

        result = await service.memorize(resource_url=str(file_path), modality="conversation")
        return JSONResponse(content={"status": "success", "result": result})
    except Exception as exc:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/retrieve")
async def retrieve(payload: dict[str, Any]):
    if "query" not in payload:
        raise HTTPException(status_code=400, detail="Missing 'query' in request body")
    try:
        result = await service.retrieve([payload["query"]])
        return JSONResponse(content={"status": "success", "result": result})
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/")
async def root():
    return {"message": "Hello MemU user!"}
