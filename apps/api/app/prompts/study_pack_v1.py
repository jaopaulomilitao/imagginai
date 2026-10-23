"""prompt versionado v1.0.0 e esquema de extração estruturada para geração do study pack."""

from collections.abc import Sequence
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

from app.core.config import (
    PACK_CONCEPTS_MAX,
    PACK_CONCEPTS_MIN,
    PACK_QUIZ_MAX,
    PACK_QUIZ_MIN,
    PACK_SEQUENCE_ASSETS_MAX,
    PACK_SEQUENCE_ASSETS_MIN,
)

PROMPT_VERSION = "1.0.0"


class PromptChunkInput(BaseModel):
    """representa um trecho de estudo anônimo enviado ao modelo de linguagem."""

    chunk_id: str
    source_id: str
    page: int
    content: str


class ExtractedAnchor(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        validate_by_name=True,
        validate_by_alias=True,
        serialize_by_alias=True,
    )

    source_id: str
    page: int
    chunk_id: str


class ExtractedConcept(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        validate_by_name=True,
        validate_by_alias=True,
        serialize_by_alias=True,
    )

    id: str
    label: str
    definition: str
    anchors: list[ExtractedAnchor] = Field(default_factory=list)


class ExtractedEdge(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        validate_by_name=True,
        validate_by_alias=True,
        serialize_by_alias=True,
    )

    source_id: str
    target_id: str
    relation: str
    anchors: list[ExtractedAnchor] = Field(default_factory=list)


class ExtractedCard(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        validate_by_name=True,
        validate_by_alias=True,
        serialize_by_alias=True,
    )

    id: str
    title: str
    body: str
    concept_ids: list[str] = Field(default_factory=list)
    anchors: list[ExtractedAnchor] = Field(default_factory=list)


class ExtractedQuizItem(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        validate_by_name=True,
        validate_by_alias=True,
        serialize_by_alias=True,
    )

    id: str
    prompt: str
    options: list[str] = Field(default_factory=list)
    correct_index: int
    explanation: str
    concept_ids: list[str] = Field(default_factory=list)
    anchors: list[ExtractedAnchor] = Field(default_factory=list)


class ExtractedSequenceStep(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        validate_by_name=True,
        validate_by_alias=True,
        serialize_by_alias=True,
    )

    id: str
    text: str
    anchors: list[ExtractedAnchor] = Field(default_factory=list)


class ExtractedAsset(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        validate_by_name=True,
        validate_by_alias=True,
        serialize_by_alias=True,
    )

    id: str
    kind: Literal["concept-graph", "sequence-order"]
    title: str
    why_spatial: str = ""
    node_ids: list[str] = Field(default_factory=list)
    steps: list[ExtractedSequenceStep] = Field(default_factory=list)


class RawStudyPackExtraction(BaseModel):
    """esquema intermediário retornado pelo llm antes do filtro de grounding e layout 3d."""

    model_config = ConfigDict(
        alias_generator=to_camel,
        validate_by_name=True,
        validate_by_alias=True,
        serialize_by_alias=True,
    )

    concepts: list[ExtractedConcept] = Field(default_factory=list)
    edges: list[ExtractedEdge] = Field(default_factory=list)
    cards: list[ExtractedCard] = Field(default_factory=list)
    quiz: list[ExtractedQuizItem] = Field(default_factory=list)
    assets: list[ExtractedAsset] = Field(default_factory=list)


MAX_PROMPT_CHUNKS = 10
MAX_PROMPT_CHUNK_CHARS = 900

