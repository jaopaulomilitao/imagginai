"""extração de texto por página via pymupdf e divisão em trechos com âncoras de fonte."""

from collections.abc import Callable, Sequence
from dataclasses import dataclass
from uuid import uuid4

import pymupdf

from app.core.config import (
    CHUNK_OVERLAP_TOKENS,
    CHUNK_TARGET_TOKENS,
    SOURCE_MAX_PAGES,
    SOURCE_MAX_SIZE_BYTES,
)
from app.schemas.study_pack import SourceAnchor


class PdfValidationError(ValueError):
    """erro lançado quando o arquivo enviado viola os limites ou não é um pdf válido."""

    def __init__(self, message: str, status_code: int = 400) -> None:
        super().__init__(message)
        self.status_code = status_code


@dataclass(frozen=True)
class ExtractedPage:
    """texto extraído de uma única página numerada a partir de 1."""

    page: int
    text: str


@dataclass(frozen=True)
class PdfExtractionResult:
    """resultado da leitura do documento pdf com contagem total e páginas extraídas."""

    page_count: int
    size_bytes: int
    pages: list[ExtractedPage]


@dataclass(frozen=True)
class DocumentChunk:
    """trecho textual com contagem de tokens e âncora verificável de página."""

    chunk_id: str
    source_id: str
    page: int
    chunk_index: int
    content: str
    token_count: int
    anchor: SourceAnchor


def _normalize_whitespace(raw_text: str) -> str:
    # remove espaços repetidos mantendo a sequência de palavras legível
    return " ".join(raw_text.split())


def validate_pdf_size(pdf_bytes: bytes) -> int:
    """verifica se o tamanho em bytes está dentro do limite de 20 mb."""
    size_bytes = len(pdf_bytes)
    if size_bytes == 0:
        raise PdfValidationError("pdf file must not be empty", status_code=400)
    if size_bytes > SOURCE_MAX_SIZE_BYTES:
        raise PdfValidationError(
            f"pdf file exceeds maximum size of {SOURCE_MAX_SIZE_BYTES} bytes",
            status_code=413,
        )
    return size_bytes


def extract_pdf_pages(pdf_bytes: bytes) -> PdfExtractionResult:
    """extrai o texto de cada página do pdf e valida o limite de 60 páginas."""
    size_bytes = validate_pdf_size(pdf_bytes)
    try:
        doc = pymupdf.open(stream=pdf_bytes, filetype="pdf")
    except Exception as exc:
        raise PdfValidationError("invalid or corrupted pdf document", status_code=400) from exc

    with doc:
        page_count = doc.page_count
        if page_count < 1 or page_count > SOURCE_MAX_PAGES:
            raise PdfValidationError(
                f"pdf page count must be between 1 and {SOURCE_MAX_PAGES}, got {page_count}",
                status_code=400,
            )
        pages = [
            ExtractedPage(
                page=page_index + 1,
                text=_normalize_whitespace(doc.load_page(page_index).get_text("text")),
            )
            for page_index in range(page_count)
        ]

    return PdfExtractionResult(page_count=page_count, size_bytes=size_bytes, pages=pages)


def _window_tokens(
    tokens: list[str],
    target_tokens: int,
    overlap_tokens: int,
) -> list[list[str]]:
    # aplica janela deslizante dentro da mesma página para preservar a referência de página
    if not tokens:
        return []
    step = max(1, target_tokens - overlap_tokens)
    windows: list[list[str]] = []
    start = 0
    while start < len(tokens):
        end = min(start + target_tokens, len(tokens))
        windows.append(tokens[start:end])
        if end >= len(tokens):
            break
        start += step
    return windows


def chunk_extracted_pages(
    pages: Sequence[ExtractedPage],
    source_id: str,
    *,
    target_tokens: int = CHUNK_TARGET_TOKENS,
    overlap_tokens: int = CHUNK_OVERLAP_TOKENS,
    id_factory: Callable[[], str] | None = None,
) -> list[DocumentChunk]:
    """divide as páginas em trechos de ~500 tokens com sobreposição de 50 tokens e âncoras."""
    if target_tokens <= 0:
        raise ValueError("target_tokens must be positive")
    if overlap_tokens < 0 or overlap_tokens >= target_tokens:
        raise ValueError("overlap_tokens must be >= 0 and < target_tokens")

    make_id = id_factory or (lambda: str(uuid4()))
    chunks: list[DocumentChunk] = []
    next_index = 0

    for extracted in pages:
        tokens = extracted.text.split()
        for window in _window_tokens(tokens, target_tokens, overlap_tokens):
            chunk_id = make_id()
            anchor = SourceAnchor(
                source_id=source_id,
                page=extracted.page,
                chunk_id=chunk_id,
            )
            chunks.append(
                DocumentChunk(
                    chunk_id=chunk_id,
                    source_id=source_id,
                    page=extracted.page,
                    chunk_index=next_index,
                    content=" ".join(window),
                    token_count=len(window),
                    anchor=anchor,
                )
            )
            next_index += 1

    return chunks
