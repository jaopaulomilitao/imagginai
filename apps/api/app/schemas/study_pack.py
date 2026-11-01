"""espelho exato de apps/web/src/shared/types/study-pack.ts (seção 3.6.2)."""

import re
from collections.abc import Sequence
from datetime import datetime
from typing import Annotated, Literal, Protocol

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, model_validator
from pydantic.alias_generators import to_camel

from app.core.config import (
    CONCEPT_DEFINITION_MAX_LENGTH,
    CONCEPT_LABEL_MAX_LENGTH,
    POSITION_MAX,
    POSITION_MIN,
    QUIZ_OPTION_COUNT,
)

# formato iso 8601 com fuso explícito, idêntico ao aceito pelo validador typescript
ISO_DATE_TIME = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$")


def _reject_blank(value: str) -> str:
    if not value.strip():
        raise ValueError("must be a non-empty string")
    return value


def _require_iso_date_time(value: str) -> str:
    if not ISO_DATE_TIME.match(value):
        raise ValueError("must be an ISO 8601 date-time with timezone")
    datetime.fromisoformat(value)
    return value


NonEmptyStr = Annotated[str, AfterValidator(_reject_blank)]
Coordinate = Annotated[float, Field(ge=POSITION_MIN, le=POSITION_MAX)]


class StudyPackModel(BaseModel):
    # os campos python ficam em snake_case e o json usa camelCase, como no typescript
    model_config = ConfigDict(
        alias_generator=to_camel,
        validate_by_name=True,
        validate_by_alias=True,
        serialize_by_alias=True,
        extra="forbid",
        strict=True,
    )


class SourceAnchor(StudyPackModel):
    source_id: NonEmptyStr
    page: int = Field(ge=1)
    chunk_id: NonEmptyStr


# todo item gerado precisa de ao menos uma âncora de fonte (seção 1.3)
Anchors = Annotated[list[SourceAnchor], Field(min_length=1)]


class PackSource(StudyPackModel):
    id: NonEmptyStr
    title: NonEmptyStr
    page_count: int = Field(ge=1)


class ConceptNode(StudyPackModel):
    id: NonEmptyStr
    label: NonEmptyStr = Field(max_length=CONCEPT_LABEL_MAX_LENGTH)
    definition: NonEmptyStr = Field(max_length=CONCEPT_DEFINITION_MAX_LENGTH)
    anchors: Anchors
    position: tuple[Coordinate, Coordinate, Coordinate]


class ConceptEdge(StudyPackModel):
    source_id: NonEmptyStr
    target_id: NonEmptyStr
    relation: NonEmptyStr
    anchors: Anchors


class StudyCard(StudyPackModel):
    id: NonEmptyStr
    title: NonEmptyStr
    body: NonEmptyStr
    concept_ids: list[NonEmptyStr]
    anchors: Anchors


class QuizItem(StudyPackModel):
    id: NonEmptyStr
    prompt: NonEmptyStr
    options: list[NonEmptyStr] = Field(min_length=QUIZ_OPTION_COUNT, max_length=QUIZ_OPTION_COUNT)
    correct_index: int = Field(ge=0, le=QUIZ_OPTION_COUNT - 1)
    explanation: NonEmptyStr
    concept_ids: list[NonEmptyStr]
    anchors: Anchors


class SequenceStep(StudyPackModel):
    id: NonEmptyStr
    text: NonEmptyStr
    anchors: Anchors


class ConceptGraphAsset(StudyPackModel):
    id: NonEmptyStr
    kind: Literal["concept-graph"]
    title: NonEmptyStr
    why_spatial: NonEmptyStr
    node_ids: list[NonEmptyStr] = Field(min_length=1)


class SequenceOrderAsset(StudyPackModel):
    id: NonEmptyStr
    kind: Literal["sequence-order"]
    title: NonEmptyStr
    # sem justificativa espacial o ativo é descartado na geração (seção 3.6.3)
    why_spatial: NonEmptyStr
    # os passos são armazenados na ordem correta; o embaralhamento ocorre apenas na zona
    steps: list[SequenceStep] = Field(min_length=2)


class SsoAnnotation(StudyPackModel):
    id: NonEmptyStr
    title: NonEmptyStr
    description: NonEmptyStr
    position: tuple[float, float, float]
    page_anchor: int | None = Field(default=None, ge=1)


