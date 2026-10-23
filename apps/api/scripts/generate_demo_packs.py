"""script utilitário para geração dos 2 study packs de demonstração a partir de pdfs reais."""

import json
import uuid
from datetime import UTC, datetime
from pathlib import Path

import pymupdf

from app.core.config import SOURCE_MAX_PAGES, get_settings
from app.core.db import ChunkRecord, SourceRecord
from app.services.embeddings import GeminiEmbeddingClient
from app.services.ingestion import chunk_extracted_pages, extract_pdf_pages
from app.services.llm import GeminiLlmAdapter, GroqLlmAdapter, ResilientLlmProvider
from app.services.pack_generator import generate_zone_study_pack

REPO_ROOT = Path(__file__).resolve().parents[3]
DEMO_PDFS_DIR = REPO_ROOT / "fixtures" / "demo-pdfs"
OUTPUT_DIR = REPO_ROOT / "apps" / "web" / "public" / "demo-packs"


def _slice_pdf_max_pages(pdf_bytes: bytes, max_pages: int = SOURCE_MAX_PAGES) -> bytes:
    # limita o pdf ao teto de páginas suportado pelo contrato quando o arquivo original excede 60
    with pymupdf.open(stream=pdf_bytes, filetype="pdf") as doc:
        if len(doc) <= max_pages:
            return pdf_bytes
        trimmed = pymupdf.open()
        try:
            trimmed.insert_pdf(doc, from_page=0, to_page=max_pages - 1)
            return bytes(trimmed.tobytes())
        finally:
            trimmed.close()


def _generate_single_demo_pack(
    *,
    pdf_path: Path,
    zone_id: str,
    source_id: str,
    title: str,
    output_filename: str,
    embedding_client: GeminiEmbeddingClient,
    llm_provider: ResilientLlmProvider,
) -> Path:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    out_path = OUTPUT_DIR / output_filename
    if out_path.exists():
        print(f"already exists, skipping: {out_path}")
        return out_path

    raw_bytes = pdf_path.read_bytes()
    bounded_bytes = _slice_pdf_max_pages(raw_bytes, max_pages=30)
    extraction = extract_pdf_pages(bounded_bytes)
    raw_chunks = chunk_extracted_pages(extraction.pages, source_id)

    vectors = embedding_client.embed_texts([chunk.content for chunk in raw_chunks])
    chunk_records = [
        ChunkRecord(
            id=str(
                uuid.uuid5(uuid.NAMESPACE_DNS, f"{source_id}:p{chunk.page}:c{chunk.chunk_index}")
            ),
            user_id="00000000-0000-0000-0000-000000000000",
            zone_id=zone_id,
            source_id=source_id,
            page=chunk.page,
            chunk_index=chunk.chunk_index,
            content=chunk.content,
            token_count=chunk.token_count,
            embedding=vec,
        )
        for chunk, vec in zip(raw_chunks, vectors, strict=True)
    ]

    source_record = SourceRecord(
        id=source_id,
        user_id="00000000-0000-0000-0000-000000000000",
        zone_id=zone_id,
        title=title,
        storage_path=f"demo/{zone_id}/{source_id}.pdf",
        page_count=extraction.page_count,
        size_bytes=len(bounded_bytes),
        created_at=datetime.now(UTC).isoformat().replace("+00:00", "Z"),
    )

    pack = generate_zone_study_pack(
        zone_id=zone_id,
        sources=[source_record],
        chunks=chunk_records,
        llm_provider=llm_provider,
        embedding_client=embedding_client,
    )

    payload = pack.model_dump(by_alias=True, mode="json")
    out_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(
        f"[{output_filename}] model={pack.meta.model} "
        f"concepts={len(pack.concepts)} edges={len(pack.edges)} "
        f"cards={len(pack.cards)} quiz={len(pack.quiz)} "
        f"assets={len(pack.assets)} discarded={pack.meta.discarded}"
    )
    return out_path


def main() -> None:
    settings = get_settings()
    settings.require("llm")
    assert settings.gemini_api_key is not None
    assert settings.embedding_model is not None
    assert settings.llm_model is not None
    assert settings.groq_api_key is not None
    assert settings.fallback_llm_model is not None

    embedding_client = GeminiEmbeddingClient(
        api_key=settings.gemini_api_key,
        model=settings.embedding_model,
    )
    llm_provider = ResilientLlmProvider(
        primary=GeminiLlmAdapter(api_key=settings.gemini_api_key, model=settings.llm_model),
        fallback=GroqLlmAdapter(api_key=settings.groq_api_key, model=settings.fallback_llm_model),
    )

    eng_pdf = next(DEMO_PDFS_DIR.glob("Aula 03*.pdf"))
    health_pdf = next(DEMO_PDFS_DIR.glob("caderno*.pdf"))

    eng_out = _generate_single_demo_pack(
        pdf_path=eng_pdf,
        zone_id="zone-demo-engenharia-circuitos-cc",
        source_id="src-circuitos-eletricos-cc",
        title="Circuitos Elétricos em Corrente Contínua (CC)",
        output_filename="engineering-dc-circuits.json",
        embedding_client=embedding_client,
        llm_provider=llm_provider,
    )
    print(f"generated: {eng_out}")

    health_out = _generate_single_demo_pack(
        pdf_path=health_pdf,
        zone_id="zone-demo-saude-anatomia-humana",
        source_id="src-caderno-anatomia-humana",
        title="Caderno de Estudos Práticos em Anatomia Humana",
        output_filename="health-human-anatomy.json",
        embedding_client=embedding_client,
        llm_provider=llm_provider,
    )
    print(f"generated: {health_out}")


if __name__ == "__main__":
    main()