SYSTEM_PROMPT = (
    "Você é um extrator pedagógico de conhecimento para ambientes espaciais 3D em português "
    "(pt-BR). Extraia exclusivamente informações fundamentadas nos trechos fornecidos, "
    "citando exatamente os identificadores sourceId, page e chunkId de cada trecho utilizado e "
    "preservando a terminologia literal do texto para alta fidelidade semântica.\n"
    f"Extraia entre 20 e {PACK_CONCEPTS_MAX} conceitos (mínimo absoluto {PACK_CONCEPTS_MIN}, "
    "label <= 40 caracteres, definition <= 280 caracteres), entre 16 e 25 arestas direcionadas "
    "entre conceitos, entre 10 e 16 cartões de estudo detalhados, "
    f"entre 10 e {PACK_QUIZ_MAX} questões de múltipla escolha (mínimo absoluto {PACK_QUIZ_MIN}, "
    "exatamente 4 opções e correctIndex de 0 a 3), 1 ativo 'concept-graph' e "
    f"{PACK_SEQUENCE_ASSETS_MAX} ativos 'sequence-order' (mínimo {PACK_SEQUENCE_ASSETS_MIN}) "
    "com whySpatial preenchido.\n"
    "Responda estritamente com um objeto JSON seguindo exatamente estas chaves:\n"
    '{"concepts":[{"id":"c-1","label":"...","definition":"...",'
    '"anchors":[{"sourceId":"...","page":1,"chunkId":"..."}]}],'
    '"edges":[{"sourceId":"c-1","targetId":"c-2","relation":"...",'
    '"anchors":[{"sourceId":"...","page":1,"chunkId":"..."}]}],'
    '"cards":[{"id":"card-1","title":"...","body":"...","conceptIds":["c-1"],'
    '"anchors":[{"sourceId":"...","page":1,"chunkId":"..."}]}],'
    '"quiz":[{"id":"q-1","prompt":"...","options":["A","B","C","D"],"correctIndex":0,'
    '"explanation":"...","conceptIds":["c-1"],'
    '"anchors":[{"sourceId":"...","page":1,"chunkId":"..."}]}],'
    '"assets":[{"id":"asset-graph","kind":"concept-graph","title":"...","whySpatial":"...",'
    '"nodeIds":["c-1","c-2"],"steps":[]},'
    '{"id":"asset-seq-1","kind":"sequence-order","title":"...","whySpatial":"...",'
    '"nodeIds":[],"steps":[{"id":"s-1","text":"...",'
    '"anchors":[{"sourceId":"...","page":1,"chunkId":"..."}]},'
    '{"id":"s-2","text":"...","anchors":[{"sourceId":"...","page":1,"chunkId":"..."}]}]}]}'
)


def _select_representative_chunks(chunks: Sequence[PromptChunkInput]) -> list[PromptChunkInput]:
    # seleciona até max_prompt_chunks trechos distribuídos pelo documento para respeitar tpm
    if len(chunks) <= MAX_PROMPT_CHUNKS:
        return list(chunks)
    rich = [c for c in chunks if len(c.content.split()) >= 35]
    pool = rich if len(rich) >= MAX_PROMPT_CHUNKS else list(chunks)
    if len(pool) <= MAX_PROMPT_CHUNKS:
        return pool
    step = (len(pool) - 1) / float(MAX_PROMPT_CHUNKS - 1)
    selected: list[PromptChunkInput] = []
    seen_ids: set[str] = set()
    for idx in range(MAX_PROMPT_CHUNKS):
        candidate = pool[round(idx * step)]
        if candidate.chunk_id not in seen_ids:
            seen_ids.add(candidate.chunk_id)
            selected.append(candidate)
    return selected


def build_extraction_user_prompt(chunks: Sequence[PromptChunkInput]) -> str:
    """monta o prompt do usuário contendo apenas o texto de estudo e metadados de página."""
    selected = _select_representative_chunks(chunks)
    lines = [
        "Trechos indexados do material de estudo (cite apenas chunkId, sourceId e page abaixo):",
        "",
    ]
    for item in selected:
        snippet = item.content[:MAX_PROMPT_CHUNK_CHARS]
        lines.append(
            f"[chunkId={item.chunk_id} | sourceId={item.source_id} | page={item.page}]\n{snippet}\n"
        )
    return "\n".join(lines)
