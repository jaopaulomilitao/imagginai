"""testes unitários e de integração da fase 7 (llm, backoff, grounding, layout 3d e pack)."""

import time
from collections.abc import Sequence

import jwt
import pymupdf
import pytest
from fastapi.testclient import TestClient

from app.core.config import EMBEDDING_DIMENSION, Settings
from app.core.db import ChunkRecord, InMemoryStore, SourceRecord
from app.main import create_app
from app.prompts.study_pack_v1 import (
    PROMPT_VERSION,
    ExtractedAnchor,
    ExtractedAsset,
    ExtractedCard,
    ExtractedConcept,
    ExtractedEdge,
    ExtractedQuizItem,
    ExtractedSequenceStep,
    PromptChunkInput,
    RawStudyPackExtraction,
)
from app.services.grounding import verify_and_ground_extraction
from app.services.layout import compute_concept_positions
from app.services.llm import (
    LlmExtractionResult,
    LlmGenerationError,
    LlmTransientError,
    ProviderName,
    ResilientLlmProvider,
)
from app.services.pack_generator import (
    PackValidationError,
    assemble_and_validate_study_pack,
    generate_zone_study_pack,
)

TEST_JWT_SECRET = "test-supabase-jwt-secret-with-at-least-32-bytes"
USER_ID = "11111111-1111-1111-1111-111111111111"


def _auth_headers(user_id: str = USER_ID) -> dict[str, str]:
    token = jwt.encode(
        {
            "sub": user_id,
            "aud": "authenticated",
            "role": "authenticated",
            "exp": int(time.time()) + 3600,
        },
        TEST_JWT_SECRET,
        algorithm="HS256",
    )
    return {"Authorization": f"Bearer {token}"}


def _unit_vec(axis: int) -> list[float]:
    # cria um vetor canônico de 768 dimensões com 1.0 na posição axis e 0.0 nas demais
    vec = [0.0] * EMBEDDING_DIMENSION
    vec[axis % EMBEDDING_DIMENSION] = 1.0
    return vec


class ControlledEmbeddingClient:
    """cliente de embeddings de teste que retorna direção alinhada ou ortogonal conforme o texto."""

    def embed_texts(self, texts: Sequence[str]) -> list[list[float]]:
        vectors: list[list[float]] = []
        for text in texts:
            if "alucinado" in text.lower() or "sem suporte" in text.lower():
                # direção ortogonal ao chunk 0 -> similaridade de cosseno = 0.0 (< 0.70)
                vectors.append(_unit_vec(1))
            else:
                # direção idêntica ao chunk 0 -> similaridade de cosseno = 1.0 (>= 0.70)
                vectors.append(_unit_vec(0))
        return vectors


