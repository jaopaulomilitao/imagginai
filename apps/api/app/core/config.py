"""configuração da api lida do arquivo .env na raiz do monorepo e das variáveis de ambiente."""

from functools import lru_cache
from pathlib import Path
from typing import Annotated, Literal

from pydantic import field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parents[4]
ROOT_ENV_FILE = REPO_ROOT / ".env"

# limites estruturais do study pack (seção 3.6.2);
# são espelhados em apps/web/src/zone/config/constants.ts
STUDY_PACK_SCHEMA_VERSION = "1.0"
CONCEPT_LABEL_MAX_LENGTH = 40
CONCEPT_DEFINITION_MAX_LENGTH = 280
QUIZ_OPTION_COUNT = 4
POSITION_MIN = -1.0
POSITION_MAX = 1.0

# constantes de zonas, upload de pdf, chunking e embeddings (seções 2.4, 3.1, 3.6.1, 3.10 e 3.11)
ZONE_NAME_MIN_LENGTH = 1
ZONE_NAME_MAX_LENGTH = 80
ALLOWED_PANEL_RADII: tuple[float, ...] = (0.55, 0.75, 1.0, 1.5, 2.0)
PANEL_YAW_MIN_DEG = -180.0
PANEL_YAW_MAX_DEG = 180.0
PANEL_PITCH_MIN_DEG = -80.0
PANEL_PITCH_MAX_DEG = 80.0

SOURCE_MAX_SIZE_BYTES = 20 * 1024 * 1024
SOURCE_MAX_PAGES = 60
STORAGE_SOURCES_BUCKET = "sources"
STORAGE_PACKS_BUCKET = "packs"

CHUNK_TARGET_TOKENS = 500
CHUNK_OVERLAP_TOKENS = 50
EMBEDDING_DIMENSION = 768
EMBEDDING_BATCH_SIZE = 64

SUPABASE_JWT_AUDIENCE = "authenticated"
SUPABASE_JWT_ALGORITHMS: tuple[str, ...] = ("HS256",)

JOB_PROGRESS_MIN = 0
JOB_PROGRESS_MAX = 100
JOB_PROGRESS_EXTRACTING = 20
JOB_PROGRESS_EMBEDDING = 60
JOB_PROGRESS_SAVING = 85
JOB_PROGRESS_DONE = 100

Feature = Literal["supabase", "embeddings", "llm"]

# são agrupadas as variáveis por funcionalidade, pois cada fase passa a exigir um grupo diferente
FEATURE_REQUIREMENTS: dict[Feature, tuple[str, ...]] = {
    "supabase": ("supabase_url", "supabase_service_role_key", "supabase_jwt_secret"),
    "embeddings": ("gemini_api_key", "embedding_model"),
    "llm": (
        "gemini_api_key",
        "llm_model",
        "embedding_model",
        "groq_api_key",
        "fallback_llm_model",
    ),
}

# funcionalidades obrigatórias na inicialização; os testes rodam sem credenciais reais (seção 0.1)
STARTUP_REQUIRED_FEATURES: tuple[Feature, ...] = ()


class MissingSettingsError(RuntimeError):
    """é lançado quando faltam variáveis obrigatórias no .env."""


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=ROOT_ENV_FILE,
        env_file_encoding="utf-8",
        env_ignore_empty=True,
        extra="ignore",
    )

    supabase_url: str | None = None
    supabase_service_role_key: str | None = None
    supabase_jwt_secret: str | None = None
    gemini_api_key: str | None = None
    llm_model: str | None = None
    embedding_model: str | None = None
    groq_api_key: str | None = None
    fallback_llm_model: str | None = None
    cors_origins: Annotated[list[str], NoDecode] = ["http://localhost:5173"]

    @field_validator("cors_origins", mode="before")
    @classmethod
    def split_cors_origins(cls, value: object) -> object:
        # a lista é recebida como texto separado por vírgulas no .env
        if isinstance(value, str):
            return [origin.strip() for origin in value.split(",") if origin.strip()]
        return value

    @field_validator("cors_origins")
    @classmethod
    def reject_wildcard_origins(cls, origins: list[str]) -> list[str]:
        for origin in origins:
            if origin == "*" or not origin.startswith(("http://", "https://")):
                raise ValueError(f"CORS_ORIGINS must list explicit http(s) origins, got {origin!r}")
        return origins

    @field_validator("supabase_url")
    @classmethod
    def require_https_supabase_url(cls, value: str | None) -> str | None:
        if value is not None and not value.startswith("https://"):
            raise ValueError("SUPABASE_URL must start with https://")
        return value

    def missing_for(self, feature: Feature) -> list[str]:
        return [name.upper() for name in FEATURE_REQUIREMENTS[feature] if not getattr(self, name)]

    def require(self, feature: Feature) -> None:
        missing = self.missing_for(feature)
        if missing:
            raise MissingSettingsError(
                f"missing required environment variables for '{feature}': "
                f"{', '.join(missing)}. Fill them in {ROOT_ENV_FILE} (see .env.example)."
            )


def validate_startup(settings: Settings) -> None:
    for feature in STARTUP_REQUIRED_FEATURES:
        settings.require(feature)


@lru_cache
def get_settings() -> Settings:
    return Settings()
