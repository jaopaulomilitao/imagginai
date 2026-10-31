"""camada de acesso a dados e storage do supabase com implementação em memória para testes."""

import json
from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any, Protocol, cast
from uuid import uuid4

from fastapi import HTTPException, Request, status
from supabase import Client, create_client

from app.core.config import (
    STORAGE_PACKS_BUCKET,
    STORAGE_SOURCES_BUCKET,
    MissingSettingsError,
    Settings,
    get_settings,
)
from app.schemas.jobs import JobStatus
from app.schemas.study_pack import StudyPack, parse_study_pack
from app.schemas.zones import EnvironmentPreset, PanelLayoutSchema


def _utc_now_iso() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


def _parse_embedding_column(raw: Any) -> list[float]:
    # converte o vetor retornado pelo postgrest/pgvector (string json ou lista) em lista de floats
    if raw is None:
        return []
    if isinstance(raw, str):
        parsed = json.loads(raw)
        return [float(val) for val in parsed] if isinstance(parsed, list) else []
    if isinstance(raw, Sequence):
        return [float(val) for val in raw]
    return []


@dataclass(frozen=True)
class ZoneRecord:
    """registro de zona persistido no banco de dados."""

    id: str
    user_id: str
    name: str
    environment: EnvironmentPreset
    source_ids: list[str]
    pack_id: str | None
    layout: list[PanelLayoutSchema]
    created_at: str
    updated_at: str


@dataclass(frozen=True)
class SourceRecord:
    """registro de documento pdf vinculado a uma zona."""

    id: str
    user_id: str
    zone_id: str
    title: str
    storage_path: str
    page_count: int
    size_bytes: int
    created_at: str


@dataclass(frozen=True)
class ChunkInsertRecord:
    """dados de entrada para gravação de um trecho com embedding na tabela chunks."""

    id: str
    user_id: str
    zone_id: str
    source_id: str
    page: int
    chunk_index: int
    content: str
    token_count: int
    embedding: list[float]


@dataclass(frozen=True)
class ChunkRecord(ChunkInsertRecord):
    """trecho textual indexado com vetor de 768 dimensões."""

    created_at: str = field(default_factory=_utc_now_iso)


@dataclass(frozen=True)
class JobRecord:
    """estado atual de um job de ingestão ou geração em segundo plano."""

    id: str
    user_id: str
    zone_id: str
    status: JobStatus
    progress: int
    message: str | None
    created_at: str
    updated_at: str


@dataclass(frozen=True)
class PackRecord:
    """metadados de um study pack armazenado no bucket privado packs."""

    id: str
    user_id: str
    zone_id: str
    storage_path: str
    schema_version: str
    prompt_version: str
    model: str
    discarded: int
    created_at: str


@dataclass(frozen=True)
class SessionAggregateRecord:
    """agregado anônimo de telemetria persistido na tabela session_aggregates."""

    id: str
    user_id: str
    zone_id: str
    session_id: str
    payload: dict[str, Any]
    created_at: str