def _sample_raw_extraction(
    source_id: str = "src-1",
    chunk_id: str = "chunk-1",
) -> RawStudyPackExtraction:
    valid_anchor = ExtractedAnchor(source_id=source_id, page=1, chunk_id=chunk_id)
    missing_anchor = ExtractedAnchor(source_id=source_id, page=1, chunk_id="chunk-inexistente")

    return RawStudyPackExtraction(
        concepts=[
            ExtractedConcept(
                id="c-nodo-sa",
                label="Nodo sinoatrial",
                definition="Marcapasso natural localizado no átrio direito.",
                anchors=[valid_anchor],
            ),
            ExtractedConcept(
                id="c-purkinje",
                label="Fibras de Purkinje",
                definition="Conduzem rapidamente o estímulo elétrico aos ventrículos.",
                anchors=[valid_anchor],
            ),
            ExtractedConcept(
                id="c-missing-chunk",
                label="Conceito órfão",
                definition="Cita um chunk que não existe no banco.",
                anchors=[missing_anchor],
            ),
            ExtractedConcept(
                id="c-low-sim",
                label="Conceito alucinado",
                definition="Texto sem suporte semântico no trecho citado.",
                anchors=[valid_anchor],
            ),
        ],
        edges=[
            ExtractedEdge(
                source_id="c-nodo-sa",
                target_id="c-purkinje",
                relation="propaga impulso elétrico até",
                anchors=[valid_anchor],
            ),
            ExtractedEdge(
                source_id="c-nodo-sa",
                target_id="c-low-sim",
                relation="aresta para conceito descartado",
                anchors=[valid_anchor],
            ),
        ],
        cards=[
            ExtractedCard(
                id="card-1",
                title="Condução elétrica cardíaca",
                body="O impulso nasce no nodo sinoatrial e percorre o miocárdio.",
                concept_ids=["c-nodo-sa", "c-purkinje"],
                anchors=[valid_anchor],
            ),
            ExtractedCard(
                id="card-hallucinated",
                title="Cartão alucinado",
                body="Conteúdo sem suporte algum na fonte original.",
                concept_ids=["c-nodo-sa"],
                anchors=[valid_anchor],
            ),
        ],
        quiz=[
            ExtractedQuizItem(
                id="quiz-1",
                prompt="Onde se inicia o impulso elétrico cardíaco normal?",
                options=[
                    "No nodo sinoatrial",
                    "Na valva mitral",
                    "No pericárdio seroso",
                    "Na veia pulmonar",
                ],
                correct_index=0,
                explanation="O nodo sinoatrial atua como marcapasso primário.",
                concept_ids=["c-nodo-sa"],
                anchors=[valid_anchor],
            ),
        ],
        assets=[
            ExtractedAsset(
                id="asset-graph-1",
                kind="concept-graph",
                title="Rede de condução cardíaca",
                why_spatial="Permite visualizar a topologia tridimensional entre estruturas.",
                node_ids=["c-nodo-sa", "c-purkinje"],
            ),
            ExtractedAsset(
                id="asset-seq-1",
                kind="sequence-order",
                title="Ordem de ativação elétrica",
                why_spatial="A disposição em arco espacial reforça a sequência temporal.",
                steps=[
                    ExtractedSequenceStep(
                        id="step-1",
                        text="Despolarização do nodo sinoatrial no átrio direito.",
                        anchors=[valid_anchor],
                    ),
                    ExtractedSequenceStep(
                        id="step-2",
                        text="Ativação ventricular pelas fibras de Purkinje.",
                        anchors=[valid_anchor],
                    ),
                ],
            ),
            ExtractedAsset(
                id="asset-seq-no-why",
                kind="sequence-order",
                title="Sequência sem justificativa espacial",
                why_spatial="   ",
                steps=[
                    ExtractedSequenceStep(
                        id="step-a",
                        text="Primeiro passo fundamentado no texto.",
                        anchors=[valid_anchor],
                    ),
                    ExtractedSequenceStep(
                        id="step-b",
                        text="Segundo passo fundamentado no texto.",
                        anchors=[valid_anchor],
                    ),
                ],
            ),
        ],
    )


def test_grounding_drops_missing_chunk_ids_low_similarity_and_converts_empty_why_spatial() -> None:
    chunks = [
        ChunkRecord(
            id="chunk-1",
            user_id=USER_ID,
            zone_id="zone-1",
            source_id="src-1",
            page=1,
            chunk_index=0,
            content="O nodo sinoatrial e as fibras de Purkinje conduzem o impulso cardíaco.",
            token_count=12,
            embedding=_unit_vec(0),
        )
    ]
    raw = _sample_raw_extraction("src-1", "chunk-1")
    grounded = verify_and_ground_extraction(raw, chunks, ControlledEmbeddingClient())

    # restam apenas os 2 conceitos fundamentados; os outros 2 são descartados
    assert [c.id for c in grounded.concepts] == ["c-nodo-sa", "c-purkinje"]
    assert len(grounded.edges) == 1
    assert grounded.edges[0].source_id == "c-nodo-sa"
    assert grounded.edges[0].target_id == "c-purkinje"

    # card-1 permanece + 1 cartão gerado pela conversão de asset-seq-no-why (seção 3.6.3)
    card_ids = [c.id for c in grounded.cards]
    assert "card-1" in card_ids
    assert "card-from-asset-seq-no-why" in card_ids
    assert "card-hallucinated" not in card_ids

    # apenas 2 ativos permanecem (concept-graph e sequence-order com whySpatial preenchido)
    assert [a.id for a in grounded.assets] == ["asset-graph-1", "asset-seq-1"]

    # total de descartes: 2 conceitos + 1 aresta + 1 cartão + 1 ativo sem whySpatial = 5
    assert grounded.discarded == 5


