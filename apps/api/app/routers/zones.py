"""rotas autenticadas de gerenciamento de zonas e envio de documentos pdf (seção 3.10)."""

from pathlib import Path
from typing import Annotated
from uuid import uuid4

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    File,
    HTTPException,
    UploadFile,
    status,
)

from app.core.auth import AuthenticatedUser, get_current_user
from app.core.db import DatabaseStore, ZoneRecord, get_db_store
from app.schemas.zones import (
    SourceUploadResponse,
    ZoneCreateRequest,
    ZoneDeleteResponse,
    ZoneResponse,
    ZoneUpdateRequest,
)
from app.services.embeddings import EmbeddingClient, get_embedding_client
from app.services.ingestion import PdfValidationError, extract_pdf_pages
from app.services.jobs import create_ingestion_job, run_source_ingestion_job

router = APIRouter(prefix="/zones", tags=["zones"])


def _to_zone_response(record: ZoneRecord) -> ZoneResponse:
    return ZoneResponse(
        id=record.id,
        name=record.name,
        environment=record.environment,
        source_ids=record.source_ids,
        pack_id=record.pack_id,
        layout=record.layout,
        created_at=record.created_at,
        updated_at=record.updated_at,
    )


def _derive_source_title(filename: str | None) -> str:
    # extrai um título legível a partir do nome do arquivo enviado
    if not filename or not filename.strip():
        return "Documento PDF"
    stem = Path(filename.strip()).stem.strip()
    return stem if stem else "Documento PDF"


@router.post("", response_model=ZoneResponse, status_code=status.HTTP_201_CREATED)
def create_zone(
    payload: ZoneCreateRequest,
    current_user: Annotated[AuthenticatedUser, Depends(get_current_user)],
    store: Annotated[DatabaseStore, Depends(get_db_store)],
) -> ZoneResponse:
    """cria uma nova zona de estudo pertencente ao usuário autenticado."""
    record = store.create_zone(
        user_id=current_user.user_id,
        name=payload.name,
        environment=payload.environment,
    )
    return _to_zone_response(record)


@router.get("", response_model=list[ZoneResponse])
def list_zones(
    current_user: Annotated[AuthenticatedUser, Depends(get_current_user)],
    store: Annotated[DatabaseStore, Depends(get_db_store)],
) -> list[ZoneResponse]:
    """lista todas as zonas do usuário autenticado."""
    records = store.list_zones(current_user.user_id)
    return [_to_zone_response(record) for record in records]


@router.patch("/{zone_id}", response_model=ZoneResponse)
def update_zone(
    zone_id: str,
    payload: ZoneUpdateRequest,
    current_user: Annotated[AuthenticatedUser, Depends(get_current_user)],
    store: Annotated[DatabaseStore, Depends(get_db_store)],
) -> ZoneResponse:
    """atualiza nome, ambiente ou layout esférico dos painéis de uma zona."""
    updated = store.update_zone(
        current_user.user_id,
        zone_id,
        name=payload.name,
        environment=payload.environment,
        layout=payload.layout,
    )
    if updated is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="zone not found")
    return _to_zone_response(updated)


@router.delete("/{zone_id}", response_model=ZoneDeleteResponse)
def delete_zone(
    zone_id: str,
    current_user: Annotated[AuthenticatedUser, Depends(get_current_user)],
    store: Annotated[DatabaseStore, Depends(get_db_store)],
) -> ZoneDeleteResponse:
    """remove a zona e seus objetos vinculados do banco e do storage."""
    deleted = store.delete_zone(current_user.user_id, zone_id)
    if not deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="zone not found")
    return ZoneDeleteResponse(id=zone_id, deleted=True)


@router.post(
    "/{zone_id}/sources",
    response_model=SourceUploadResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
async def upload_zone_source(
    zone_id: str,
    background_tasks: BackgroundTasks,
    file: Annotated[UploadFile, File()],
    current_user: Annotated[AuthenticatedUser, Depends(get_current_user)],
    store: Annotated[DatabaseStore, Depends(get_db_store)],
    embedding_client: Annotated[EmbeddingClient, Depends(get_embedding_client)],
) -> SourceUploadResponse:
    """recebe um pdf de até 20 mb e 60 páginas, salva no storage e inicia o job de ingestão."""
    zone = store.get_zone(current_user.user_id, zone_id)
    if zone is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="zone not found")

    pdf_bytes = await file.read()
    try:
        extraction = extract_pdf_pages(pdf_bytes)
    except PdfValidationError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc

    source_id = str(uuid4())
    title = _derive_source_title(file.filename)
    storage_path = store.upload_source_pdf(
        user_id=current_user.user_id,
        zone_id=zone_id,
        source_id=source_id,
        pdf_bytes=pdf_bytes,
    )
    store.create_source(
        user_id=current_user.user_id,
        zone_id=zone_id,
        source_id=source_id,
        title=title,
        storage_path=storage_path,
        page_count=extraction.page_count,
        size_bytes=extraction.size_bytes,
    )
    job = create_ingestion_job(store, current_user.user_id, zone_id)

    background_tasks.add_task(
        run_source_ingestion_job,
        job_id=job.id,
        user_id=current_user.user_id,
        zone_id=zone_id,
        source_id=source_id,
        extraction=extraction,
        store=store,
        embedding_client=embedding_client,
    )

    return SourceUploadResponse(
        job_id=job.id,
        source_id=source_id,
        title=title,
        page_count=extraction.page_count,
    )
