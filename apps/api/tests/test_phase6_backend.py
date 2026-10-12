"""testes unitários e de integração da fase 6 com provedores externos simulados."""

import math
import time
from types import SimpleNamespace

import jwt
import pymupdf
import pytest
from fastapi.testclient import TestClient

from app.core.config import (
    CHUNK_OVERLAP_TOKENS,
    CHUNK_TARGET_TOKENS,
    EMBEDDING_DIMENSION,
    SOURCE_MAX_PAGES,
    SOURCE_MAX_SIZE_BYTES,
    Settings,
)
from app.core.db import InMemoryStore, JobRecord
from app.main import create_app
from app.schemas.jobs import JobStatus
from app.services.embeddings import (
    DeterministicFakeEmbeddingClient,
    EmbeddingError,
    GeminiEmbeddingClient,
)
from app.services.ingestion import (
    ExtractedPage,
    PdfExtractionResult,
    chunk_extracted_pages,
    extract_pdf_pages,
)
from app.services.jobs import create_ingestion_job, run_source_ingestion_job

TEST_JWT_SECRET = "test-supabase-jwt-secret-with-at-least-32-bytes"
USER_A_ID = "11111111-1111-1111-1111-111111111111"
USER_B_ID = "22222222-2222-2222-2222-222222222222"


def _make_jwt(
    user_id: str = USER_A_ID,
    *,
    secret: str = TEST_JWT_SECRET,
    exp_offset_seconds: int = 3600,
    audience: str = "authenticated",
) -> str:
    payload = {
        "sub": user_id,
        "aud": audience,
        "role": "authenticated",
        "email": f"{user_id[:8]}@imagginai.test",
        "exp": int(time.time()) + exp_offset_seconds,
    }
    return jwt.encode(payload, secret, algorithm="HS256")


def _auth_headers(user_id: str = USER_A_ID) -> dict[str, str]:
    return {"Authorization": f"Bearer {_make_jwt(user_id)}"}


def _build_pdf_bytes(page_texts: list[str]) -> bytes:
    # gera um pdf real em memória via pymupdf para exercitar a extração por página
    doc = pymupdf.open()
    for text in page_texts:
        page = doc.new_page()
        if text:
            page.insert_text((72, 72), text)
    pdf_bytes = doc.tobytes()
    doc.close()
    return pdf_bytes


@pytest.fixture
def phase6_store() -> InMemoryStore:
    return InMemoryStore()


@pytest.fixture
def phase6_client(phase6_store: InMemoryStore) -> TestClient:
    settings = Settings(
        _env_file=None,
        supabase_url="https://mock.supabase.co",
        supabase_service_role_key="mock-service-role",
        supabase_jwt_secret=TEST_JWT_SECRET,
        gemini_api_key="mock-gemini-key",
        embedding_model="gemini-embedding-001",
    )
    app = create_app(
        settings,
        db_store=phase6_store,
        embedding_client=DeterministicFakeEmbeddingClient(),
    )
    return TestClient(app)


def test_jwt_auth_rejects_missing_expired_and_invalid_tokens(
    phase6_client: TestClient,
) -> None:
    no_header = phase6_client.get("/zones")
    assert no_header.status_code == 401

    bad_format = phase6_client.get("/zones", headers={"Authorization": "Token abc"})
    assert bad_format.status_code == 401

    expired = _make_jwt(exp_offset_seconds=-60)
    expired_res = phase6_client.get("/zones", headers={"Authorization": f"Bearer {expired}"})
    assert expired_res.status_code == 401
    assert "expired" in expired_res.json()["detail"]

    wrong_secret = _make_jwt(secret="wrong-secret-key-with-32-bytes-minimum!!")
    wrong_res = phase6_client.get("/zones", headers={"Authorization": f"Bearer {wrong_secret}"})
    assert wrong_res.status_code == 401

    wrong_aud = _make_jwt(audience="anon")
    aud_res = phase6_client.get("/zones", headers={"Authorization": f"Bearer {wrong_aud}"})
    assert aud_res.status_code == 401


def test_zones_crud_and_user_isolation(phase6_client: TestClient) -> None:
    create_res = phase6_client.post(
        "/zones",
        json={"name": "Fisiologia Cardiovascular", "environment": "focus-dark"},
        headers=_auth_headers(USER_A_ID),
    )
    assert create_res.status_code == 201
    zone = create_res.json()
    zone_id = zone["id"]
    assert zone["name"] == "Fisiologia Cardiovascular"
    assert zone["environment"] == "focus-dark"
    assert zone["sourceIds"] == []
    assert zone["layout"] == []

    # outro usuário não visualiza nem altera a zona criada pelo usuário a
    list_b = phase6_client.get("/zones", headers=_auth_headers(USER_B_ID))
    assert list_b.status_code == 200
    assert list_b.json() == []

    patch_b = phase6_client.patch(
        f"/zones/{zone_id}",
        json={"name": "Invasão"},
        headers=_auth_headers(USER_B_ID),
    )
    assert patch_b.status_code == 404

    patch_a = phase6_client.patch(
        f"/zones/{zone_id}",
        json={
            "name": "Cardiologia Avançada",
            "environment": "focus-nature",
            "layout": [
                {"panelId": "panel-pdf-1", "yawDeg": 0, "pitchDeg": 10, "radiusM": 0.55},
                {"panelId": "panel-card-1", "yawDeg": -150, "pitchDeg": -10, "radiusM": 1.5},
            ],
        },
        headers=_auth_headers(USER_A_ID),
    )
    assert patch_a.status_code == 200
    updated = patch_a.json()
    assert updated["name"] == "Cardiologia Avançada"
    assert updated["environment"] == "focus-nature"
    assert len(updated["layout"]) == 2
    assert updated["layout"][0]["radiusM"] == 0.55

    delete_a = phase6_client.delete(f"/zones/{zone_id}", headers=_auth_headers(USER_A_ID))
    assert delete_a.status_code == 200
    assert delete_a.json() == {"id": zone_id, "deleted": True}

    list_after = phase6_client.get("/zones", headers=_auth_headers(USER_A_ID))
    assert list_after.json() == []


