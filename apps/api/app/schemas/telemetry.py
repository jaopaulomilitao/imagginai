"""esquemas pydantic dos agregados de telemetria com bloqueio de dados brutos (seção 3.9)."""

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

ConceptTimeBucket = Literal["0-5s", "5-30s", ">30s"]

FORBIDDEN_TELEMETRY_KEYS: tuple[str, ...] = (
    "landmarks",
    "rawlandmarks",
    "smoothedlandmarks",
    "headorientation",
    "headorientationseries",
    "headseries",
    "videoframe",
    "videoframes",
    "audio",
    "audiobuffer",
    "audiostream",
    "camerastream",
)


def _contains_forbidden_key(value: Any) -> bool:
    # verifica recursivamente se qualquer chave proibida está presente na carga útil
    if isinstance(value, dict):
        for key, nested in value.items():
            normalized = str(key).lower().replace("_", "").replace("-", "")
            if any(forbidden in normalized for forbidden in FORBIDDEN_TELEMETRY_KEYS):
                return True
            if _contains_forbidden_key(nested):
                return True
    elif isinstance(value, list):
        return any(_contains_forbidden_key(item) for item in value)
    return False


class ConceptQuizAccuracySchema(BaseModel):
    """contagem de acertos e erros de quiz associada a um conceito."""

    model_config = ConfigDict(extra="forbid")

    correct: int = Field(default=0, ge=0)
    incorrect: int = Field(default=0, ge=0)


class SessionAggregatePayloadSchema(BaseModel):
    """métricas agregadas da sessão de estudo permitidas para pesquisa (seção 3.9)."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    total_focus_time_ms: int = Field(alias="totalFocusTimeMs", ge=0)
    concept_time_ms: dict[str, int] = Field(default_factory=dict, alias="conceptTimeMs")
    concept_time_buckets: dict[str, ConceptTimeBucket] = Field(
        default_factory=dict, alias="conceptTimeBuckets"
    )
    concept_opens: dict[str, int] = Field(default_factory=dict, alias="conceptOpens")
    quiz_by_concept: dict[str, ConceptQuizAccuracySchema] = Field(
        default_factory=dict, alias="quizByConcept"
    )
    pinch_success_count: int = Field(default=0, alias="pinchSuccessCount", ge=0)
    pinch_miss_count: int = Field(default=0, alias="pinchMissCount", ge=0)
    pinch_repeat_count: int = Field(default=0, alias="pinchRepeatCount", ge=0)
    pinch_success_rate: float = Field(default=1.0, alias="pinchSuccessRate", ge=0.0, le=1.0)
    mode_time_ms: dict[str, int] = Field(default_factory=dict, alias="modeTimeMs")
    fps_p50: float = Field(default=60.0, alias="fpsP50", ge=0.0)
    fps_p10: float = Field(default=55.0, alias="fpsP10", ge=0.0)
    completed_pomodoro_blocks: int = Field(default=0, alias="completedPomodoroBlocks", ge=0)


class SessionAggregateRequest(BaseModel):
    """envelope de submissão idempotente de agregado de sessão."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    session_id: str = Field(alias="sessionId", min_length=1, max_length=120)
    zone_id: str = Field(alias="zoneId", min_length=1, max_length=120)
    payload: SessionAggregatePayloadSchema

    @model_validator(mode="before")
    @classmethod
    def reject_forbidden_biometric_fields(cls, data: Any) -> Any:
        # rejeita qualquer tentativa de enviar landmarks, orientação da cabeça, vídeo ou áudio
        if _contains_forbidden_key(data):
            raise ValueError(
                "campos proibidos detectados: landmarks, orientacao, video ou audio "
                "nao podem ser transmitidos."
            )
        return data


class SessionAggregateResponse(BaseModel):
    """resposta de confirmação do armazenamento idempotente do agregado."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    id: str
    session_id: str = Field(alias="sessionId")
    zone_id: str = Field(alias="zoneId")
    created_at: str = Field(alias="createdAt")
