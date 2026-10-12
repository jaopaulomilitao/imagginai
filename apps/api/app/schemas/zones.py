"""esquemas pydantic para criação, atualização e listagem de zonas e fontes (seções 3.3 e 3.10)."""

from typing import Annotated, Literal

from pydantic import AfterValidator, BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

from app.core.config import (
    ALLOWED_PANEL_RADII,
    PANEL_PITCH_MAX_DEG,
    PANEL_PITCH_MIN_DEG,
    PANEL_YAW_MAX_DEG,
    PANEL_YAW_MIN_DEG,
    ZONE_NAME_MAX_LENGTH,
    ZONE_NAME_MIN_LENGTH,
)

EnvironmentPreset = Literal["focus-dark", "focus-nature"]


def _validate_zone_name(value: str) -> str:
    # garante que o nome da zona não seja vazio e respeite o limite do banco
    cleaned = value.strip()
    if len(cleaned) < ZONE_NAME_MIN_LENGTH or len(cleaned) > ZONE_NAME_MAX_LENGTH:
        raise ValueError(
            f"zone name must have between {ZONE_NAME_MIN_LENGTH} and {ZONE_NAME_MAX_LENGTH} chars"
        )
    return cleaned


def _validate_non_empty(value: str) -> str:
    cleaned = value.strip()
    if not cleaned:
        raise ValueError("value must be a non-empty string")
    return cleaned


def _validate_panel_radius(value: float) -> float:
    # verifica se o raio do painel pertence ao conjunto discreto permitido
    for allowed in ALLOWED_PANEL_RADII:
        if abs(value - allowed) < 1e-6:
            return allowed
    raise ValueError(f"radiusM must be one of {ALLOWED_PANEL_RADII}")


ZoneNameStr = Annotated[str, AfterValidator(_validate_zone_name)]
NonBlankStr = Annotated[str, AfterValidator(_validate_non_empty)]
PanelRadius = Annotated[float, AfterValidator(_validate_panel_radius)]


class CamelModel(BaseModel):
    """modelo base que aceita snake_case ou camelCase e serializa em camelCase."""

    model_config = ConfigDict(
        alias_generator=to_camel,
        validate_by_name=True,
        validate_by_alias=True,
        serialize_by_alias=True,
        extra="forbid",
    )


class PanelLayoutSchema(CamelModel):
    panel_id: NonBlankStr
    yaw_deg: float = Field(ge=PANEL_YAW_MIN_DEG, le=PANEL_YAW_MAX_DEG)
    pitch_deg: float = Field(ge=PANEL_PITCH_MIN_DEG, le=PANEL_PITCH_MAX_DEG)
    radius_m: PanelRadius


class ZoneCreateRequest(CamelModel):
    name: ZoneNameStr
    environment: EnvironmentPreset = "focus-dark"


class ZoneUpdateRequest(CamelModel):
    name: ZoneNameStr | None = None
    environment: EnvironmentPreset | None = None
    layout: list[PanelLayoutSchema] | None = None


class ZoneResponse(CamelModel):
    id: str
    name: str
    environment: EnvironmentPreset
    source_ids: list[str]
    pack_id: str | None = None
    layout: list[PanelLayoutSchema]
    created_at: str
    updated_at: str


class ZoneDeleteResponse(CamelModel):
    id: str
    deleted: bool


class SourceUploadResponse(CamelModel):
    job_id: str
    source_id: str
    title: str
    page_count: int