def test_chunking_preserves_page_numbers_and_overlap() -> None:
    page_1_words = [f"p1w{i}" for i in range(620)]
    page_2_words = [f"p2w{i}" for i in range(210)]
    pages = [
        ExtractedPage(page=1, text=" ".join(page_1_words)),
        ExtractedPage(page=2, text=" ".join(page_2_words)),
    ]

    counter = 0

    def next_id() -> str:
        nonlocal counter
        counter += 1
        return f"chunk-{counter}"

    chunks = chunk_extracted_pages(
        pages,
        "source-1",
        target_tokens=CHUNK_TARGET_TOKENS,
        overlap_tokens=CHUNK_OVERLAP_TOKENS,
        id_factory=next_id,
    )

    # página 1 gera 2 trechos (500 + 170 com 50 de sobreposição) e página 2 gera 1 trecho
    assert len(chunks) == 3
    assert [c.page for c in chunks] == [1, 1, 2]
    assert [c.chunk_index for c in chunks] == [0, 1, 2]
    assert chunks[0].token_count == 500
    assert chunks[1].token_count == 170
    assert chunks[2].token_count == 210

    # verifica que os últimos 50 tokens do primeiro trecho coincidem com os primeiros 50 do segundo
    first_tokens = chunks[0].content.split()
    second_tokens = chunks[1].content.split()
    assert first_tokens[-CHUNK_OVERLAP_TOKENS:] == second_tokens[:CHUNK_OVERLAP_TOKENS]

    # garante que nenhuma palavra da página 2 vazou para os trechos da página 1
    assert all(w.startswith("p1w") for w in first_tokens)
    assert all(w.startswith("p1w") for w in second_tokens)
    assert all(w.startswith("p2w") for w in chunks[2].content.split())

    for chunk in chunks:
        assert chunk.anchor.source_id == "source-1"
        assert chunk.anchor.page == chunk.page
        assert chunk.anchor.chunk_id == chunk.chunk_id


def test_pymupdf_extracts_multi_page_pdf_and_enforces_limits() -> None:
    pdf_bytes = _build_pdf_bytes(
        [
            "Ventrículo esquerdo bombeia sangue arterial para a aorta.",
            "Átrio direito recebe sangue venoso pelas veias cavas.",
        ]
    )
    result = extract_pdf_pages(pdf_bytes)
    assert result.page_count == 2
    assert result.pages[0].page == 1
    assert "Ventrículo esquerdo" in result.pages[0].text
    assert result.pages[1].page == 2
    assert "Átrio direito" in result.pages[1].text


def test_pdf_upload_rejects_oversized_and_excessive_page_pdfs(
    phase6_client: TestClient,
) -> None:
    zone_res = phase6_client.post(
        "/zones",
        json={"name": "Zona Limites", "environment": "focus-dark"},
        headers=_auth_headers(USER_A_ID),
    )
    zone_id = zone_res.json()["id"]

    # arquivo vazio -> 400
    empty_res = phase6_client.post(
        f"/zones/{zone_id}/sources",
        files={"file": ("vazio.pdf", b"", "application/pdf")},
        headers=_auth_headers(USER_A_ID),
    )
    assert empty_res.status_code == 400

    # arquivo acima de 20 mb -> 413
    oversized = b"%PDF-1.4\n" + (b"0" * SOURCE_MAX_SIZE_BYTES)
    oversized_res = phase6_client.post(
        f"/zones/{zone_id}/sources",
        files={"file": ("grande.pdf", oversized, "application/pdf")},
        headers=_auth_headers(USER_A_ID),
    )
    assert oversized_res.status_code == 413

    # pdf com 61 páginas (acima do limite de 60) -> 400
    too_many_pages_pdf = _build_pdf_bytes([f"Página {i}" for i in range(SOURCE_MAX_PAGES + 1)])
    pages_res = phase6_client.post(
        f"/zones/{zone_id}/sources",
        files={"file": ("longo.pdf", too_many_pages_pdf, "application/pdf")},
        headers=_auth_headers(USER_A_ID),
    )
    assert pages_res.status_code == 400
    assert str(SOURCE_MAX_PAGES) in pages_res.json()["detail"]


