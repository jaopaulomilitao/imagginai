"""testes de segurança, isolamento de telemetria e adição de flashcards na fase 10."""

from pathlib import Path
from typing import Any

import jwt
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.core.db import InMemoryStore
from app.main import create_app
from app.schemas.study_pack import parse_study_pack

TEST_JWT_SECRET = "phase10-test-secret-key-with-32-bytes!!"
DEMO_PACK_PATH = Path(__file__).resolve().parents[3] / "fixtures" / "demo-pack.json"


def _make_token(user_id: str, email: str = "student@imagginai.test") -> str:
    payload: dict[str, Any] = {
        "sub": user_id,
        "email": email,
        "aud": "authenticated",
        "role": "authenticated",
    }
    return jwt.encode(payload, TEST_JWT_SECRET, algorithm="HS256")


def _build_client() -> tuple[TestClient, InMemoryStore]:
    settings = Settings(
        app_env="development",
        cors_origins=["http://localhost:5173"],
        supabase_url="https://example.supabase.co",
        supabase_service_role_key="service-role-test",
        supabase_jwt_secret=TEST_JWT_SECRET,
    )
    app = create_app(settings)
    store = InMemoryStore()
    app.state.db_store = store
    return TestClient(app), store


def test_list_telemetry_aggregates_enforces_user_isolation() -> None:
    """garante que cada estudante ou pesquisador acesse exclusivamente seus próprios agregados."""
    client, _ = _build_client()
    headers_a = {"Authorization": f"Bearer {_make_token('user-a')}"}
    headers_b = {"Authorization": f"Bearer {_make_token('user-b')}"}

    sample_payload = {
        "totalFocusTimeMs": 900000,
        "conceptTimeMs": {"c-1": 35000},
        "conceptTimeBuckets": {"c-1": ">30s"},
        "conceptOpens": {"c-1": 3},
        "quizByConcept": {"c-1": {"correct": 2, "incorrect": 0}},
        "pinchSuccessCount": 30,
        "pinchMissCount": 2,
        "pinchRepeatCount": 1,
        "pinchSuccessRate": 0.9375,
        "modeTimeMs": {"focus": 900000},
        "fpsP50": 59.0,
        "fpsP10": 54.0,
        "completedPomodoroBlocks": 1,
    }

    res_post = client.post(
        "/telemetry/aggregates",
        headers=headers_a,
        json={
            "sessionId": "sess-user-a-1",
            "zoneId": "zone-a",
            "payload": sample_payload,
        },
    )
    assert res_post.status_code == 201

    res_list_a = client.get("/telemetry/aggregates", headers=headers_a)
    assert res_list_a.status_code == 200
    data_a = res_list_a.json()
    assert len(data_a) == 1
    assert data_a[0]["sessionId"] == "sess-user-a-1"
    assert data_a[0]["payload"]["totalFocusTimeMs"] == 900000

    res_list_b = client.get("/telemetry/aggregates", headers=headers_b)
    assert res_list_b.status_code == 200
    assert res_list_b.json() == []


def test_add_zone_card_persists_flashcard_to_user_study_pack() -> None:
    """verifica que adicionar um flashcard na zona vr salva o card no study pack da conta."""
    client, store = _build_client()
    user_id = "user-card-owner"
    headers = {"Authorization": f"Bearer {_make_token(user_id)}"}

    zone = store.create_zone(user_id=user_id, name="Zona Cardiovascular", environment="focus-dark")
    demo_pack = parse_study_pack(DEMO_PACK_PATH.read_bytes())
    store.save_study_pack(user_id=user_id, zone_id=zone.id, pack=demo_pack)

    initial_card_count = len(demo_pack.cards)
    target_concept = demo_pack.concepts[0]

    new_card_payload = {
        "id": "card-vr-node-1",
        "title": target_concept.label,
        "body": target_concept.definition,
        "conceptIds": [target_concept.id],
        "anchors": [
            {
                "sourceId": "src-pdf",
                "page": 99,
                "chunkId": f"chunk-{target_concept.id}",
            }
        ],
    }

    res = client.post(f"/zones/{zone.id}/cards", headers=headers, json=new_card_payload)
    assert res.status_code == 201
    updated_pack = res.json()
    assert len(updated_pack["cards"]) == initial_card_count + 1
    saved_card = next(c for c in updated_pack["cards"] if c["id"] == "card-vr-node-1")
    assert saved_card["title"] == target_concept.label
    assert saved_card["anchors"][0]["sourceId"] == demo_pack.sources[0].id


def test_rls_policies_and_protected_endpoints_security_audit() -> None:
    """audita políticas rls no sql de migração e bloqueio de requisições sem token jwt."""
    client, _ = _build_client()

    # rotas protegidas devem exigir token bearer
    for method, path in [
        ("GET", "/zones"),
        ("POST", "/zones"),
        ("GET", "/telemetry/aggregates"),
        ("POST", "/telemetry/aggregates"),
        ("DELETE", "/me/data"),
    ]:
        response = client.request(method, path)
        assert response.status_code == 401

    # verifica cobertura rls em todas as 7 tabelas da seção 3.11
    migration_sql = (
        Path(__file__).resolve().parents[3] / "supabase" / "migrations" / "0001_init.sql"
    ).read_text(encoding="utf-8")

    required_tables = [
        "zones",
        "sources",
        "chunks",
        "packs",
        "jobs",
        "consents",
        "session_aggregates",
    ]
    for table in required_tables:
        assert f"alter table public.{table} enable row level security" in migration_sql.lower()

    # garante que nenhum segredo de backend aparece no código-fonte do bundle web
    web_src = Path(__file__).resolve().parents[3] / "apps" / "web" / "src"
    forbidden_secrets = (
        "SUPABASE_SERVICE_ROLE_KEY",
        "SUPABASE_JWT_SECRET",
        "GEMINI_API_KEY",
        "GROQ_API_KEY",
    )
    for source_file in web_src.rglob("*"):
        if source_file.suffix in {".ts", ".tsx"} and not source_file.name.endswith(".test.ts"):
            text = source_file.read_text(encoding="utf-8")
            for secret in forbidden_secrets:
                assert secret not in text

