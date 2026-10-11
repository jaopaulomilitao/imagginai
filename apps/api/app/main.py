import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import FEATURE_REQUIREMENTS, Settings, get_settings, validate_startup
from app.routers import health

logger = logging.getLogger("imagginai.api")


def warn_missing_optional_settings(settings: Settings) -> None:
    # são apenas avisadas as funcionalidades ainda não configuradas, sem impedir a inicialização
    for feature in FEATURE_REQUIREMENTS:
        missing = settings.missing_for(feature)
        if missing:
            logger.warning("feature '%s' disabled, missing: %s", feature, ", ".join(missing))


def create_app(settings: Settings | None = None) -> FastAPI:
    app_settings = settings or get_settings()
    validate_startup(app_settings)
    warn_missing_optional_settings(app_settings)

    app = FastAPI(title="IMAGGINAI API", version="0.0.0")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=app_settings.cors_origins,
        allow_credentials=False,
        allow_methods=["GET", "POST", "PATCH", "DELETE"],
        allow_headers=["Authorization", "Content-Type"],
    )
    app.include_router(health.router)
    return app


app = create_app()
