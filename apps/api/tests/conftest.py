import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import create_app


@pytest.fixture
def empty_settings() -> Settings:
    # o .env real é ignorado para que os testes rodem sem credenciais
    return Settings(_env_file=None)


@pytest.fixture
def client(empty_settings: Settings) -> TestClient:
    return TestClient(create_app(empty_settings))