def test_networkx_3d_layout_is_deterministic_and_normalized() -> None:
    concept_ids = ["c1", "c2", "c3", "c4"]
    edges = [("c1", "c2"), ("c2", "c3"), ("c3", "c4"), ("c4", "c1")]

    first = compute_concept_positions(concept_ids, edges)
    second = compute_concept_positions(concept_ids, edges)
    assert first == second

    for coords in first.values():
        assert len(coords) == 3
        for value in coords:
            assert -1.0 <= value <= 1.0


def test_llm_provider_retries_on_429_and_falls_back_to_groq() -> None:
    calls: list[str] = []
    sleeps: list[float] = []

    class FailingGeminiAdapter:
        model_name = "gemini-2.5-flash"
        provider_name: ProviderName = "gemini"

        def generate_extraction(
            self,
            system_prompt: str,
            user_prompt: str,
        ) -> RawStudyPackExtraction:
            calls.append("gemini")
            raise LlmTransientError("HTTP 429 RESOURCE_EXHAUSTED", status_code=429)

    class WorkingGroqAdapter:
        model_name = "llama-3.3-70b-versatile"
        provider_name: ProviderName = "groq"

        def generate_extraction(
            self,
            system_prompt: str,
            user_prompt: str,
        ) -> RawStudyPackExtraction:
            calls.append("groq")
            return _sample_raw_extraction()

    provider = ResilientLlmProvider(
        primary=FailingGeminiAdapter(),
        fallback=WorkingGroqAdapter(),
        max_retries=3,
        initial_backoff_seconds=0.5,
        sleep_fn=sleeps.append,
    )

    result = provider.extract_study_pack(
        [PromptChunkInput(chunk_id="chunk-1", source_id="src-1", page=1, content="texto")]
    )

    assert calls == ["gemini", "gemini", "gemini", "groq"]
    assert sleeps == [0.5, 1.0]
    assert result.provider_used == "groq"
    assert result.model_used == "llama-3.3-70b-versatile"
    assert result.prompt_version == PROMPT_VERSION


def test_llm_provider_raises_readable_error_when_both_providers_fail() -> None:
    class FailingAdapter:
        def __init__(self, provider: ProviderName, model: str) -> None:
            self.provider_name: ProviderName = provider
            self.model_name = model

        def generate_extraction(
            self,
            system_prompt: str,
            user_prompt: str,
        ) -> RawStudyPackExtraction:
            raise LlmTransientError("503 service unavailable", status_code=503)

    provider = ResilientLlmProvider(
        primary=FailingAdapter("gemini", "gemini-2.5-flash"),
        fallback=FailingAdapter("groq", "llama-3.3-70b-versatile"),
        max_retries=2,
        initial_backoff_seconds=0.0,
        sleep_fn=lambda _: None,
    )

    with pytest.raises(LlmGenerationError) as exc_info:
        provider.extract_study_pack(
            [PromptChunkInput(chunk_id="chunk-1", source_id="src-1", page=1, content="texto")]
        )
    assert "primário" in str(exc_info.value)
    assert "reserva" in str(exc_info.value)


