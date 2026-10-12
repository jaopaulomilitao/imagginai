"""esquemas pydantic para acompanhamento de jobs de ingestão e geração (seção 3.10)."""

from typing import Literal

from pydantic import Field

from app.core.config import JOB_PROGRESS_MAX, JOB_PROGRESS_MIN
from app.schemas.zones import CamelModel

JobStatus = Literal["queued", "running", "done", "failed"]


class JobResponse(CamelModel):
    id: str
    zone_id: str
    status: JobStatus
    progress: int = Field(ge=JOB_PROGRESS_MIN, le=JOB_PROGRESS_MAX)
    message: str | None = None
