"""rotas autenticadas de gerenciamento de zonas e envio de documentos pdf (seção 3.10)."""

from pathlib import Path
from typing import Annotated
from uuid import uuid4

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    File,
    Form,
    HTTPException,
    Request,
    UploadFile,
    status,
)

from app.core.auth import AuthenticatedUser, get_current_user
from app.core.db import DatabaseStore, ZoneRecord, get_db_store
from app.schemas.study_pack import SourceAnchor, StudyCard, StudyPack
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
from app.services.llm import LlmProvider, get_llm_provider

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


def _resolve_optional_llm_provider(request: Request) -> LlmProvider | None:
    # resolve o provedor llm quando configurado ou quando as chaves estão disponíveis no .env
    existing = getattr(request.app.state, "llm_provider", None)
    if existing is not None:
        return existing  # type: ignore[no-any-return]
    try:
        return get_llm_provider(request)
    except HTTPException:
        return None


@router.post(
    "/{zone_id}/sources",
    response_model=SourceUploadResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
async def upload_zone_source(
    zone_id: str,
    request: Request,
    background_tasks: BackgroundTasks,
    file: Annotated[UploadFile, File()],
    current_user: Annotated[AuthenticatedUser, Depends(get_current_user)],
    store: Annotated[DatabaseStore, Depends(get_db_store)],
    embedding_client: Annotated[EmbeddingClient, Depends(get_embedding_client)],
    title: Annotated[str | None, Form()] = None,
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
    effective_title = (
        title.strip()
        if isinstance(title, str) and title.strip()
        else _derive_source_title(file.filename)
    )
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
        title=effective_title,
        storage_path=storage_path,
        page_count=extraction.page_count,
        size_bytes=extraction.size_bytes,
    )
    job = create_ingestion_job(store, current_user.user_id, zone_id)
    llm_provider = _resolve_optional_llm_provider(request)

    background_tasks.add_task(
        run_source_ingestion_job,
        job_id=job.id,
        user_id=current_user.user_id,
        zone_id=zone_id,
        source_id=source_id,
        extraction=extraction,
        store=store,
        embedding_client=embedding_client,
        llm_provider=llm_provider,
    )

    return SourceUploadResponse(
        job_id=job.id,
        source_id=source_id,
        title=effective_title,
        page_count=extraction.page_count,
    )


@router.get("/{zone_id}/pack", response_model=StudyPack)
def get_zone_pack(
    zone_id: str,
    current_user: Annotated[AuthenticatedUser, Depends(get_current_user)],
    store: Annotated[DatabaseStore, Depends(get_db_store)],
) -> StudyPack:
    """retorna o study pack validado da zona ou 404 caso ainda não tenha sido gerado."""
    zone = store.get_zone(current_user.user_id, zone_id)
    if zone is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="zone not found")

    pack = store.get_zone_study_pack(current_user.user_id, zone_id)
    if pack is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="study pack not found")
    return pack


@router.post("/{zone_id}/cards", response_model=StudyPack, status_code=status.HTTP_201_CREATED)
def add_zone_card(
    zone_id: str,
    card: StudyCard,
    current_user: Annotated[AuthenticatedUser, Depends(get_current_user)],
    store: Annotated[DatabaseStore, Depends(get_db_store)],
) -> StudyPack:
    """adiciona e persiste um flashcard no study pack da zona autenticada."""
    zone = store.get_zone(current_user.user_id, zone_id)
    if zone is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="zone not found")

    pack = store.get_zone_study_pack(current_user.user_id, zone_id)
    if pack is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="study pack not found")

    concept_by_id = {c.id: c for c in pack.concepts}
    source_by_id = {s.id: s for s in pack.sources}
    fallback_concept = pack.concepts[0]
    fallback_source = pack.sources[0]

    valid_concept_ids = [cid for cid in card.concept_ids if cid in concept_by_id]
    if not valid_concept_ids:
        valid_concept_ids = [fallback_concept.id]

    primary_concept = concept_by_id[valid_concept_ids[0]]

    valid_anchors: list[SourceAnchor] = []
    for anchor in card.anchors:
        src = source_by_id.get(anchor.source_id)
        if src is not None:
            clamped_page = max(1, min(anchor.page, src.page_count))
            valid_anchors.append(
                SourceAnchor(
                    source_id=src.id,
                    page=clamped_page,
                    chunk_id=anchor.chunk_id,
                )
            )
    if not valid_anchors:
        if primary_concept.anchors:
            valid_anchors = list(primary_concept.anchors)
        else:
            valid_anchors = [
                SourceAnchor(
                    source_id=fallback_source.id,
                    page=1,
                    chunk_id=f"chunk-{primary_concept.id}",
                )
            ]

    normalized_card = StudyCard(
        id=card.id,
        title=card.title,
        body=card.body,
        concept_ids=valid_concept_ids,
        anchors=valid_anchors,
    )

    existing_cards = [c for c in pack.cards if c.id != normalized_card.id]
    updated_pack = StudyPack(
        schema_version=pack.schema_version,
        pack_id=pack.pack_id,
        zone_id=pack.zone_id,
        created_at=pack.created_at,
        sources=pack.sources,
        concepts=pack.concepts,
        edges=pack.edges,
        cards=[*existing_cards, normalized_card],
        quiz=pack.quiz,
        assets=pack.assets,
        meta=pack.meta,
    )
    store.save_study_pack(current_user.user_id, zone_id, updated_pack)
    return updated_pack
