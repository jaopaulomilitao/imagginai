"""validação de tokens jwt emitidos pelo supabase auth para rotas protegidas."""

from dataclasses import dataclass
from typing import Annotated

import jwt
from fastapi import Header, HTTPException, Request, status

from app.core.config import (
    SUPABASE_JWT_ALGORITHMS,
    SUPABASE_JWT_AUDIENCE,
    MissingSettingsError,
    Settings,
    get_settings,
)


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


def verify_supabase_jwt(token: str, jwt_secret: str) -> AuthenticatedUser:
    """valida a assinatura, a expiração e o identificador do usuário no token jwt."""
    try:
        payload = jwt.decode(
            token,
            jwt_secret,
            algorithms=list(SUPABASE_JWT_ALGORITHMS),
            options={"require": ["sub", "exp"], "verify_aud": False},
        )
    except jwt.ExpiredSignatureError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="token has expired",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc
    except jwt.InvalidTokenError as exc:
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
    return verify_supabase_jwt(token, settings.supabase_jwt_secret)