class DatabaseStore(Protocol):
    """contrato de persistência desacoplado do cliente externo para permitir mocks nos testes."""

    def create_zone(
        self,
        user_id: str,
        name: str,
        environment: EnvironmentPreset,
    ) -> ZoneRecord: ...

    def list_zones(self, user_id: str) -> list[ZoneRecord]: ...

    def get_zone(self, user_id: str, zone_id: str) -> ZoneRecord | None: ...

    def update_zone(
        self,
        user_id: str,
        zone_id: str,
        *,
        name: str | None = None,
        environment: EnvironmentPreset | None = None,
        layout: list[PanelLayoutSchema] | None = None,
    ) -> ZoneRecord | None: ...

    def delete_zone(self, user_id: str, zone_id: str) -> bool: ...

    def upload_source_pdf(
        self,
        user_id: str,
        zone_id: str,
        source_id: str,
        pdf_bytes: bytes,
    ) -> str: ...

    def create_source(
        self,
        user_id: str,
        zone_id: str,
        source_id: str,
        title: str,
        storage_path: str,
        page_count: int,
        size_bytes: int,
    ) -> SourceRecord: ...

    def list_sources_for_zone(self, user_id: str, zone_id: str) -> list[SourceRecord]: ...

    def insert_chunks(self, chunks: Sequence[ChunkInsertRecord]) -> list[ChunkRecord]: ...

    def list_chunks_for_zone(self, user_id: str, zone_id: str) -> list[ChunkRecord]: ...

    def create_job(
        self,
        user_id: str,
        zone_id: str,
        message: str | None = None,
    ) -> JobRecord: ...

    def update_job(
        self,
        job_id: str,
        *,
        status: JobStatus | None = None,
        progress: int | None = None,
        message: str | None = None,
    ) -> JobRecord: ...

    def get_job(self, user_id: str, job_id: str) -> JobRecord | None: ...

    def save_study_pack(
        self,
        user_id: str,
        zone_id: str,
        pack: StudyPack,
    ) -> PackRecord: ...

    def get_zone_study_pack(
        self,
        user_id: str,
        zone_id: str,
    ) -> StudyPack | None: ...

    def upsert_session_aggregate(
        self,
        user_id: str,
        zone_id: str,
        session_id: str,
        payload: dict[str, Any],
    ) -> SessionAggregateRecord: ...

    def list_session_aggregates(
        self,
        user_id: str,
        zone_id: str | None = None,
    ) -> list[SessionAggregateRecord]: ...

    def delete_all_user_data(self, user_id: str) -> None: ...


def _parse_layout_json(raw_layout: Any) -> list[PanelLayoutSchema]:
    # converte a lista jsonb retornada pelo banco nos esquemas validados de layout
    if not isinstance(raw_layout, list):
        return []
    return [PanelLayoutSchema.model_validate(item) for item in raw_layout]


def _serialize_layout_json(layout: Sequence[PanelLayoutSchema]) -> list[dict[str, Any]]:
    return [item.model_dump(by_alias=True) for item in layout]


def _row_to_zone(row: dict[str, Any], source_ids: list[str]) -> ZoneRecord:
    return ZoneRecord(
        id=str(row["id"]),
        user_id=str(row["user_id"]),
        name=str(row["name"]),
        environment=cast(EnvironmentPreset, row["environment"]),
        source_ids=source_ids,
        pack_id=str(row["pack_id"]) if row.get("pack_id") else None,
        layout=_parse_layout_json(row.get("layout", [])),
        created_at=str(row["created_at"]),
        updated_at=str(row["updated_at"]),
    )


def _row_to_job(row: dict[str, Any]) -> JobRecord:
    return JobRecord(
        id=str(row["id"]),
        user_id=str(row["user_id"]),
        zone_id=str(row["zone_id"]),
        status=cast(JobStatus, row["status"]),
        progress=int(row["progress"]),
        message=str(row["message"]) if row.get("message") is not None else None,
        created_at=str(row["created_at"]),
        updated_at=str(row["updated_at"]),
    )