def test_gemini_embedding_client_enforces_768_dimensions_and_normalizes() -> None:
    captured_calls: list[dict[str, object]] = []

    class FakeModels:
        def embed_content(self, *, model: str, contents: list[str], config: object) -> object:
            captured_calls.append({"model": model, "contents": contents, "config": config})
            embeddings = [
                SimpleNamespace(values=[float(i + 1) for i in range(EMBEDDING_DIMENSION)])
                for _ in contents
            ]
            return SimpleNamespace(embeddings=embeddings)

    fake_sdk_client = SimpleNamespace(models=FakeModels())
    client = GeminiEmbeddingClient(
        api_key="fake-key",
        model="gemini-embedding-001",
        client=fake_sdk_client,
        batch_size=2,
    )

    vectors = client.embed_texts(["conceito 1", "conceito 2", "conceito 3"])
    assert len(vectors) == 3
    assert len(captured_calls) == 2
    for vec in vectors:
        assert len(vec) == EMBEDDING_DIMENSION
        norm = math.sqrt(sum(v * v for v in vec))
        assert math.isclose(norm, 1.0, rel_tol=1e-6)

    # verifica rejeição quando o provedor retorna dimensão diferente de 768
    class WrongDimModels:
        def embed_content(self, **_kwargs: object) -> object:
            return SimpleNamespace(embeddings=[SimpleNamespace(values=[1.0, 2.0, 3.0])])

    bad_client = GeminiEmbeddingClient(
        api_key="fake-key",
        model="gemini-embedding-001",
        client=SimpleNamespace(models=WrongDimModels()),
    )
    with pytest.raises(EmbeddingError):
        bad_client.embed_texts(["texto"])


def test_job_state_transitions_and_end_to_end_pdf_upload(
    phase6_client: TestClient,
    phase6_store: InMemoryStore,
) -> None:
    recorded_statuses: list[tuple[JobStatus, int]] = []
    original_update_job = phase6_store.update_job

    def spy_update_job(
        job_id: str,
        *,
        status: JobStatus | None = None,
        progress: int | None = None,
        message: str | None = None,
    ) -> JobRecord:
        updated = original_update_job(
            job_id,
            status=status,
            progress=progress,
            message=message,
        )
        recorded_statuses.append((updated.status, updated.progress))
        return updated

    phase6_store.update_job = spy_update_job  # type: ignore[method-assign]

    zone_res = phase6_client.post(
        "/zones",
        json={"name": "Anatomia Cardíaca", "environment": "focus-dark"},
        headers=_auth_headers(USER_A_ID),
    )
    zone_id = zone_res.json()["id"]

    pdf_bytes = _build_pdf_bytes(
        [
            "O nodo sinoatrial inicia o impulso elétrico cardíaco no átrio direito.",
            "As fibras de Purkinje conduzem rapidamente o potencial de ação ventricular.",
        ]
    )

    upload_res = phase6_client.post(
        f"/zones/{zone_id}/sources",
        files={"file": ("anatomia-cardiaca.pdf", pdf_bytes, "application/pdf")},
        headers=_auth_headers(USER_A_ID),
    )
    assert upload_res.status_code == 202
    upload_data = upload_res.json()
    job_id = upload_data["jobId"]
    source_id = upload_data["sourceId"]
    assert upload_data["title"] == "anatomia-cardiaca"
    assert upload_data["pageCount"] == 2

    # verifica transições intermediárias (running 20 -> 60 -> 85) até done (100)
    assert recorded_statuses == [
        ("running", 20),
        ("running", 60),
        ("running", 85),
        ("done", 100),
    ]

    job_res = phase6_client.get(f"/jobs/{job_id}", headers=_auth_headers(USER_A_ID))
    assert job_res.status_code == 200
    assert job_res.json()["status"] == "done"
    assert job_res.json()["progress"] == 100

    # verifica os trechos indexados com vetores de 768 dimensões e páginas preservadas
    chunks = phase6_store.list_chunks_for_zone(USER_A_ID, zone_id)
    assert len(chunks) == 2
    assert [c.page for c in chunks] == [1, 2]
    assert all(c.source_id == source_id for c in chunks)
    assert all(len(c.embedding) == EMBEDDING_DIMENSION for c in chunks)


def test_job_transitions_to_failed_when_pdf_has_no_extractable_text() -> None:
    store = InMemoryStore()
    zone = store.create_zone(USER_A_ID, "Zona Sem Texto", "focus-dark")
    job = create_ingestion_job(store, USER_A_ID, zone.id)
    assert job.status == "queued"
    assert job.progress == 0

    blank_extraction = PdfExtractionResult(
        page_count=1,
        size_bytes=128,
        pages=[ExtractedPage(page=1, text="   ")],
    )
    finished = run_source_ingestion_job(
        job_id=job.id,
        user_id=USER_A_ID,
        zone_id=zone.id,
        source_id="src-empty",
        extraction=blank_extraction,
        store=store,
        embedding_client=DeterministicFakeEmbeddingClient(),
    )
    assert finished.status == "failed"
    assert "texto extraível" in (finished.message or "")
