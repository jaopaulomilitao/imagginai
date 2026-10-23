"""abstração de provedores llm (gemini e groq) com backoff exponencial e fallback automático."""

import json
import logging
import time
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import Any, Literal, Protocol, cast

import httpx
from fastapi import HTTPException, Request, status
from google import genai
from google.genai import types

from app.core.config import (
    GROQ_API_URL,
    LLM_INITIAL_BACKOFF_SECONDS,
    LLM_MAX_RETRIES,
    MissingSettingsError,
    Settings,
    get_settings,
)
from app.prompts.study_pack_v1 import (
    PROMPT_VERSION,
    SYSTEM_PROMPT,
    PromptChunkInput,
    RawStudyPackExtraction,
    build_extraction_user_prompt,
)

logger = logging.getLogger("imagginai.api.llm")

ProviderName = Literal["gemini", "groq"]


class LlmTransientError(RuntimeError):
    """erro transitório (http 429 ou 5xx) elegível para nova tentativa com backoff."""

    def __init__(self, message: str, status_code: int | None = None) -> None:
        super().__init__(message)
        self.status_code = status_code


class LlmGenerationError(RuntimeError):
    """erro definitivo lançado quando os provedores primário e reserva falham."""


@dataclass(frozen=True)
class LlmExtractionResult:
    """resultado validado da extração do study pack junto aos metadados do modelo utilizado."""

    extraction: RawStudyPackExtraction
    model_used: str
    provider_used: ProviderName
    prompt_version: str = PROMPT_VERSION


class LlmAdapter(Protocol):
    """contrato individual de um adaptador de modelo de linguagem."""

    @property
    def model_name(self) -> str: ...

    @property
    def provider_name(self) -> ProviderName: ...

    def generate_extraction(
        self,
        system_prompt: str,
        user_prompt: str,
    ) -> RawStudyPackExtraction: ...


class LlmProvider(Protocol):
    """contrato de alto nível para extração resiliente de study packs a partir de trechos."""

    def extract_study_pack(
        self,
        chunks: Sequence[PromptChunkInput],
    ) -> LlmExtractionResult: ...


def is_transient_error(exc: Exception) -> bool:
    """identifica erros de limite de taxa (429) ou indisponibilidade temporária (5xx)."""
    if isinstance(exc, LlmTransientError):
        return True
    code = getattr(exc, "code", None) or getattr(exc, "status_code", None)
    if isinstance(code, int) and (code == 429 or 500 <= code < 600):
        return True
    text = str(exc).lower()
    markers = ("429", "resource_exhausted", "rate limit", "500", "502", "503", "504", "overloaded")
    return any(marker in text for marker in markers)


def _strip_markdown_fences(raw_text: str) -> str:
    # remove cercas markdown caso o modelo envolva o json em blocos de código
    cleaned = raw_text.strip()
    if cleaned.startswith("```"):
        lines = cleaned.splitlines()
        if lines and lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip().startswith("```"):
            lines = lines[:-1]
        return "\n".join(lines).strip()
    return cleaned


class GeminiLlmAdapter:
    """adaptador para o gemini flash com saída json estruturada via google-genai."""

    def __init__(
        self,
        api_key: str,
        model: str,
        *,
        client: Any | None = None,
    ) -> None:
        if not model.strip():
            raise ValueError("gemini model name must not be empty")
        self._model = model.strip()
        self._client = client if client is not None else genai.Client(api_key=api_key)

    @property
    def model_name(self) -> str:
        return self._model

    @property
    def provider_name(self) -> ProviderName:
        return "gemini"

    def generate_extraction(
        self,
        system_prompt: str,
        user_prompt: str,
    ) -> RawStudyPackExtraction:
        try:
            response = self._client.models.generate_content(
                model=self._model,
                contents=user_prompt,
                config=types.GenerateContentConfig(
                    system_instruction=system_prompt,
                    response_mime_type="application/json",
                    response_schema=RawStudyPackExtraction,
                    temperature=0.2,
                ),
            )
        except Exception as exc:
            if is_transient_error(exc):
                raise LlmTransientError(f"gemini transient error: {exc}") from exc
            raise LlmGenerationError(f"gemini request failed: {exc}") from exc

        raw_text = getattr(response, "text", None)
        if not isinstance(raw_text, str) or not raw_text.strip():
            raise LlmGenerationError("gemini returned an empty response")
        try:
            return RawStudyPackExtraction.model_validate_json(_strip_markdown_fences(raw_text))
        except Exception as exc:
            raise LlmGenerationError(f"gemini returned invalid json schema: {exc}") from exc


