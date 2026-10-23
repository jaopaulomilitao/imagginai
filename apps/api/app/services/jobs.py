"""serviço de execução e acompanhamento de jobs de ingestão em segundo plano."""

import logging

from app.core.config import (
    JOB_PROGRESS_DONE,
    JOB_PROGRESS_EMBEDDING,
    JOB_PROGRESS_EXTRACTING,
    JOB_PROGRESS_EXTRACTING_PACK,
    JOB_PROGRESS_MIN,
    JOB_PROGRESS_SAVING,
)
from app.core.db import ChunkInsertRecord, DatabaseStore, JobRecord
from app.services.embeddings import EmbeddingClient
from app.services.ingestion import (
    DocumentChunk,
    PdfExtractionResult,
    chunk_extracted_pages,
)
from app.services.llm import LlmProvider
from app.services.pack_generator import generate_zone_study_pack

logger = logging.getLogger("imagginai.api.jobs")


def create_ingestion_job(
    store: DatabaseStore,
    user_id: str,
    zone_id: str,
) -> JobRecord:
    """cria um job inicial na fila antes de disparar o processamento em background."""
    return store.create_job(
        user_id=user_id,
        zone_id=zone_id,
        message="aguardando processamento do pdf",
    )


def _persist_embedded_chunks(
    store: DatabaseStore,
    user_id: str,
    zone_id: str,
    chunks: list[DocumentChunk],
    vectors: list[list[float]],
) -> None:
    # associa cada trecho ao seu respectivo vetor de 768 dimensões antes de gravar no banco
    records = [
        ChunkInsertRecord(
            id=chunk.chunk_id,
            user_id=user_id,
            zone_id=zone_id,
            source_id=chunk.source_id,
            page=chunk.page,
            chunk_index=chunk.chunk_index,
            content=chunk.content,
            token_count=chunk.token_count,
            embedding=vector,
        )
        for chunk, vector in zip(chunks, vectors, strict=True)
    ]
    store.insert_chunks(records)


def run_source_ingestion_job(
    *,
    job_id: str,
    user_id: str,
    zone_id: str,
    source_id: str,
    extraction: PdfExtractionResult,
    store: DatabaseStore,
    embedding_client: EmbeddingClient,
    llm_provider: LlmProvider | None = None,
) -> JobRecord:
    """executa o pipeline de chunking, embeddings e geração opcional do study pack."""
    try:
        store.update_job(
            job_id,
            status="running",
            progress=JOB_PROGRESS_EXTRACTING,
            message="dividindo páginas em trechos com âncoras",
        )
        chunks = chunk_extracted_pages(extraction.pages, source_id)
        if not chunks:
            return store.update_job(
                job_id,
                status="failed",
                progress=JOB_PROGRESS_MIN,
                message="o pdf enviado não possui texto extraível",
            )

        store.update_job(
            job_id,
            status="running",
            progress=JOB_PROGRESS_EMBEDDING,
            message="gerando embeddings de 768 dimensões",
        )
        vectors = embedding_client.embed_texts([chunk.content for chunk in chunks])

        store.update_job(
            job_id,
            status="running",
            progress=JOB_PROGRESS_SAVING,
            message="salvando trechos indexados",
        )
        _persist_embedded_chunks(store, user_id, zone_id, chunks, vectors)

        if llm_provider is not None:
            store.update_job(
                job_id,
                status="running",
                progress=JOB_PROGRESS_EXTRACTING_PACK,
                message="extraindo study pack com verificação de grounding e layout 3d",
            )
            sources = store.list_sources_for_zone(user_id, zone_id)
            zone_chunks = store.list_chunks_for_zone(user_id, zone_id)
            pack = generate_zone_study_pack(
                zone_id=zone_id,
                sources=sources,
                chunks=zone_chunks,
                llm_provider=llm_provider,
                embedding_client=embedding_client,
            )
            store.save_study_pack(user_id, zone_id, pack)

        return store.update_job(
            job_id,
            status="done",
            progress=JOB_PROGRESS_DONE,
            message=f"ingestão concluída ({len(chunks)} trechos indexados)",
        )
    except Exception as exc:
        logger.exception("falha ao executar o job de ingestão %s", job_id)
        return store.update_job(
            job_id,
            status="failed",
            message=f"falha na ingestão: {exc}",
        )