class SpecialStudyObjectAsset(StudyPackModel):
    id: NonEmptyStr
    kind: Literal["special-study-object"]
    title: NonEmptyStr
    why_spatial: NonEmptyStr
    model_url: NonEmptyStr
    tags: list[NonEmptyStr]
    scale: tuple[float, float, float] | None = None
    annotations: list[SsoAnnotation]


LearningAsset = Annotated[
    ConceptGraphAsset | SequenceOrderAsset | SpecialStudyObjectAsset,
    Field(discriminator="kind"),
]


class StudyPackMeta(StudyPackModel):
    generated_at: Annotated[str, AfterValidator(_require_iso_date_time)]
    prompt_version: NonEmptyStr
    model: NonEmptyStr
    discarded: int = Field(ge=0)


class StudyPack(StudyPackModel):
    schema_version: Literal["1.0"]
    pack_id: NonEmptyStr
    zone_id: NonEmptyStr
    sources: list[PackSource] = Field(min_length=1)
    concepts: list[ConceptNode]
    edges: list[ConceptEdge]
    cards: list[StudyCard]
    quiz: list[QuizItem]
    assets: list[LearningAsset]
    meta: StudyPackMeta

    @model_validator(mode="after")
    def check_integrity(self) -> "StudyPack":
        errors = collect_integrity_errors(self)
        if errors:
            raise ValueError("; ".join(errors))
        return self


class _HasId(Protocol):
    @property
    def id(self) -> str: ...


def _duplicated_ids(items: Sequence[_HasId]) -> list[str]:
    seen: set[str] = set()
    duplicated: list[str] = []
    for item in items:
        if item.id in seen:
            duplicated.append(item.id)
        seen.add(item.id)
    return duplicated


def _anchor_groups(pack: StudyPack) -> list[list[SourceAnchor]]:
    groups: list[list[SourceAnchor]] = [concept.anchors for concept in pack.concepts]
    groups += [edge.anchors for edge in pack.edges]
    groups += [card.anchors for card in pack.cards]
    groups += [item.anchors for item in pack.quiz]
    for asset in pack.assets:
        if isinstance(asset, SequenceOrderAsset):
            groups += [step.anchors for step in asset.steps]
    return groups


def _anchor_errors(pack: StudyPack) -> list[str]:
    page_counts = {source.id: source.page_count for source in pack.sources}
    errors: list[str] = []
    for anchors in _anchor_groups(pack):
        for anchor in anchors:
            if anchor.source_id not in page_counts:
                errors.append(f"unknown source {anchor.source_id!r}")
            elif anchor.page > page_counts[anchor.source_id]:
                errors.append(f"page {anchor.page} exceeds pageCount of {anchor.source_id!r}")
    return errors


def _referenced_concept_ids(pack: StudyPack) -> list[str]:
    referenced = [ref for edge in pack.edges for ref in (edge.source_id, edge.target_id)]
    referenced += [ref for card in pack.cards for ref in card.concept_ids]
    referenced += [ref for item in pack.quiz for ref in item.concept_ids]
    for asset in pack.assets:
        if isinstance(asset, ConceptGraphAsset):
            referenced += asset.node_ids
    return referenced


def collect_integrity_errors(pack: StudyPack) -> list[str]:
    """regras de integridade referencial, espelhadas em study-pack-integrity.ts."""
    errors: list[str] = []
    collections = {
        "sources": pack.sources,
        "concepts": pack.concepts,
        "cards": pack.cards,
        "quiz": pack.quiz,
        "assets": pack.assets,
    }
    collections |= {
        f"assets.{asset.id}.steps": asset.steps
        for asset in pack.assets
        if isinstance(asset, SequenceOrderAsset)
    }
    collections |= {
        f"assets.{asset.id}.annotations": asset.annotations
        for asset in pack.assets
        if isinstance(asset, SpecialStudyObjectAsset)
    }
    for name, items in collections.items():
        errors += [f"duplicated id {item_id!r} in {name}" for item_id in _duplicated_ids(items)]

    concept_ids = {concept.id for concept in pack.concepts}
    errors += [
        f"unknown concept {ref!r}"
        for ref in _referenced_concept_ids(pack)
        if ref not in concept_ids
    ]
    return errors + _anchor_errors(pack)


def parse_study_pack(raw_json: str | bytes) -> StudyPack:
    # é usado o modo json para que listas sejam aceitas como tuplas sob validação estrita
    return StudyPack.model_validate_json(raw_json)
