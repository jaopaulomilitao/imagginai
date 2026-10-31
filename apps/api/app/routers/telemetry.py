"""rotas de sincronização de agregados de telemetria e exclusão de dados (seções 3.9 e 3.10)."""

from typing import Annotated

from fastapi import APIRouter, Depends, Response, status

from app.core.auth import AuthenticatedUser, get_current_user
from app.core.db import DatabaseStore, get_db_store
from app.schemas.telemetry import (
    SessionAggregateDetailResponse,
    SessionAggregatePayloadSchema,
    SessionAggregateRequest,
    SessionAggregateResponse,
)

router = APIRouter(tags=["telemetry"])

CurrentUserDep = Annotated[AuthenticatedUser, Depends(get_current_user)]
DbStoreDep = Annotated[DatabaseStore, Depends(get_db_store)]


@router.get(
    "/telemetry/aggregates",
    response_model=list[SessionAggregateDetailResponse],
)
def list_session_aggregates(
    user: CurrentUserDep,
    store: DbStoreDep,
    zone_id: str | None = None,
) -> list[SessionAggregateDetailResponse]:
    """lista os agregados de sessão do usuário autenticado para o painel analítico."""
    records = store.list_session_aggregates(user_id=user.user_id, zone_id=zone_id)
    return [
        SessionAggregateDetailResponse(
            id=record.id,
            sessionId=record.session_id,
            zoneId=record.zone_id,
            payload=SessionAggregatePayloadSchema.model_validate(record.payload),
            createdAt=record.created_at,
        )
        for record in records
    ]


@router.post(
    "/telemetry/aggregates",
    response_model=SessionAggregateResponse,
    status_code=status.HTTP_201_CREATED,
)
def submit_session_aggregate(
    body: SessionAggregateRequest,
    user: CurrentUserDep,
    store: DbStoreDep,
) -> SessionAggregateResponse:
    """recebe e armazena de forma idempotente o agregado anônimo de uma sessão de estudo."""
    record = store.upsert_session_aggregate(
        user_id=user.user_id,
        zone_id=body.zone_id,
        session_id=body.session_id,
        payload=body.payload.model_dump(by_alias=True),
    )
    return SessionAggregateResponse(
        id=record.id,
        sessionId=record.session_id,
        zoneId=record.zone_id,
        createdAt=record.created_at,
    )


@router.delete("/me/data", status_code=status.HTTP_204_NO_CONTENT)
def delete_my_data(
    user: CurrentUserDep,
    store: DbStoreDep,
) -> Response:
    """exclui permanentemente zonas, fontes, pacotes e agregados do usuário autenticado."""
    store.delete_all_user_data(user.user_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