class GroqLlmAdapter:
    """adaptador compatível com openai para o provedor reserva groq."""

    def __init__(
        self,
        api_key: str,
        model: str,
        *,
        api_url: str = GROQ_API_URL,
        http_client: Any | None = None,
        timeout_seconds: float = 60.0,
    ) -> None:
        if not model.strip():
            raise ValueError("fallback model name must not be empty")
        self._api_key = api_key
        self._model = model.strip()
        self._api_url = api_url
        self._http_client = http_client
        self._timeout_seconds = timeout_seconds

    @property
    def model_name(self) -> str:
        return self._model

    @property
    def provider_name(self) -> ProviderName:
        return "groq"

    def _build_schema_instruction(self, system_prompt: str) -> str:
        # injeta o esquema json esperado no prompt do sistema para garantir paridade na groq
        schema_json = json.dumps(RawStudyPackExtraction.model_json_schema(by_alias=True))
        return f"{system_prompt}\n\nJSON Schema obrigatório:\n{schema_json}"

    def _post_chat_completion(self, payload: dict[str, Any]) -> dict[str, Any]:
        headers = {
            "Authorization": f"Bearer {self._api_key}",
            "Content-Type": "application/json",
        }
        if self._http_client is not None:
            response = self._http_client.post(self._api_url, headers=headers, json=payload)
        else:
            with httpx.Client(timeout=self._timeout_seconds) as client:
                response = client.post(self._api_url, headers=headers, json=payload)

        status_code = int(response.status_code)
        if status_code == 429 or 500 <= status_code < 600:
            raise LlmTransientError(
                f"groq transient status {status_code}",
                status_code=status_code,
            )
        if status_code >= 400:
            raise LlmGenerationError(f"groq request failed with status {status_code}")
        return cast(dict[str, Any], response.json())

    def generate_extraction(
        self,
        system_prompt: str,
        user_prompt: str,
    ) -> RawStudyPackExtraction:
        payload = {
            "model": self._model,
            "temperature": 0.2,
            "response_format": {"type": "json_object"},
            "messages": [
                {"role": "system", "content": self._build_schema_instruction(system_prompt)},
                {"role": "user", "content": user_prompt},
            ],
        }
        try:
            data = self._post_chat_completion(payload)
        except (LlmTransientError, LlmGenerationError):
            raise
        except Exception as exc:
            if is_transient_error(exc):
                raise LlmTransientError(f"groq network error: {exc}") from exc
            raise LlmGenerationError(f"groq unexpected error: {exc}") from exc

        try:
            content = data["choices"][0]["message"]["content"]
            return RawStudyPackExtraction.model_validate_json(_strip_markdown_fences(str(content)))
        except Exception as exc:
            raise LlmGenerationError(f"groq returned invalid json schema: {exc}") from exc


class ResilientLlmProvider:
    """orquestra tentativas com backoff exponencial no gemini e fallback automático para groq."""

    def __init__(
        self,
        primary: LlmAdapter,
        fallback: LlmAdapter | None = None,
        *,
        max_retries: int = LLM_MAX_RETRIES,
        initial_backoff_seconds: float = LLM_INITIAL_BACKOFF_SECONDS,
        sleep_fn: Callable[[float], None] = time.sleep,
    ) -> None:
        self._primary = primary
        self._fallback = fallback
        self._max_retries = max(1, max_retries)
        self._initial_backoff = max(0.0, initial_backoff_seconds)
        self._sleep = sleep_fn

    def _run_with_backoff(
        self,
        adapter: LlmAdapter,
        system_prompt: str,
        user_prompt: str,
    ) -> LlmExtractionResult:
        # aplica backoff exponencial apenas em falhas transitórias até o limite configurado
        last_error: Exception | None = None
        for attempt in range(self._max_retries):
            try:
                extraction = adapter.generate_extraction(system_prompt, user_prompt)
                return LlmExtractionResult(
                    extraction=extraction,
                    model_used=adapter.model_name,
                    provider_used=adapter.provider_name,
                    prompt_version=PROMPT_VERSION,
                )
            except Exception as exc:
                last_error = exc
                if not is_transient_error(exc) or attempt + 1 >= self._max_retries:
                    break
                delay = self._initial_backoff * (2**attempt)
                logger.warning(
                    "tentativa %d/%d falhou em %s (%s); aguardando %.2fs",
                    attempt + 1,
                    self._max_retries,
                    adapter.provider_name,
                    exc,
                    delay,
                )
                self._sleep(delay)

        raise LlmGenerationError(
            f"provider {adapter.provider_name} ({adapter.model_name}) failed: {last_error}"
        ) from last_error

    def extract_study_pack(
        self,
        chunks: Sequence[PromptChunkInput],
    ) -> LlmExtractionResult:
        user_prompt = build_extraction_user_prompt(chunks)
        try:
            return self._run_with_backoff(self._primary, SYSTEM_PROMPT, user_prompt)
        except Exception as primary_exc:
            if self._fallback is None:
                raise LlmGenerationError(
                    f"falha ao gerar study pack no provedor primário: {primary_exc}"
                ) from primary_exc
            logger.warning(
                "provedor primário falhou (%s); acionando fallback %s",
                primary_exc,
                self._fallback.provider_name,
            )
            try:
                return self._run_with_backoff(self._fallback, SYSTEM_PROMPT, user_prompt)
            except Exception as fallback_exc:
                raise LlmGenerationError(
                    "não foi possível gerar o study pack nos provedores primário e reserva: "
                    f"primário=({primary_exc}); reserva=({fallback_exc})"
                ) from fallback_exc


def get_llm_provider(request: Request) -> LlmProvider:
    """resolve o provedor de llm configurado na aplicação ou instancia gemini + groq."""
    existing = getattr(request.app.state, "llm_provider", None)
    if existing is not None:
        return cast(LlmProvider, existing)

    settings: Settings = getattr(request.app.state, "settings", None) or get_settings()
    try:
        settings.require("llm")
    except MissingSettingsError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc

    assert settings.gemini_api_key is not None
    assert settings.llm_model is not None
    assert settings.groq_api_key is not None
    assert settings.fallback_llm_model is not None

    primary = GeminiLlmAdapter(api_key=settings.gemini_api_key, model=settings.llm_model)
    fallback = GroqLlmAdapter(api_key=settings.groq_api_key, model=settings.fallback_llm_model)
    provider = ResilientLlmProvider(primary=primary, fallback=fallback)
    request.app.state.llm_provider = provider
    return provider
