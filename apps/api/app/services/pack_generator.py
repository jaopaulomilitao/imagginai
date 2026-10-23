"""montagem e validação estrita do study pack após extração llm, grounding e layout 3d."""

from collections.abc import Sequence
from datetime import UTC, datetime
from uuid import uuid4

from app.core.config import (
    PACK_CONCEPTS_MAX,
    PACK_CONCEPTS_MIN,
    PACK_QUIZ_MAX,
    PACK_QUIZ_MIN,
    PACK_SEQUENCE_ASSETS_MAX,
    PACK_SEQUENCE_ASSETS_MIN,
    STUDY_PACK_SCHEMA_VERSION,
)
from app.core.db import ChunkRecord, SourceRecord
from app.prompts.study_pack_v1 import PromptChunkInput
from app.schemas.study_pack import (
    PackSource,
    SequenceOrderAsset,
    StudyPack,
    StudyPackMeta,
    parse_study_pack,
)
from app.services.embeddings import EmbeddingClient
from app.services.grounding import GroundedExtractionResult, verify_and_ground_extraction
from app.services.llm import LlmProvider


class PackValidationError(ValueError):
    """erro lançado quando o study pack montado viola o esquema ou limites de geração."""


def _utc_now_iso() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


def check_pack_generation_limits(
    grounded: GroundedExtractionResult,
    *,
    strict_counts: bool = False,
) -> None:
    """verifica se os itens aprovados pelo grounding atendem aos limites da seção 3.6.1."""
    if not grounded.concepts:
        raise PackValidationError("no grounded concepts survived verification")

    if not strict_counts:
        return

    concept_count = len(grounded.concepts)
    if not (PACK_CONCEPTS_MIN <= concept_count <= PACK_CONCEPTS_MAX):
        raise PackValidationError(
            f"concept count must be between {PACK_CONCEPTS_MIN} and {PACK_CONCEPTS_MAX}, "
            f"got {concept_count}"
        )

    quiz_count = len(grounded.quiz)
    if not (PACK_QUIZ_MIN <= quiz_count <= PACK_QUIZ_MAX):
        raise PackValidationError(
            f"quiz count must be between {PACK_QUIZ_MIN} and {PACK_QUIZ_MAX}, got {quiz_count}"
        )

    seq_count = sum(1 for asset in grounded.assets if isinstance(asset, SequenceOrderAsset))
    if not (PACK_SEQUENCE_ASSETS_MIN <= seq_count <= PACK_SEQUENCE_ASSETS_MAX):
        raise PackValidationError(
            f"sequence-order asset count must be between {PACK_SEQUENCE_ASSETS_MIN} and "
            f"{PACK_SEQUENCE_ASSETS_MAX}, got {seq_count}"
        )


def assemble_and_validate_study_pack(
    *,
    zone_id: str,
    sources: Sequence[SourceRecord],
    grounded: GroundedExtractionResult,
    prompt_version: str,
    model_used: str,
    pack_id: str | None = None,
    generated_at: str | None = None,
    strict_counts: bool = False,
) -> StudyPack:
    """monta o objeto studypack e executa a validação pydantic completa de integridade."""
    check_pack_generation_limits(grounded, strict_counts=strict_counts)
    if not sources:
        raise PackValidationError("cannot assemble study pack without at least one source")

    resolved_pack_id = pack_id or str(uuid4())
    resolved_generated_at = generated_at or _utc_now_iso()

    pack_sources = [
        PackSource(
            id=src.id,
            title=src.title,
            page_count=src.page_count,
        )
        for src in sources
    ]

    candidate = StudyPack(
        schema_version=STUDY_PACK_SCHEMA_VERSION,
        pack_id=resolved_pack_id,
        zone_id=zone_id,
        sources=pack_sources,
        concepts=grounded.concepts,
        edges=grounded.edges,
        cards=grounded.cards,
        quiz=grounded.quiz,
        assets=grounded.assets,
        meta=StudyPackMeta(
            generated_at=resolved_generated_at,
            prompt_version=prompt_version,
            model=model_used,
            discarded=grounded.discarded,
        ),
    )

    # revalida via serialização json para garantir paridade exata com o validador typescript
    try:
        raw_json = candidate.model_dump_json(by_alias=True)
        return parse_study_pack(raw_json)
    except Exception as exc:
        raise PackValidationError(f"assembled study pack failed validation: {exc}") from exc


def generate_zone_study_pack(
    *,
    zone_id: str,
    sources: Sequence[SourceRecord],
    chunks: Sequence[ChunkRecord],
    llm_provider: LlmProvider,
    embedding_client: EmbeddingClient,
    strict_counts: bool = False,
) -> StudyPack:
    """executa o fluxo completo: extração llm -> grounding -> layout 3d -> validação."""
    if not chunks:
        raise PackValidationError("cannot generate study pack without indexed chunks")

    prompt_chunks = [
        PromptChunkInput(
            chunk_id=chunk.id,
            source_id=chunk.source_id,
            page=chunk.page,
            content=chunk.content,
        )
        for chunk in chunks
    ]

    llm_result = llm_provider.extract_study_pack(prompt_chunks)
    grounded = verify_and_ground_extraction(
        llm_result.extraction,
        chunks,
        embedding_client,
    )

    return assemble_and_validate_study_pack(
        zone_id=zone_id,
        sources=sources,
        grounded=grounded,
        prompt_version=llm_result.prompt_version,
        model_used=llm_result.model_used,
        strict_counts=strict_counts,
    )
