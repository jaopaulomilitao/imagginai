import pytest
from pydantic import ValidationError

from app.core.config import MissingSettingsError, Settings


def test_cors_origins_are_split_from_comma_separated_text() -> None:
    settings = Settings(_env_file=None, cors_origins="http://a.test, https://b.test")

    assert settings.cors_origins == ["http://a.test", "https://b.test"]


def test_wildcard_cors_origin_is_rejected() -> None:
    with pytest.raises(ValidationError):
        Settings(_env_file=None, cors_origins="*")


def test_require_lists_every_missing_variable() -> None:
    settings = Settings(_env_file=None, supabase_url="https://x.supabase.co")

    with pytest.raises(MissingSettingsError) as error:
        settings.require("supabase")

    assert "SUPABASE_SERVICE_ROLE_KEY" in str(error.value)
    assert "SUPABASE_JWT_SECRET" in str(error.value)
    assert "SUPABASE_URL," not in str(error.value)


def test_require_passes_when_feature_is_configured() -> None:
    settings = Settings(
        _env_file=None,
        supabase_url="https://x.supabase.co",
        supabase_service_role_key="service",
        supabase_jwt_secret="secret",
    )

    settings.require("supabase")


def test_non_https_supabase_url_is_rejected() -> None:
    with pytest.raises(ValidationError):
        Settings(_env_file=None, supabase_url="http://x.supabase.co")
