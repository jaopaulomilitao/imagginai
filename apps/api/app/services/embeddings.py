"""cliente de embeddings gemini com dimensão fixa 768 e normalização l2."""

import hashlib
import math
import time
from collections.abc import Sequence
from typing import Any, Protocol, cast

from fastapi import HTTPException, Request, status
from google import genai
from google.genai import types

from app.core.config import (
    EMBEDDING_BATCH_SIZE,
    EMBEDDING_DIMENSION,
    LLM_INITIAL_BACKOFF_SECONDS,
    LLM_MAX_RETRIES,
    MissingSettingsError,
    Settings,
    get_settings,
)


class EmbeddingError(RuntimeError):
    """erro lançado quando o provedor de embeddings falha ou retorna dimensão inválida."""


class EmbeddingClient(Protocol):
    """contrato para geração de vetores de 768 dimensões a partir de trechos de estudo."""

    def embed_texts(self, texts: Sequence[str]) -> list[list[float]]: ...


def normalize_l2(vector: Sequence[float]) -> list[float]:
    """normaliza o vetor pela norma euclidiana para cálculo consistente de cosseno."""
    if len(vector) != EMBEDDING_DIMENSION:
        raise EmbeddingError(
            f"expected embedding dimension {EMBEDDING_DIMENSION}, got {len(vector)}"
        )
    norm = math.sqrt(sum(val * val for val in vector))
    if norm <= 1e-12:
        return [0.0 for _ in vector]
    return [float(val / norm) for val in vector]


class GeminiEmbeddingClient:
    """cliente que gera embeddings de 768 dimensões usando o modelo definido em embedding_model."""

    def __init__(
        self,
        api_key: str,
        model: str,
        *,
        client: Any | None = None,
        batch_size: int = EMBEDDING_BATCH_SIZE,
    ) -> None:
        if not model.strip():
            raise ValueError("embedding model name must not be empty")
        self._model = model.strip()
        self._batch_size = max(1, batch_size)
        self._client = client if client is not None else genai.Client(api_key=api_key)

    def _embed_batch(self, batch: Sequence[str]) -> list[list[float]]:
        # envia apenas o texto bruto do material de estudo conforme a regra de privacidade
        response: Any = None
        last_exc: Exception | None = None
        for attempt in range(LLM_MAX_RETRIES):
            try:
                response = self._client.models.embed_content(
                    model=self._model,
                    contents=list(batch),
                    config=types.EmbedContentConfig(output_dimensionality=EMBEDDING_DIMENSION),
                )
                last_exc = None
                break
            except Exception as exc:
                last_exc = exc
                msg = str(exc).lower()
                is_transient = "429" in msg or "resource_exhausted" in msg or "503" in msg
                if is_transient and attempt + 1 < LLM_MAX_RETRIES:
                    time.sleep(LLM_INITIAL_BACKOFF_SECONDS * (2**attempt))
                    continue
                raise EmbeddingError(f"gemini embedding request failed: {exc}") from exc

        if last_exc is not None:
            raise EmbeddingError(f"gemini embedding request failed: {last_exc}") from last_exc

        raw_embeddings = getattr(response, "embeddings", None)
        if not raw_embeddings or len(raw_embeddings) != len(batch):
            raise EmbeddingError("gemini returned an unexpected number of embeddings")

        vectors: list[list[float]] = []
        for item in raw_embeddings:
            values = getattr(item, "values", None)
            if not isinstance(values, Sequence):
                raise EmbeddingError("gemini embedding item is missing vector values")
            vectors.append(normalize_l2([float(v) for v in values]))
        return vectors

    def embed_texts(self, texts: Sequence[str]) -> list[list[float]]:
        if not texts:
            return []
        results: list[list[float]] = []
        for start in range(0, len(texts), self._batch_size):
            batch = texts[start : start + self._batch_size]
            results.extend(self._embed_batch(batch))
        return results


class DeterministicFakeEmbeddingClient:
    """gerador determinístico de 768 dimensões para testes automatizados sem rede."""

    def embed_texts(self, texts: Sequence[str]) -> list[list[float]]:
        vectors: list[list[float]] = []
        for text in texts:
            digest = hashlib.sha256(text.encode("utf-8")).digest()
            raw = [
                ((digest[i % len(digest)] / 255.0) * 2.0) - 1.0 for i in range(EMBEDDING_DIMENSION)
            ]
            vectors.append(normalize_l2(raw))
        return vectors


def get_embedding_client(request: Request) -> EmbeddingClient:
    """resolve o cliente de embeddings configurado na aplicação ou instancia o cliente gemini."""
    existing = getattr(request.app.state, "embedding_client", None)
    if existing is not None:
        return cast(EmbeddingClient, existing)

    settings: Settings = getattr(request.app.state, "settings", None) or get_settings()
    try:
        settings.require("embeddings")
    except MissingSettingsError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc

    assert settings.gemini_api_key is not None
    assert settings.embedding_model is not None
    client = GeminiEmbeddingClient(
        api_key=settings.gemini_api_key,
        model=settings.embedding_model,
    )
    request.app.state.embedding_client = client
    return client