class SupabaseStore:
    """implementação concreta de persistência usando postgres e storage do supabase."""

    def __init__(self, client: Client) -> None:
        self._client = client

    def _source_ids_by_zone(self, user_id: str) -> dict[str, list[str]]:
        response = (
            self._client.table("sources")
            .select("id, zone_id")
            .eq("user_id", user_id)
            .order("created_at")
            .execute()
        )
        mapping: dict[str, list[str]] = {}
        for row in cast(list[dict[str, Any]], response.data or []):
            zone_id = str(row["zone_id"])
            mapping.setdefault(zone_id, []).append(str(row["id"]))
        return mapping

    def create_zone(
        self,
        user_id: str,
        name: str,
        environment: EnvironmentPreset,
    ) -> ZoneRecord:
        payload = {
            "user_id": user_id,
            "name": name,
            "environment": environment,
            "layout": [],
        }
        response = self._client.table("zones").insert(payload).execute()
        rows = cast(list[dict[str, Any]], response.data or [])
        return _row_to_zone(rows[0], [])

    def list_zones(self, user_id: str) -> list[ZoneRecord]:
        response = (
            self._client.table("zones")
            .select("*")
            .eq("user_id", user_id)
            .order("created_at")
            .execute()
        )
        sources_map = self._source_ids_by_zone(user_id)
        rows = cast(list[dict[str, Any]], response.data or [])
        return [_row_to_zone(row, sources_map.get(str(row["id"]), [])) for row in rows]

    def get_zone(self, user_id: str, zone_id: str) -> ZoneRecord | None:
        response = (
            self._client.table("zones")
            .select("*")
            .eq("user_id", user_id)
            .eq("id", zone_id)
            .execute()
        )
        rows = cast(list[dict[str, Any]], response.data or [])
        if not rows:
            return None
        sources_map = self._source_ids_by_zone(user_id)
        return _row_to_zone(rows[0], sources_map.get(zone_id, []))

    def update_zone(
        self,
        user_id: str,
        zone_id: str,
        *,
        name: str | None = None,
        environment: EnvironmentPreset | None = None,
        layout: list[PanelLayoutSchema] | None = None,
    ) -> ZoneRecord | None:
        updates: dict[str, Any] = {}
        if name is not None:
            updates["name"] = name
        if environment is not None:
            updates["environment"] = environment
        if layout is not None:
            updates["layout"] = _serialize_layout_json(layout)
        if not updates:
            return self.get_zone(user_id, zone_id)

        response = (
            self._client.table("zones")
            .update(updates)
            .eq("user_id", user_id)
            .eq("id", zone_id)
            .execute()
        )
        rows = cast(list[dict[str, Any]], response.data or [])
        if not rows:
            return None
        sources_map = self._source_ids_by_zone(user_id)
        return _row_to_zone(rows[0], sources_map.get(zone_id, []))

    def delete_zone(self, user_id: str, zone_id: str) -> bool:
        existing = self.get_zone(user_id, zone_id)
        if existing is None:
            return False
        sources = self.list_sources_for_zone(user_id, zone_id)
        paths = [source.storage_path for source in sources if source.storage_path]
        if paths:
            self._client.storage.from_(STORAGE_SOURCES_BUCKET).remove(paths)
        self._client.table("zones").delete().eq("user_id", user_id).eq("id", zone_id).execute()
        return True

    def upload_source_pdf(
        self,
        user_id: str,
        zone_id: str,
        source_id: str,
        pdf_bytes: bytes,
    ) -> str:
        # organiza o caminho pelo user_id no primeiro segmento conforme a política rls do storage
        storage_path = f"{user_id}/{zone_id}/{source_id}.pdf"
        self._client.storage.from_(STORAGE_SOURCES_BUCKET).upload(
            path=storage_path,
            file=pdf_bytes,
            file_options={"content-type": "application/pdf", "upsert": "true"},
        )
        return storage_path

    def create_source(
        self,
        user_id: str,
        zone_id: str,
        source_id: str,
        title: str,
        storage_path: str,
        page_count: int,
        size_bytes: int,
    ) -> SourceRecord:
        payload = {
            "id": source_id,
            "user_id": user_id,
            "zone_id": zone_id,
            "title": title,
            "storage_path": storage_path,
            "page_count": page_count,
            "size_bytes": size_bytes,
        }
        response = self._client.table("sources").insert(payload).execute()
        row = cast(list[dict[str, Any]], response.data or [])[0]
        return SourceRecord(
            id=str(row["id"]),
            user_id=str(row["user_id"]),
            zone_id=str(row["zone_id"]),
            title=str(row["title"]),
            storage_path=str(row["storage_path"]),
            page_count=int(row["page_count"]),
            size_bytes=int(row["size_bytes"]),
            created_at=str(row["created_at"]),
        )

    def list_sources_for_zone(self, user_id: str, zone_id: str) -> list[SourceRecord]:
        response = (
            self._client.table("sources")
            .select("*")
            .eq("user_id", user_id)
            .eq("zone_id", zone_id)
            .order("created_at")
            .execute()
        )
        rows = cast(list[dict[str, Any]], response.data or [])
        return [
            SourceRecord(
                id=str(row["id"]),
                user_id=str(row["user_id"]),
                zone_id=str(row["zone_id"]),
                title=str(row["title"]),
                storage_path=str(row["storage_path"]),
                page_count=int(row["page_count"]),
                size_bytes=int(row["size_bytes"]),
                created_at=str(row["created_at"]),
            )
            for row in rows
        ]

    def insert_chunks(self, chunks: Sequence[ChunkInsertRecord]) -> list[ChunkRecord]:
        if not chunks:
            return []
        payload = [
            {
                "id": item.id,
                "user_id": item.user_id,
                "zone_id": item.zone_id,
                "source_id": item.source_id,
                "page": item.page,
                "chunk_index": item.chunk_index,
                "content": item.content,
                "token_count": item.token_count,
                "embedding": item.embedding,
            }
            for item in chunks
        ]
        response = self._client.table("chunks").insert(payload).execute()
        rows = cast(list[dict[str, Any]], response.data or [])
        created_by_id = {str(r["id"]): str(r.get("created_at", _utc_now_iso())) for r in rows}
        return [
            ChunkRecord(
                id=item.id,
                user_id=item.user_id,
                zone_id=item.zone_id,
                source_id=item.source_id,
                page=item.page,
                chunk_index=item.chunk_index,
                content=item.content,
                token_count=item.token_count,
                embedding=list(item.embedding),
                created_at=created_by_id.get(item.id, _utc_now_iso()),
            )
            for item in chunks
        ]

    def list_chunks_for_zone(self, user_id: str, zone_id: str) -> list[ChunkRecord]:
        response = (
            self._client.table("chunks")
            .select("*")
            .eq("user_id", user_id)
            .eq("zone_id", zone_id)
            .order("chunk_index")
            .execute()
        )
        rows = cast(list[dict[str, Any]], response.data or [])
        return [
            ChunkRecord(
                id=str(row["id"]),
                user_id=str(row["user_id"]),
                zone_id=str(row["zone_id"]),
                source_id=str(row["source_id"]),
                page=int(row["page"]),
                chunk_index=int(row["chunk_index"]),
                content=str(row["content"]),
                token_count=int(row["token_count"]),
                embedding=_parse_embedding_column(row.get("embedding")),
                created_at=str(row["created_at"]),
            )
            for row in rows
        ]

    def create_job(
        self,
        user_id: str,
        zone_id: str,
        message: str | None = None,
    ) -> JobRecord:
        payload = {
            "user_id": user_id,
            "zone_id": zone_id,
            "status": "queued",
            "progress": 0,
            "message": message,
        }
        response = self._client.table("jobs").insert(payload).execute()
        row = cast(list[dict[str, Any]], response.data or [])[0]
        return _row_to_job(row)

    def update_job(
        self,
        job_id: str,
        *,
        status: JobStatus | None = None,
        progress: int | None = None,
        message: str | None = None,
    ) -> JobRecord:
        updates: dict[str, Any] = {}
        if status is not None:
            updates["status"] = status
        if progress is not None:
            updates["progress"] = progress
        if message is not None:
            updates["message"] = message
        response = self._client.table("jobs").update(updates).eq("id", job_id).execute()
        row = cast(list[dict[str, Any]], response.data or [])[0]
        return _row_to_job(row)

    def get_job(self, user_id: str, job_id: str) -> JobRecord | None:
        response = (
            self._client.table("jobs").select("*").eq("user_id", user_id).eq("id", job_id).execute()
        )
        rows = cast(list[dict[str, Any]], response.data or [])
        if not rows:
            return None
        return _row_to_job(rows[0])

    def save_study_pack(
        self,
        user_id: str,
        zone_id: str,
        pack: StudyPack,
    ) -> PackRecord:
        storage_path = f"{user_id}/{zone_id}/{pack.pack_id}.json"
        raw_bytes = pack.model_dump_json(by_alias=True).encode("utf-8")
        self._client.storage.from_(STORAGE_PACKS_BUCKET).upload(
            path=storage_path,
            file=raw_bytes,
            file_options={"content-type": "application/json", "upsert": "true"},
        )
        payload = {
            "id": pack.pack_id,
            "user_id": user_id,
            "zone_id": zone_id,
            "storage_path": storage_path,
            "schema_version": pack.schema_version,
            "prompt_version": pack.meta.prompt_version,
            "model": pack.meta.model,
            "discarded": pack.meta.discarded,
        }
        response = self._client.table("packs").upsert(payload, on_conflict="id").execute()
        row = cast(list[dict[str, Any]], response.data or [])[0]
        self._client.table("zones").update({"pack_id": pack.pack_id}).eq("user_id", user_id).eq(
            "id", zone_id
        ).execute()
        return PackRecord(
            id=str(row["id"]),
            user_id=str(row["user_id"]),
            zone_id=str(row["zone_id"]),
            storage_path=str(row["storage_path"]),
            schema_version=str(row["schema_version"]),
            prompt_version=str(row["prompt_version"]),
            model=str(row["model"]),
            discarded=int(row["discarded"]),
            created_at=str(row["created_at"]),
        )

    def get_zone_study_pack(
        self,
        user_id: str,
        zone_id: str,
    ) -> StudyPack | None:
        response = (
            self._client.table("packs")
            .select("*")
            .eq("user_id", user_id)
            .eq("zone_id", zone_id)
            .order("created_at", desc=True)
            .limit(1)
            .execute()
        )
        rows = cast(list[dict[str, Any]], response.data or [])
        if not rows:
            return None
        storage_path = str(rows[0]["storage_path"])
        raw_bytes = self._client.storage.from_(STORAGE_PACKS_BUCKET).download(storage_path)
        return parse_study_pack(raw_bytes)

    def upsert_session_aggregate(
        self,
        user_id: str,
        zone_id: str,
        session_id: str,
        payload: dict[str, Any],
    ) -> SessionAggregateRecord:
        # grava o agregado de sessão de forma idempotente pela restrição única (user_id, session_id)
        row_payload = {
            "user_id": user_id,
            "zone_id": zone_id,
            "session_id": session_id,
            "payload": payload,
        }
        response = (
            self._client.table("session_aggregates")
            .upsert(row_payload, on_conflict="user_id,session_id")
            .execute()
        )
        rows = cast(list[dict[str, Any]], response.data or [])
        row = rows[0]
        return SessionAggregateRecord(
            id=str(row["id"]),
            user_id=str(row["user_id"]),
            zone_id=str(row["zone_id"]),
            session_id=str(row["session_id"]),
            payload=cast(dict[str, Any], row.get("payload", {})),
            created_at=str(row["created_at"]),
        )

    def list_session_aggregates(
        self,
        user_id: str,
        zone_id: str | None = None,
    ) -> list[SessionAggregateRecord]:
        query = self._client.table("session_aggregates").select("*").eq("user_id", user_id)
        if zone_id is not None:
            query = query.eq("zone_id", zone_id)
        response = query.order("created_at", desc=True).execute()
        rows = cast(list[dict[str, Any]], response.data or [])
        return [
            SessionAggregateRecord(
                id=str(row["id"]),
                user_id=str(row["user_id"]),
                zone_id=str(row["zone_id"]),
                session_id=str(row["session_id"]),
                payload=cast(dict[str, Any], row.get("payload", {})),
                created_at=str(row["created_at"]),
            )
            for row in rows
        ]

    def delete_all_user_data(self, user_id: str) -> None:
        # remove os arquivos do storage e apaga todas as linhas do usuário em todas as tabelas
        sources_resp = (
            self._client.table("sources").select("storage_path").eq("user_id", user_id).execute()
        )
        source_paths = [
            str(r["storage_path"])
            for r in cast(list[dict[str, Any]], sources_resp.data or [])
            if r.get("storage_path")
        ]
        if source_paths:
            self._client.storage.from_(STORAGE_SOURCES_BUCKET).remove(source_paths)

        packs_resp = (
            self._client.table("packs").select("storage_path").eq("user_id", user_id).execute()
        )
        pack_paths = [
            str(r["storage_path"])
            for r in cast(list[dict[str, Any]], packs_resp.data or [])
            if r.get("storage_path")
        ]
        if pack_paths:
            self._client.storage.from_(STORAGE_PACKS_BUCKET).remove(pack_paths)

        for table_name in (
            "session_aggregates",
            "consents",
            "jobs",
            "chunks",
            "sources",
            "packs",
            "zones",
        ):
            self._client.table(table_name).delete().eq("user_id", user_id).execute()


