"""testes da fase 9 para agregados de telemetria, privacidade e exclusão de dados."""

from time import time

import jwt
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.core.db import InMemoryStore
from app.main import create_app

TEST_JWT_SECRET = "test-secret-phase9-32-bytes-minimum-key"
TEST_USER_A = "11111111-2222-3333-4444-555555555555"
TEST_USER_B = "99999999-8888-7777-6666-555555555555"


def _make_token(user_id: str) -> str:
    payload = {
        "sub": user_id,
        "aud": "authenticated",
        "exp": int(time()) + 3600,
    }
    return jwt.encode(payload, TEST_JWT_SECRET, algorithm="HS256")


def _build_client() -> tuple[TestClient, InMemoryStore]:
    settings = Settings(
        _env_file=None,
        supabase_url="https://example.supabase.co",
        supabase_service_role_key="service-role-key",
        supabase_jwt_secret=TEST_JWT_SECRET,
    )
    store = InMemoryStore()
    app = create_app(settings, db_store=store)
    return TestClient(app), store


def test_submit_telemetry_aggregate_idempotent() -> None:
    # verifica que o envio repetido da mesma sessão é idempotente na fila offline
    client, store = _build_client()
    headers = {"Authorization": f"Bearer {_make_token(TEST_USER_A)}"}

    zone = store.create_zone(TEST_USER_A, "Zona Engenharia", "focus-dark")
    body = {
        "sessionId": "session-offline-001",
        "zoneId": zone.id,
        "payload": {
            "totalFocusTimeMs": 1500000,
            "conceptTimeMs": {"c-1": 4000, "c-2": 22000, "c-3": 48000},
            "conceptTimeBuckets": {
                "c-1": "0-5s",
                "c-2": "5-30s",
                "c-3": ">30s",
            },
            "conceptOpens": {"c-1": 2, "c-2": 4, "c-3": 5},
            "quizByConcept": {
                "c-1": {"correct": 2, "incorrect": 0},
                "c-2": {"correct": 1, "incorrect": 1},
            },
            "pinchSuccessCount": 24,
            "pinchMissCount": 2,
            "pinchRepeatCount": 1,
            "pinchSuccessRate": 0.923,
            "modeTimeMs": {"focus": 1200000, "passthrough": 300000},
            "fpsP50": 59.4,
            "fpsP10": 53.2,
            "completedPomodoroBlocks": 1,
        },
    }

    resp1 = client.post("/telemetry/aggregates", json=body, headers=headers)
    assert resp1.status_code == 201
    first_id = resp1.json()["id"]

    # reenvio da mesma sessionId não duplica registro
    resp2 = client.post("/telemetry/aggregates", json=body, headers=headers)
    assert resp2.status_code == 201
    assert resp2.json()["id"] == first_id
    assert len(store.list_session_aggregates(TEST_USER_A)) == 1


def test_rejects_forbidden_biometric_or_raw_fields_in_telemetry() -> None:
    # garante que nenhum campo proibido (landmarks, orientação, vídeo, áudio) seja aceito pela api
    client, _ = _build_client()
    headers = {"Authorization": f"Bearer {_make_token(TEST_USER_A)}"}

    forbidden_payloads = [
        {
            "sessionId": "s-bad-1",
            "zoneId": "demo",
            "landmarks": [[0.1, 0.2, 0.3]],
            "payload": {"totalFocusTimeMs": 1000},
        },
        {
            "sessionId": "s-bad-2",
            "zoneId": "demo",
            "payload": {
                "totalFocusTimeMs": 1000,
                "headOrientationSeries": [0.1, 0.2],
            },
        },
        {
            "sessionId": "s-bad-3",
            "zoneId": "demo",
            "payload": {
                "totalFocusTimeMs": 1000,
                "videoFrames": ["frame1"],
            },
        },
        {
            "sessionId": "s-bad-4",
            "zoneId": "demo",
            "payload": {
                "totalFocusTimeMs": 1000,
                "audio": "raw-audio",
            },
        },
    ]

    for invalid_body in forbidden_payloads:
        resp = client.post("/telemetry/aggregates", json=invalid_body, headers=headers)
        assert resp.status_code == 422


def test_delete_my_data_removes_all_user_records_and_isolates_other_users() -> None:
    # verifica que delete /me/data apaga zonas, fontes e agregados apenas do usuário autenticado
    client, store = _build_client()
    headers_a = {"Authorization": f"Bearer {_make_token(TEST_USER_A)}"}

    zone_a = store.create_zone(TEST_USER_A, "Zona A", "focus-dark")
    store.upsert_session_aggregate(TEST_USER_A, zone_a.id, "sess-a", {"totalFocusTimeMs": 5000})

    zone_b = store.create_zone(TEST_USER_B, "Zona B", "focus-nature")
    store.upsert_session_aggregate(TEST_USER_B, zone_b.id, "sess-b", {"totalFocusTimeMs": 8000})

    resp = client.delete("/me/data", headers=headers_a)
    assert resp.status_code == 204

    assert store.list_zones(TEST_USER_A) == []
    assert store.list_session_aggregates(TEST_USER_A) == []
    assert len(store.list_zones(TEST_USER_B)) == 1
    assert len(store.list_session_aggregates(TEST_USER_B)) == 1