def test_invalid_pack_is_rejected_by_assembler() -> None:
    chunks = [
        ChunkRecord(
            id="chunk-1",
            user_id=USER_ID,
            zone_id="zone-1",
            source_id="src-1",
            page=1,
            chunk_index=0,
            content="Texto base.",
            token_count=2,
            embedding=_unit_vec(0),
        )
    ]
    sources = [
        SourceRecord(
            id="src-1",
            user_id=USER_ID,
            zone_id="zone-1",
            title="Fonte 1",
            storage_path="u/z/src-1.pdf",
            page_count=1,
            size_bytes=100,
            created_at="2026-10-22T00:00:00Z",
        )
    ]

    # extração onde todos os conceitos são descartados deve ser rejeitada
    empty_grounded = verify_and_ground_extraction(
        RawStudyPackExtraction(concepts=[]),
        chunks,
        ControlledEmbeddingClient(),
    )
    with pytest.raises(PackValidationError):
        assemble_and_validate_study_pack(
            zone_id="zone-1",
            sources=sources,
            grounded=empty_grounded,
            prompt_version=PROMPT_VERSION,
            model_used="gemini-2.5-flash",
        )

    # quando strict_counts=True, menos de 15 conceitos deve falhar na validação de limites
    partial_grounded = verify_and_ground_extraction(
        _sample_raw_extraction("src-1", "chunk-1"),
        chunks,
        ControlledEmbeddingClient(),
    )
    with pytest.raises(PackValidationError) as limit_err:
        assemble_and_validate_study_pack(
            zone_id="zone-1",
            sources=sources,
            grounded=partial_grounded,
            prompt_version=PROMPT_VERSION,
            model_used="gemini-2.5-flash",
            strict_counts=True,
        )
    assert "concept count" in str(limit_err.value)


def test_end_to_end_pack_generation_and_get_zone_pack_endpoint() -> None:
    store = InMemoryStore()
    embedding_client = ControlledEmbeddingClient()

    class MockLlmProvider:
        def extract_study_pack(
            self,
            chunks: Sequence[PromptChunkInput],
        ) -> LlmExtractionResult:
            first_chunk = chunks[0]
            return LlmExtractionResult(
                extraction=_sample_raw_extraction(first_chunk.source_id, first_chunk.chunk_id),
                model_used="gemini-2.5-flash",
                provider_used="gemini",
                prompt_version=PROMPT_VERSION,
            )

    settings = Settings(
        _env_file=None,
        supabase_url="https://mock.supabase.co",
        supabase_service_role_key="mock-service-role",
        supabase_jwt_secret=TEST_JWT_SECRET,
    )
    app = create_app(
        settings,
        db_store=store,
        embedding_client=embedding_client,
        llm_provider=MockLlmProvider(),
    )
    client = TestClient(app)

    zone_res = client.post(
        "/zones",
        json={"name": "Zona Eletrofisiologia", "environment": "focus-dark"},
        headers=_auth_headers(),
    )
    assert zone_res.status_code == 201
    zone_id = zone_res.json()["id"]

    # antes do upload, GET /zones/{id}/pack retorna 404
    missing_pack_res = client.get(f"/zones/{zone_id}/pack", headers=_auth_headers())
    assert missing_pack_res.status_code == 404

    doc = pymupdf.open()
    page = doc.new_page()
    page.insert_text(
        (72, 72),
        "O nodo sinoatrial e as fibras de Purkinje conduzem o impulso elétrico cardíaco.",
    )
    pdf_bytes = doc.tobytes()
    doc.close()

    upload_res = client.post(
        f"/zones/{zone_id}/sources",
        files={"file": ("eletrofisiologia.pdf", pdf_bytes, "application/pdf")},
        headers=_auth_headers(),
    )
    assert upload_res.status_code == 202
    job_id = upload_res.json()["jobId"]

    job_res = client.get(f"/jobs/{job_id}", headers=_auth_headers())
    assert job_res.json()["status"] == "done"

    pack_res = client.get(f"/zones/{zone_id}/pack", headers=_auth_headers())
    assert pack_res.status_code == 200
    pack_json = pack_res.json()
    assert pack_json["schemaVersion"] == "1.0"
    assert pack_json["zoneId"] == zone_id
    assert len(pack_json["concepts"]) == 2
    assert pack_json["meta"]["promptVersion"] == PROMPT_VERSION
    assert pack_json["meta"]["model"] == "gemini-2.5-flash"
    assert pack_json["meta"]["discarded"] == 5

    # verifica também que generate_zone_study_pack retorna instância StudyPack válida
    direct_pack = generate_zone_study_pack(
        zone_id=zone_id,
        sources=store.list_sources_for_zone(USER_ID, zone_id),
        chunks=store.list_chunks_for_zone(USER_ID, zone_id),
        llm_provider=MockLlmProvider(),
        embedding_client=embedding_client,
    )
    assert direct_pack.zone_id == zone_id