class InMemoryStore:
    """armazenamento em memória usado em testes automatizados sem chamadas de rede."""

    def __init__(self) -> None:
        self.zones: dict[str, ZoneRecord] = {}
        self.sources: dict[str, SourceRecord] = {}
        self.chunks: list[ChunkRecord] = []
        self.jobs: dict[str, JobRecord] = {}
        self.packs: dict[str, PackRecord] = {}
        self.session_aggregates: dict[tuple[str, str], SessionAggregateRecord] = {}
        self.storage_objects: dict[str, bytes] = {}

    def _zone_source_ids(self, user_id: str, zone_id: str) -> list[str]:
        return [
            src.id
            for src in self.sources.values()
            if src.user_id == user_id and src.zone_id == zone_id
        ]

    def create_zone(
        self,
        user_id: str,
        name: str,
        environment: EnvironmentPreset,
    ) -> ZoneRecord:
        now = _utc_now_iso()
        zone = ZoneRecord(
            id=str(uuid4()),
            user_id=user_id,
            name=name,
            environment=environment,
            source_ids=[],
            pack_id=None,
            layout=[],
            created_at=now,
            updated_at=now,
        )
        self.zones[zone.id] = zone
        return zone

    def list_zones(self, user_id: str) -> list[ZoneRecord]:
        return [
            ZoneRecord(
                id=zone.id,
                user_id=zone.user_id,
                name=zone.name,
                environment=zone.environment,
                source_ids=self._zone_source_ids(user_id, zone.id),
                pack_id=zone.pack_id,
                layout=list(zone.layout),
                created_at=zone.created_at,
                updated_at=zone.updated_at,
            )
            for zone in self.zones.values()
            if zone.user_id == user_id
        ]

    def get_zone(self, user_id: str, zone_id: str) -> ZoneRecord | None:
        zone = self.zones.get(zone_id)
        if zone is None or zone.user_id != user_id:
            return None
        return ZoneRecord(
            id=zone.id,
            user_id=zone.user_id,
            name=zone.name,
            environment=zone.environment,
            source_ids=self._zone_source_ids(user_id, zone.id),
            pack_id=zone.pack_id,
            layout=list(zone.layout),
            created_at=zone.created_at,
            updated_at=zone.updated_at,
        )

    def update_zone(
        self,
        user_id: str,
        zone_id: str,
        *,
        name: str | None = None,
        environment: EnvironmentPreset | None = None,
        layout: list[PanelLayoutSchema] | None = None,
    ) -> ZoneRecord | None:
        current = self.get_zone(user_id, zone_id)
        if current is None:
            return None
        updated = ZoneRecord(
            id=current.id,
            user_id=current.user_id,
            name=name if name is not None else current.name,
            environment=environment if environment is not None else current.environment,
            source_ids=current.source_ids,
            pack_id=current.pack_id,
            layout=list(layout) if layout is not None else current.layout,
            created_at=current.created_at,
            updated_at=_utc_now_iso(),
        )
        self.zones[zone_id] = updated
        return updated

    def delete_zone(self, user_id: str, zone_id: str) -> bool:
        current = self.get_zone(user_id, zone_id)
        if current is None:
            return False
        del self.zones[zone_id]
        removed_sources = [s.id for s in self.sources.values() if s.zone_id == zone_id]
        for source_id in removed_sources:
            path = self.sources[source_id].storage_path
            self.storage_objects.pop(path, None)
            del self.sources[source_id]
        self.chunks = [chunk for chunk in self.chunks if chunk.zone_id != zone_id]
        removed_jobs = [j.id for j in self.jobs.values() if j.zone_id == zone_id]
        for job_id in removed_jobs:
            del self.jobs[job_id]
        return True

    def upload_source_pdf(
        self,
        user_id: str,
        zone_id: str,
        source_id: str,
        pdf_bytes: bytes,
    ) -> str:
        storage_path = f"{user_id}/{zone_id}/{source_id}.pdf"
        self.storage_objects[storage_path] = pdf_bytes
        return storage_path

    def create_source(
        self,
        user_id: str,
        zone_id: str,
        source_id: str,
        title: str,
        storage_path: str,
        page_count: int,
        size_bytes: int,
    ) -> SourceRecord:
        record = SourceRecord(
            id=source_id,
            user_id=user_id,
            zone_id=zone_id,
            title=title,
            storage_path=storage_path,
            page_count=page_count,
            size_bytes=size_bytes,
            created_at=_utc_now_iso(),
        )
        self.sources[source_id] = record
        return record

    def list_sources_for_zone(self, user_id: str, zone_id: str) -> list[SourceRecord]:
        return [
            src
            for src in self.sources.values()
            if src.user_id == user_id and src.zone_id == zone_id
        ]

    def insert_chunks(self, chunks: Sequence[ChunkInsertRecord]) -> list[ChunkRecord]:
        now = _utc_now_iso()
        records = [
            ChunkRecord(
                id=item.id,
                user_id=item.user_id,
                zone_id=item.zone_id,
                source_id=item.source_id,
                page=item.page,
                chunk_index=item.chunk_index,
                content=item.content,
                token_count=item.token_count,
                embedding=list(item.embedding),
                created_at=now,
            )
            for item in chunks
        ]
        self.chunks.extend(records)
        return records

    def list_chunks_for_zone(self, user_id: str, zone_id: str) -> list[ChunkRecord]:
        return [
            chunk for chunk in self.chunks if chunk.user_id == user_id and chunk.zone_id == zone_id
        ]

    def create_job(
        self,
        user_id: str,
        zone_id: str,
        message: str | None = None,
    ) -> JobRecord:
        now = _utc_now_iso()
        record = JobRecord(
            id=str(uuid4()),
            user_id=user_id,
            zone_id=zone_id,
            status="queued",
            progress=0,
            message=message,
            created_at=now,
            updated_at=now,
        )
        self.jobs[record.id] = record
        return record

    def update_job(
        self,
        job_id: str,
        *,
        status: JobStatus | None = None,
        progress: int | None = None,
        message: str | None = None,
    ) -> JobRecord:
        current = self.jobs[job_id]
        updated = JobRecord(
            id=current.id,
            user_id=current.user_id,
            zone_id=current.zone_id,
            status=status if status is not None else current.status,
            progress=progress if progress is not None else current.progress,
            message=message if message is not None else current.message,
            created_at=current.created_at,
            updated_at=_utc_now_iso(),
        )
        self.jobs[job_id] = updated
        return updated

    def get_job(self, user_id: str, job_id: str) -> JobRecord | None:
        record = self.jobs.get(job_id)
        if record is None or record.user_id != user_id:
            return None
        return record

    def save_study_pack(
        self,
        user_id: str,
        zone_id: str,
        pack: StudyPack,
    ) -> PackRecord:
        storage_path = f"{user_id}/{zone_id}/{pack.pack_id}.json"
        self.storage_objects[storage_path] = pack.model_dump_json(by_alias=True).encode("utf-8")
        record = PackRecord(
            id=pack.pack_id,
            user_id=user_id,
            zone_id=zone_id,
            storage_path=storage_path,
            schema_version=pack.schema_version,
            prompt_version=pack.meta.prompt_version,
            model=pack.meta.model,
            discarded=pack.meta.discarded,
            created_at=_utc_now_iso(),
        )
        self.packs[record.id] = record
        existing_zone = self.zones.get(zone_id)
        if existing_zone is not None and existing_zone.user_id == user_id:
            self.zones[zone_id] = ZoneRecord(
                id=existing_zone.id,
                user_id=existing_zone.user_id,
                name=existing_zone.name,
                environment=existing_zone.environment,
                source_ids=self._zone_source_ids(user_id, zone_id),
                pack_id=pack.pack_id,
                layout=list(existing_zone.layout),
                created_at=existing_zone.created_at,
                updated_at=_utc_now_iso(),
            )
        return record

    def get_zone_study_pack(
        self,
        user_id: str,
        zone_id: str,
    ) -> StudyPack | None:
        zone_packs = [
            p for p in self.packs.values() if p.user_id == user_id and p.zone_id == zone_id
        ]
        if not zone_packs:
            return None
        latest = zone_packs[-1]
        raw_bytes = self.storage_objects.get(latest.storage_path)
        if raw_bytes is None:
            return None
        return parse_study_pack(raw_bytes)

    def upsert_session_aggregate(
        self,
        user_id: str,
        zone_id: str,
        session_id: str,
        payload: dict[str, Any],
    ) -> SessionAggregateRecord:
        key = (user_id, session_id)
        existing = self.session_aggregates.get(key)
        record = SessionAggregateRecord(
            id=existing.id if existing is not None else str(uuid4()),
            user_id=user_id,
            zone_id=zone_id,
            session_id=session_id,
            payload=dict(payload),
            created_at=existing.created_at if existing is not None else _utc_now_iso(),
        )
        self.session_aggregates[key] = record
        return record

    def list_session_aggregates(
        self,
        user_id: str,
        zone_id: str | None = None,
    ) -> list[SessionAggregateRecord]:
        items = [
            rec
            for rec in self.session_aggregates.values()
            if rec.user_id == user_id and (zone_id is None or rec.zone_id == zone_id)
        ]
        items.sort(key=lambda r: r.created_at, reverse=True)
        return items

    def delete_all_user_data(self, user_id: str) -> None:
        user_zone_ids = [z.id for z in self.zones.values() if z.user_id == user_id]
        for zid in user_zone_ids:
            self.delete_zone(user_id, zid)
        pack_ids = [p.id for p in self.packs.values() if p.user_id == user_id]
        for pid in pack_ids:
            path = self.packs[pid].storage_path
            self.storage_objects.pop(path, None)
            del self.packs[pid]
        agg_keys = [k for k, v in self.session_aggregates.items() if v.user_id == user_id]
        for key in agg_keys:
            del self.session_aggregates[key]


def get_db_store(request: Request) -> DatabaseStore:
    """resolve o repositório configurado na aplicação ou instancia o cliente supabase."""
    existing_store = getattr(request.app.state, "db_store", None)
    if existing_store is not None:
        return cast(DatabaseStore, existing_store)

    settings: Settings = getattr(request.app.state, "settings", None) or get_settings()
    try:
        settings.require("supabase")
    except MissingSettingsError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc

    assert settings.supabase_url is not None
    assert settings.supabase_service_role_key is not None
    client = create_client(settings.supabase_url, settings.supabase_service_role_key)
    store = SupabaseStore(client)
    request.app.state.db_store = store
    return store
