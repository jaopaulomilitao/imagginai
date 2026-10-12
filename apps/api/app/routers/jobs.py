"""rota autenticada para consulta de status e progresso de jobs (seção 3.10)."""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status

from app.core.auth import AuthenticatedUser, get_current_user
from app.core.db import DatabaseStore, get_db_store
from app.schemas.jobs import JobResponse

router = APIRouter(prefix="/jobs", tags=["jobs"])


@router.get("/{job_id}", response_model=JobResponse)
def get_job_status(
    job_id: str,
    current_user: Annotated[AuthenticatedUser, Depends(get_current_user)],
    store: Annotated[DatabaseStore, Depends(get_db_store)],
) -> JobResponse:
    """retorna o estado atual e o percentual de progresso de um job do usuário."""
    record = store.get_job(current_user.user_id, job_id)
    if record is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="job not found")
    return JobResponse(
        id=record.id,
        zone_id=record.zone_id,
        status=record.status,
        progress=record.progress,
        message=record.message,
    )
