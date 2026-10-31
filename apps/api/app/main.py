import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import FEATURE_REQUIREMENTS, Settings, get_settings, validate_startup
from app.core.db import DatabaseStore
from app.routers import health, jobs, telemetry, zones
from app.services.embeddings import EmbeddingClient
from app.services.llm import LlmProvider

logger = logging.getLogger("imagginai.api")


def warn_missing_optional_settings(settings: Settings) -> None:
    # são apenas avisadas as funcionalidades ainda não configuradas, sem impedir a inicialização
    for feature in FEATURE_REQUIREMENTS:
        missing = settings.missing_for(feature)
        if missing:
            logger.warning("feature '%s' disabled, missing: %s", feature, ", ".join(missing))


def create_app(
    settings: Settings | None = None,
    *,
    db_store: DatabaseStore | None = None,
    embedding_client: EmbeddingClient | None = None,
    llm_provider: LlmProvider | None = None,
) -> FastAPI:
    app_settings = settings or get_settings()
    validate_startup(app_settings)
    warn_missing_optional_settings(app_settings)

    app = FastAPI(title="IMAGGINAI API", version="0.0.0")
    app.state.settings = app_settings
    app.state.db_store = db_store
    app.state.embedding_client = embedding_client
    app.state.llm_provider = llm_provider

    app.add_middleware(
        CORSMiddleware,
        allow_origins=app_settings.cors_origins,
        allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1|0\.0\.0\.0|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+)(:\d+)?$",
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(health.router)
    app.include_router(zones.router)
    app.include_router(jobs.router)
    app.include_router(telemetry.router)
    return app


app = create_app()
