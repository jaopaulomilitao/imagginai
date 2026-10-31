import { zoneStorage, type LayoutRepository } from '../../shared/storage/dexie-db';
import type { StudyCard, StudyPack } from '../../shared/types/study-pack';
import type { SessionAggregateEnvelope } from '../../shared/types/telemetry';
import type { PanelLayout, Zone } from '../../shared/types/zone';
import { validateStudyPack } from '../../shared/validation/study-pack-validator';
import type { EnvironmentPreset } from '../../zone/config/constants';
import { containsForbiddenTelemetryField } from '../../zone/systems/telemetry-aggregator';
import { getAccessToken } from './supabase-client';

export interface JobStatusResponse {
  id: string;
  zoneId: string;
  status: 'queued' | 'running' | 'done' | 'failed';
  progress: number;
  message: string | null;
}

export interface SourceUploadResponse {
  jobId: string;
  sourceId: string;
  title: string;
  pageCount: number;
}

function getApiBaseUrl(): string {
  const raw = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? 'http://localhost:8000';
  return raw.trim().replace(/\/+$/, '');
}

async function buildAuthHeaders(includeJsonContentType = true): Promise<Record<string, string>> {
  const token = await getAccessToken();
  if (!token) {
    throw new Error('Sessão autenticada necessária para comunicar com a API.');
  }
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
  };
  if (includeJsonContentType) {
    headers['Content-Type'] = 'application/json';
  }
  return headers;
}

async function readErrorDetail(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { detail?: unknown };
    if (typeof body?.detail === 'string') return body.detail;
    return JSON.stringify(body);
  } catch {
    return `Erro HTTP ${response.status}`;
  }
}

export async function fetchZonesRemote(): Promise<Zone[]> {
  const headers = await buildAuthHeaders();
  const response = await fetch(`${getApiBaseUrl()}/zones`, { headers });
  if (!response.ok) {
    throw new Error(await readErrorDetail(response));
  }
  return (await response.json()) as Zone[];
}

export async function createZoneRemote(input: {
  name: string;
  environment: EnvironmentPreset;
}): Promise<Zone> {
  const headers = await buildAuthHeaders();
  const response = await fetch(`${getApiBaseUrl()}/zones`, {
    method: 'POST',
    headers,
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    throw new Error(await readErrorDetail(response));
  }
  return (await response.json()) as Zone;
}

export async function updateZoneRemote(
  zoneId: string,
  patch: { name?: string; environment?: EnvironmentPreset; layout?: PanelLayout[] },
): Promise<Zone> {
  const headers = await buildAuthHeaders();
  const response = await fetch(`${getApiBaseUrl()}/zones/${encodeURIComponent(zoneId)}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(patch),
  });
  if (!response.ok) {
    throw new Error(await readErrorDetail(response));
  }
  return (await response.json()) as Zone;
}

export async function deleteZoneRemote(zoneId: string): Promise<void> {
  const headers = await buildAuthHeaders(false);
  const response = await fetch(`${getApiBaseUrl()}/zones/${encodeURIComponent(zoneId)}`, {
    method: 'DELETE',
    headers,
  });
  if (!response.ok && response.status !== 404) {
    throw new Error(await readErrorDetail(response));
  }
}

export async function uploadZoneSourcePdf(
  zoneId: string,
  file: File,
  title?: string,
): Promise<SourceUploadResponse> {
  const headers = await buildAuthHeaders(false);
  const form = new FormData();
  form.append('file', file);
  if (title && title.trim().length > 0) {
    form.append('title', title.trim());
  }
  const response = await fetch(`${getApiBaseUrl()}/zones/${encodeURIComponent(zoneId)}/sources`, {
    method: 'POST',
    headers,
    body: form,
  });
  if (!response.ok) {
    throw new Error(await readErrorDetail(response));
  }
  return (await response.json()) as SourceUploadResponse;
}

export async function fetchJobStatus(jobId: string): Promise<JobStatusResponse> {
  const headers = await buildAuthHeaders(false);
  const response = await fetch(`${getApiBaseUrl()}/jobs/${encodeURIComponent(jobId)}`, {
    headers,
  });
  if (!response.ok) {
    throw new Error(await readErrorDetail(response));
  }
  return (await response.json()) as JobStatusResponse;
}

export async function fetchZoneStudyPack(zoneId: string): Promise<StudyPack> {
  const headers = await buildAuthHeaders(false);
  const response = await fetch(`${getApiBaseUrl()}/zones/${encodeURIComponent(zoneId)}/pack`, {
    headers,
  });
  if (!response.ok) {
    throw new Error(await readErrorDetail(response));
  }
  const raw: unknown = await response.json();
  const validated = validateStudyPack(raw);
  if (!validated.ok) {
    throw new Error(`StudyPack inválido retornado pela API: ${validated.errors.join('; ')}`);
  }
  return validated.pack;
}

// adiciona e persiste um flashcard no study pack remoto vinculado à conta autenticada
export async function saveZoneCardRemote(zoneId: string, card: StudyCard): Promise<StudyPack> {
  const headers = await buildAuthHeaders(true);
  const response = await fetch(`${getApiBaseUrl()}/zones/${encodeURIComponent(zoneId)}/cards`, {
    method: 'POST',
    headers,
    body: JSON.stringify(card),
  });
  if (!response.ok) {
    throw new Error(await readErrorDetail(response));
  }
  const raw: unknown = await response.json();
  const validated = validateStudyPack(raw);
  if (!validated.ok) {
    throw new Error(`StudyPack inválido retornado pela API: ${validated.errors.join('; ')}`);
  }
  return validated.pack;
}

export async function submitTelemetryAggregateRemote(
  envelope: SessionAggregateEnvelope,
): Promise<void> {
  if (containsForbiddenTelemetryField(envelope)) {
    throw new Error('Campos proibidos detectados no agregado de telemetria.');
  }
  const headers = await buildAuthHeaders();
  const response = await fetch(`${getApiBaseUrl()}/telemetry/aggregates`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      sessionId: envelope.sessionId,
      zoneId: envelope.zoneId,
      payload: envelope.payload,
    }),
  });
  if (!response.ok) {
    throw new Error(await readErrorDetail(response));
  }
}

// sincroniza a fila offline de agregados de telemetria somente quando o consentimento research=true está ativo
export async function flushPendingTelemetryAggregates(
  storage: LayoutRepository = zoneStorage,
): Promise<number> {
  const consent = await storage.loadConsent?.();
  if (!consent?.research) {
    return 0;
  }
  const token = await getAccessToken();
  if (!token) {
    return 0;
  }
  const pending = (await storage.listUnsyncedAggregates?.()) ?? [];
  let syncedCount = 0;
  for (const item of pending) {
    try {
      await submitTelemetryAggregateRemote(item);
      await storage.markAggregateSynced?.(item.sessionId);
      syncedCount += 1;
    } catch {
      // mantém na fila local para tentativa futura quando a conexão voltar
    }
  }
  return syncedCount;
}

export async function deleteAllUserDataRemote(): Promise<void> {
  const headers = await buildAuthHeaders(false);
  const response = await fetch(`${getApiBaseUrl()}/me/data`, {
    method: 'DELETE',
    headers,
  });
  if (!response.ok && response.status !== 204) {
    throw new Error(await readErrorDetail(response));
  }
}
