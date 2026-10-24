"""validação de tokens jwt emitidos pelo supabase auth (hs256 e es256/jwks)."""

from dataclasses import dataclass
from functools import lru_cache
from typing import Annotated, Any

import httpx
import jwt
from fastapi import Header, HTTPException, Request, status

from app.core.config import (
    SUPABASE_JWT_ALGORITHMS,
    SUPABASE_JWT_AUDIENCE,
    MissingSettingsError,
    Settings,
    get_settings,
)

ASYMMETRIC_JWT_ALGORITHMS: tuple[str, ...] = ("ES256", "RS256")


@dataclass(frozen=True)
class AuthenticatedUser:
    """representa o usuário autenticado extraído do token jwt do supabase."""

    user_id: str
    email: str | None = None
    role: str = "authenticated"


def _extract_bearer_token(authorization: str | None) -> str:
    # verifica se o cabeçalho authorization segue o formato bearer esperado
    if not authorization:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="missing authorization header",
            headers={"WWW-Authenticate": "Bearer"},
        )
    parts = authorization.strip().split(" ", 1)
    if len(parts) != 2 or parts[0].lower() != "bearer" or not parts[1].strip():
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="invalid authorization header format",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return parts[1].strip()


def _validate_audience_claim(audience: object) -> None:
    # garante que o público-alvo do token corresponda ao papel autenticado quando informado
    if audience is None:
        return
    if isinstance(audience, str) and audience == SUPABASE_JWT_AUDIENCE:
        return
    if isinstance(audience, list) and SUPABASE_JWT_AUDIENCE in audience:
        return
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="invalid token audience",
        headers={"WWW-Authenticate": "Bearer"},
    )


@lru_cache(maxsize=8)
def _fetch_supabase_jwk_set(supabase_url: str) -> jwt.PyJWKSet:
    # obtém e armazena em cache as chaves públicas jwks do projeto supabase para tokens es256/rs256
    base = supabase_url.rstrip("/")
    response = httpx.get(f"{base}/auth/v1/.well-known/jwks.json", timeout=10.0)
    response.raise_for_status()
    data: dict[str, Any] = response.json()
    return jwt.PyJWKSet.from_dict(data)


def _decode_jwt_payload(
    token: str,
    jwt_secret: str,
    supabase_url: str | None = None,
) -> dict[str, Any]:
    # seleciona verificação simétrica (hs256) ou assimétrica via jwks (es256/rs256)
    header = jwt.get_unverified_header(token)
    alg = str(header.get("alg", "HS256"))
    kid = header.get("kid")

    if alg in ASYMMETRIC_JWT_ALGORITHMS and supabase_url:
        jwk_set = _fetch_supabase_jwk_set(supabase_url)
        signing_key: Any = None
        if isinstance(kid, str) and kid:
            for item in jwk_set.keys:
                if item.key_id == kid:
                    signing_key = item.key
                    break
        if signing_key is None and jwk_set.keys:
            signing_key = jwk_set.keys[0].key
        if signing_key is not None:
            return jwt.decode(
                token,
                signing_key,
                algorithms=list(ASYMMETRIC_JWT_ALGORITHMS),
                options={"require": ["sub", "exp"], "verify_aud": False},
            )

    return jwt.decode(
        token,
        jwt_secret,
        algorithms=list(SUPABASE_JWT_ALGORITHMS),
        options={"require": ["sub", "exp"], "verify_aud": False},
    )


def verify_supabase_jwt(
    token: str,
    jwt_secret: str,
    *,
    supabase_url: str | None = None,
) -> AuthenticatedUser:
    """valida a assinatura, a expiração e o identificador do usuário no token jwt."""
    try:
        payload = _decode_jwt_payload(token, jwt_secret, supabase_url=supabase_url)
    except jwt.ExpiredSignatureError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="token has expired",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc
    except (jwt.InvalidTokenError, httpx.HTTPError) as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="invalid token",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc

    _validate_audience_claim(payload.get("aud"))
    sub = payload.get("sub")
    if not isinstance(sub, str) or not sub.strip():
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="token subject is missing",
            headers={"WWW-Authenticate": "Bearer"},
        )

    email = payload.get("email")
    role = payload.get("role")
    return AuthenticatedUser(
        user_id=sub.strip(),
        email=email if isinstance(email, str) else None,
        role=role if isinstance(role, str) else "authenticated",
    )


def _resolve_request_settings(request: Request) -> Settings:
    # prioriza a instância de configuração associada ao aplicativo durante os testes
    app_settings = getattr(request.app.state, "settings", None)
    if isinstance(app_settings, Settings):
        return app_settings
    return get_settings()


def get_current_user(
    request: Request,
    authorization: Annotated[str | None, Header()] = None,
) -> AuthenticatedUser:
    """dependência reutilizável do fastapi que autentica a requisição via supabase jwt."""
    settings = _resolve_request_settings(request)
    if not settings.supabase_jwt_secret:
        try:
            settings.require("supabase")
        except MissingSettingsError as exc:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=str(exc),
            ) from exc

    token = _extract_bearer_token(authorization)
    assert settings.supabase_jwt_secret is not None
    return verify_supabase_jwt(
        token,
        settings.supabase_jwt_secret,
        supabase_url=settings.supabase_url,
    )
