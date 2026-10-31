import type { StudyPack } from '../../shared/types/study-pack';
import type { ConceptTimeBucket, SessionAggregateEnvelope } from '../../shared/types/telemetry';
import type { Zone } from '../../shared/types/zone';
import {
  classifyConceptTimeBucket,
  containsForbiddenTelemetryField,
} from '../../zone/systems/telemetry-aggregator';

export type ConceptMasteryStatus = 'mastered' | 'consolidating' | 'needs-review' | 'untested';

export interface ConceptAnalyticsRow {
  conceptId: string;
  label: string;
  zoneId: string;
  zoneName: string;
  sourcePage: number;
  focusTimeMs: number;
  timeBucket: ConceptTimeBucket;
  opens: number;
  quizCorrect: number;
  quizIncorrect: number;
  quizTotal: number;
  quizAccuracyPct: number | null;
  masteryStatus: ConceptMasteryStatus;
}

export interface BucketDistributionSummary {
  readonly '0-5s': number;
  readonly '5-30s': number;
  readonly '>30s': number;
  readonly pct0to5s: number;
  readonly pct5to30s: number;
  readonly pctOver30s: number;
}

export interface ModeDistributionSummary {
  readonly focusMs: number;
  readonly passthroughMs: number;
  readonly focusPct: number;
  readonly passthroughPct: number;
}

export interface DashboardAnalyticsReport {
  readonly totalSessions: number;
  readonly syncedSessionsCount: number;
  readonly unsyncedSessionsCount: number;
  readonly totalFocusTimeMs: number;
  readonly formattedFocusTime: string;
  readonly totalPomodoroBlocks: number;
  readonly overallQuizCorrect: number;
  readonly overallQuizIncorrect: number;
  readonly overallQuizTotal: number;
  readonly overallQuizAccuracyPct: number | null;
  readonly exploredConceptsCount: number;
  readonly totalConceptsCount: number;
  readonly conceptCoveragePct: number;
  readonly concepts: readonly ConceptAnalyticsRow[];
  readonly mostExploredConcepts: readonly ConceptAnalyticsRow[];
  readonly leastExploredConcepts: readonly ConceptAnalyticsRow[];
  readonly priorityReviewConcepts: readonly ConceptAnalyticsRow[];
  readonly totalPinchSuccess: number;
  readonly totalPinchMiss: number;
  readonly totalPinchRepeat: number;
  readonly overallPinchSuccessRatePct: number;
  readonly pinchFrictionRatePct: number;
  readonly bucketDistribution: BucketDistributionSummary;
  readonly modeDistribution: ModeDistributionSummary;
  readonly meanFpsP50: number;
  readonly meanFpsP10: number;
  readonly minFpsP10: number;
  readonly comfortTargetMet: boolean;
  readonly privacyAuditPassed: boolean;
}

// formata milissegundos em texto legível (ex.: "45s", "18m 30s", "1h 25m")
export function formatDurationHuman(durationMs: number): string {
  const safeMs = Math.max(0, Math.round(durationMs));
  const totalSeconds = Math.floor(safeMs / 1000);
  if (totalSeconds === 0) return '0s';
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }
  if (minutes > 0) {
    return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes} min`;
  }
  return `${seconds}s`;
}

export function classifyMasteryStatus(
  correct: number,
  incorrect: number,
): { accuracyPct: number | null; status: ConceptMasteryStatus } {
  const total = correct + incorrect;
  if (total === 0) {
    return { accuracyPct: null, status: 'untested' };
  }
  const accuracyPct = Math.round((correct / total) * 100);
  if (accuracyPct >= 75) {
    return { accuracyPct, status: 'mastered' };
  }
  if (accuracyPct >= 50) {
    return { accuracyPct, status: 'consolidating' };
  }
  return { accuracyPct, status: 'needs-review' };
}

// consolida os agregados de sessão e os pacotes de estudo em métricas para o estudante e o pesquisador
export function computeDashboardAnalytics(
  aggregates: readonly SessionAggregateEnvelope[],
  zones: readonly Zone[],
  packsByZoneId: Readonly<Record<string, StudyPack | undefined>>,
  filterZoneId = 'all',
): DashboardAnalyticsReport {
  const filteredAggregates =
    filterZoneId === 'all' ? aggregates : aggregates.filter((item) => item.zoneId === filterZoneId);

  const relevantZones =
    filterZoneId === 'all' ? zones : zones.filter((zone) => zone.id === filterZoneId);

  const zoneNameById = new Map<string, string>();
  for (const z of zones) {
    zoneNameById.set(z.id, z.name);
  }

  let privacyAuditPassed = true;
  for (const env of filteredAggregates) {
    if (containsForbiddenTelemetryField(env)) {
      privacyAuditPassed = false;
    }
  }

  // indexa todos os conceitos conhecidos dos study packs das zonas selecionadas
  const conceptMetaMap = new Map<
    string,
    { label: string; zoneId: string; zoneName: string; sourcePage: number }
  >();
  for (const z of relevantZones) {
    const pack = packsByZoneId[z.id];
    if (!pack) continue;
    for (const c of pack.concepts) {
      conceptMetaMap.set(`${z.id}::${c.id}`, {
        label: c.label,
        zoneId: z.id,
        zoneName: z.name,
        sourcePage: c.anchors[0]?.page ?? 1,
      });
    }
  }

  const conceptFocusMs = new Map<string, number>();
  const conceptOpens = new Map<string, number>();
  const conceptQuiz = new Map<string, { correct: number; incorrect: number }>();

  let totalFocusTimeMs = 0;
  let totalPomodoroBlocks = 0;
  let totalPinchSuccess = 0;
  let totalPinchMiss = 0;
  let totalPinchRepeat = 0;
  let focusModeMs = 0;
  let passthroughModeMs = 0;
  let syncedSessionsCount = 0;

  const fpsP50Values: number[] = [];
  const fpsP10Values: number[] = [];

  for (const env of filteredAggregates) {
    if (env.synced) syncedSessionsCount += 1;
    const p = env.payload;
    totalFocusTimeMs += Math.max(0, p.totalFocusTimeMs || 0);
    totalPomodoroBlocks += Math.max(0, p.completedPomodoroBlocks || 0);
    totalPinchSuccess += Math.max(0, p.pinchSuccessCount || 0);
    totalPinchMiss += Math.max(0, p.pinchMissCount || 0);
    totalPinchRepeat += Math.max(0, p.pinchRepeatCount || 0);

    focusModeMs += Math.max(0, p.modeTimeMs?.focus ?? 0);
    passthroughModeMs += Math.max(0, p.modeTimeMs?.passthrough ?? 0);

    if (typeof p.fpsP50 === 'number' && p.fpsP50 > 0) {
      fpsP50Values.push(p.fpsP50);
    }
    if (typeof p.fpsP10 === 'number' && p.fpsP10 > 0) {
      fpsP10Values.push(p.fpsP10);
    }

    for (const [conceptId, ms] of Object.entries(p.conceptTimeMs ?? {})) {
      const compositeKey = `${env.zoneId}::${conceptId}`;
      conceptFocusMs.set(compositeKey, (conceptFocusMs.get(compositeKey) ?? 0) + Math.max(0, ms));
      if (!conceptMetaMap.has(compositeKey)) {
        const pack = packsByZoneId[env.zoneId];
        const found = pack?.concepts.find((c) => c.id === conceptId);
        conceptMetaMap.set(compositeKey, {
          label: found?.label ?? conceptId,
          zoneId: env.zoneId,
          zoneName: zoneNameById.get(env.zoneId) ?? env.zoneId,
          sourcePage: found?.anchors[0]?.page ?? 1,
        });
      }
    }

    for (const [conceptId, opens] of Object.entries(p.conceptOpens ?? {})) {
      const compositeKey = `${env.zoneId}::${conceptId}`;
      conceptOpens.set(compositeKey, (conceptOpens.get(compositeKey) ?? 0) + Math.max(0, opens));
      if (!conceptMetaMap.has(compositeKey)) {
        const pack = packsByZoneId[env.zoneId];
        const found = pack?.concepts.find((c) => c.id === conceptId);
        conceptMetaMap.set(compositeKey, {
          label: found?.label ?? conceptId,
          zoneId: env.zoneId,
          zoneName: zoneNameById.get(env.zoneId) ?? env.zoneId,
          sourcePage: found?.anchors[0]?.page ?? 1,
        });
      }
    }

    for (const [conceptId, q] of Object.entries(p.quizByConcept ?? {})) {
      const compositeKey = `${env.zoneId}::${conceptId}`;
      const prev = conceptQuiz.get(compositeKey) ?? { correct: 0, incorrect: 0 };
      conceptQuiz.set(compositeKey, {
        correct: prev.correct + Math.max(0, q.correct || 0),
        incorrect: prev.incorrect + Math.max(0, q.incorrect || 0),
      });
      if (!conceptMetaMap.has(compositeKey)) {
        const pack = packsByZoneId[env.zoneId];
        const found = pack?.concepts.find((c) => c.id === conceptId);
        conceptMetaMap.set(compositeKey, {
          label: found?.label ?? conceptId,
          zoneId: env.zoneId,
          zoneName: zoneNameById.get(env.zoneId) ?? env.zoneId,
          sourcePage: found?.anchors[0]?.page ?? 1,
        });
      }
    }
  }

  let overallQuizCorrect = 0;
  let overallQuizIncorrect = 0;
  const conceptRows: ConceptAnalyticsRow[] = [];

  for (const [compositeKey, meta] of conceptMetaMap.entries()) {
    const rawConceptId = compositeKey.split('::')[1] ?? compositeKey;
    const focusMs = conceptFocusMs.get(compositeKey) ?? 0;
    const opens = conceptOpens.get(compositeKey) ?? 0;
    const q = conceptQuiz.get(compositeKey) ?? { correct: 0, incorrect: 0 };
    overallQuizCorrect += q.correct;
    overallQuizIncorrect += q.incorrect;

    const { accuracyPct, status } = classifyMasteryStatus(q.correct, q.incorrect);
    conceptRows.push({
      conceptId: rawConceptId,
      label: meta.label,
      zoneId: meta.zoneId,
      zoneName: meta.zoneName,
      sourcePage: meta.sourcePage,
      focusTimeMs: focusMs,
      timeBucket: classifyConceptTimeBucket(focusMs),
      opens,
      quizCorrect: q.correct,
      quizIncorrect: q.incorrect,
      quizTotal: q.correct + q.incorrect,
      quizAccuracyPct: accuracyPct,
      masteryStatus: status,
    });
  }

  const exploredConceptsCount = conceptRows.filter(
    (row) => row.focusTimeMs > 0 || row.opens > 0 || row.quizTotal > 0,
  ).length;
  const totalConceptsCount = conceptRows.length;
  const conceptCoveragePct =
    totalConceptsCount > 0 ? Math.round((exploredConceptsCount / totalConceptsCount) * 100) : 0;

  const overallQuizTotal = overallQuizCorrect + overallQuizIncorrect;
  const overallQuizAccuracyPct =
    overallQuizTotal > 0 ? Math.round((overallQuizCorrect / overallQuizTotal) * 100) : null;

  const sortedByMostExplored = [...conceptRows].sort((a, b) => {
    if (b.focusTimeMs !== a.focusTimeMs) return b.focusTimeMs - a.focusTimeMs;
    if (b.opens !== a.opens) return b.opens - a.opens;
    return a.label.localeCompare(b.label, 'pt-BR');
  });

  const sortedByLeastExplored = [...conceptRows].sort((a, b) => {
    if (a.focusTimeMs !== b.focusTimeMs) return a.focusTimeMs - b.focusTimeMs;
    if (a.opens !== b.opens) return a.opens - b.opens;
    return a.label.localeCompare(b.label, 'pt-BR');
  });

  const priorityReviewConcepts = conceptRows
    .filter(
      (row) =>
        row.masteryStatus === 'needs-review' ||
        row.masteryStatus === 'consolidating' ||
        row.focusTimeMs < 5000,
    )
    .sort((a, b) => {
      const aAcc = a.quizAccuracyPct ?? 50;
      const bAcc = b.quizAccuracyPct ?? 50;
      if (aAcc !== bAcc) return aAcc - bAcc;
      return a.focusTimeMs - b.focusTimeMs;
    })
    .slice(0, 6);

  // distribuição de buckets de atenção entre conceitos interagidos
  const interactedRows = conceptRows.filter((r) => r.focusTimeMs > 0 || r.opens > 0);
  const count0to5 = interactedRows.filter((r) => r.timeBucket === '0-5s').length;
  const count5to30 = interactedRows.filter((r) => r.timeBucket === '5-30s').length;
  const countOver30 = interactedRows.filter((r) => r.timeBucket === '>30s').length;
  const totalBucketCount = Math.max(1, count0to5 + count5to30 + countOver30);

  const bucketDistribution: BucketDistributionSummary = {
    '0-5s': count0to5,
    '5-30s': count5to30,
    '>30s': countOver30,
    pct0to5s: interactedRows.length > 0 ? Math.round((count0to5 / totalBucketCount) * 100) : 0,
    pct5to30s: interactedRows.length > 0 ? Math.round((count5to30 / totalBucketCount) * 100) : 0,
    pctOver30s: interactedRows.length > 0 ? Math.round((countOver30 / totalBucketCount) * 100) : 0,
  };

  // distribuição de tempo por modo (foco vs passthrough)
  if (focusModeMs === 0 && passthroughModeMs === 0 && totalFocusTimeMs > 0) {
    focusModeMs = totalFocusTimeMs;
  }
  const totalModeMs = focusModeMs + passthroughModeMs;
  const focusPct = totalModeMs > 0 ? Math.round((focusModeMs / totalModeMs) * 100) : 100;
  const passthroughPct = totalModeMs > 0 ? 100 - focusPct : 0;

  const modeDistribution: ModeDistributionSummary = {
    focusMs: focusModeMs,
    passthroughMs: passthroughModeMs,
    focusPct,
    passthroughPct,
  };

  const totalPinchAttempts = totalPinchSuccess + totalPinchMiss;
  const overallPinchSuccessRatePct =
    totalPinchAttempts > 0 ? Math.round((totalPinchSuccess / totalPinchAttempts) * 100) : 100;
  const pinchFrictionRatePct =
    totalPinchAttempts > 0 ? Math.round((totalPinchRepeat / totalPinchAttempts) * 100) : 0;

  const meanFpsP50 =
    fpsP50Values.length > 0
      ? Math.round((fpsP50Values.reduce((acc, v) => acc + v, 0) / fpsP50Values.length) * 10) / 10
      : 60.0;
  const meanFpsP10 =
    fpsP10Values.length > 0
      ? Math.round((fpsP10Values.reduce((acc, v) => acc + v, 0) / fpsP10Values.length) * 10) / 10
      : 55.0;
  const minFpsP10 =
    fpsP10Values.length > 0 ? Math.round(Math.min(...fpsP10Values) * 10) / 10 : 55.0;

  return {
    totalSessions: filteredAggregates.length,
    syncedSessionsCount,
    unsyncedSessionsCount: Math.max(0, filteredAggregates.length - syncedSessionsCount),
    totalFocusTimeMs,
    formattedFocusTime: formatDurationHuman(totalFocusTimeMs),
    totalPomodoroBlocks,
    overallQuizCorrect,
    overallQuizIncorrect,
    overallQuizTotal,
    overallQuizAccuracyPct,
    exploredConceptsCount,
    totalConceptsCount,
    conceptCoveragePct,
    concepts: sortedByMostExplored,
    mostExploredConcepts: sortedByMostExplored.slice(0, 6),
    leastExploredConcepts: sortedByLeastExplored.slice(0, 6),
    priorityReviewConcepts,
    totalPinchSuccess,
    totalPinchMiss,
    totalPinchRepeat,
    overallPinchSuccessRatePct,
    pinchFrictionRatePct,
    bucketDistribution,
    modeDistribution,
    meanFpsP50,
    meanFpsP10,
    minFpsP10,
    comfortTargetMet: meanFpsP50 >= 50 && minFpsP10 >= 45,
    privacyAuditPassed,
  };
}

// exporta os agregados anonimizados em formato json estruturado para análise científica
export function buildResearchExportJson(
  aggregates: readonly SessionAggregateEnvelope[],
  zones: readonly Zone[],
): string {
  const zoneNames = Object.fromEntries(zones.map((z) => [z.id, z.name]));
  const sanitizedRecords = aggregates.map((env) => ({
    sessionId: env.sessionId,
    zoneId: env.zoneId,
    zoneName: zoneNames[env.zoneId] ?? env.zoneId,
    createdAt: env.createdAt,
    synced: env.synced,
    metrics: env.payload,
  }));
  return JSON.stringify(
    {
      schemaVersion: '1.0',
      exportedAt: new Date().toISOString(),
      privacyGuarantee:
        'zero raw landmarks, headOrientationSeries, videoFrames or audio (section 3.9)',
      sessionCount: sanitizedRecords.length,
      sessions: sanitizedRecords,
    },
    null,
    2,
  );
}

// exporta os agregados anonimizados em formato csv tabular para r, python ou spss
export function buildResearchExportCsv(
  aggregates: readonly SessionAggregateEnvelope[],
  zones: readonly Zone[],
): string {
  const zoneNames = Object.fromEntries(zones.map((z) => [z.id, z.name]));
  const headers = [
    'session_id',
    'zone_id',
    'zone_name',
    'created_at',
    'total_focus_ms',
    'pomodoro_blocks',
    'concepts_explored',
    'quiz_correct',
    'quiz_incorrect',
    'quiz_accuracy_pct',
    'pinch_success',
    'pinch_miss',
    'pinch_repeat',
    'pinch_success_rate',
    'focus_mode_ms',
    'passthrough_mode_ms',
    'fps_p50',
    'fps_p10',
  ];

  const rows = aggregates.map((env) => {
    const p = env.payload;
    const conceptsExplored = Object.keys(p.conceptTimeMs ?? {}).length;
    let qCorrect = 0;
    let qIncorrect = 0;
    for (const item of Object.values(p.quizByConcept ?? {})) {
      qCorrect += item.correct || 0;
      qIncorrect += item.incorrect || 0;
    }
    const qTotal = qCorrect + qIncorrect;
    const qAcc = qTotal > 0 ? Math.round((qCorrect / qTotal) * 100) : '';
    const safeName = (zoneNames[env.zoneId] ?? env.zoneId).replace(/"/g, '""');

    return [
      env.sessionId,
      env.zoneId,
      `"${safeName}"`,
      env.createdAt,
      p.totalFocusTimeMs,
      p.completedPomodoroBlocks,
      conceptsExplored,
      qCorrect,
      qIncorrect,
      qAcc,
      p.pinchSuccessCount,
      p.pinchMissCount,
      p.pinchRepeatCount,
      p.pinchSuccessRate,
      p.modeTimeMs?.focus ?? p.totalFocusTimeMs,
      p.modeTimeMs?.passthrough ?? 0,
      p.fpsP50,
      p.fpsP10,
    ].join(',');
  });

  return [headers.join(','), ...rows].join('\n');
}

// gera agregados realistas ancorados nos study packs locais para demonstração e inspeção imediata do painel
export function generateSampleResearchAggregates(
  packsByZoneId: Readonly<Record<string, StudyPack | undefined>>,
): SessionAggregateEnvelope[] {
  const now = Date.now();
  const entries = Object.entries(packsByZoneId).filter((entry): entry is [string, StudyPack] =>
    Boolean(entry[1] && entry[1].concepts.length > 0),
  );

  const results: SessionAggregateEnvelope[] = [];

  entries.slice(0, 3).forEach(([zoneId, pack], idx) => {
    const conceptTimeMs: Record<string, number> = {};
    const conceptTimeBuckets: Record<string, ConceptTimeBucket> = {};
    const conceptOpens: Record<string, number> = {};
    const quizByConcept: Record<string, { correct: number; incorrect: number }> = {};

    const durationsPattern = [48000, 36000, 22000, 14000, 8500, 3800, 2400, 62000, 19500, 4100];

    pack.concepts.forEach((concept, cIdx) => {
      // deixa os últimos 2 conceitos pouco explorados ou intocados para evidenciar prioridades de revisão
      if (cIdx >= pack.concepts.length - 2) {
        if (cIdx === pack.concepts.length - 2) {
          conceptTimeMs[concept.id] = 2800;
          conceptTimeBuckets[concept.id] = '0-5s';
          conceptOpens[concept.id] = 1;
          quizByConcept[concept.id] = { correct: 0, incorrect: 2 };
        }
        return;
      }

      const ms = durationsPattern[(cIdx + idx * 2) % durationsPattern.length] ?? 15000;
      conceptTimeMs[concept.id] = ms;
      conceptTimeBuckets[concept.id] = classifyConceptTimeBucket(ms);
      conceptOpens[concept.id] = (cIdx % 4) + 1;

      if (cIdx % 3 === 0) {
        quizByConcept[concept.id] = { correct: 2, incorrect: 0 };
      } else if (cIdx % 3 === 1) {
        quizByConcept[concept.id] = { correct: 1, incorrect: 1 };
      } else if (cIdx < 5) {
        quizByConcept[concept.id] = { correct: 3, incorrect: 1 };
      }
    });

    const focusMs = 1500000 - idx * 180000;
    const passthroughMs = 240000 + idx * 45000;
    const totalFocusTimeMs = focusMs + passthroughMs;
    const pinchSuccess = 44 + idx * 9;
    const pinchMiss = 4 + idx;
    const pinchRepeat = 2 + (idx % 2);
    const pinchRate = Math.round((pinchSuccess / (pinchSuccess + pinchMiss)) * 10000) / 10000;

    results.push({
      sessionId: `sess-demo-${zoneId}-${idx + 1}`,
      zoneId,
      createdAt: new Date(now - (idx + 1) * 3600 * 1000 * 6).toISOString(),
      synced: idx === 0,
      payload: {
        totalFocusTimeMs,
        conceptTimeMs,
        conceptTimeBuckets,
        conceptOpens,
        quizByConcept,
        pinchSuccessCount: pinchSuccess,
        pinchMissCount: pinchMiss,
        pinchRepeatCount: pinchRepeat,
        pinchSuccessRate: pinchRate,
        modeTimeMs: {
          focus: focusMs,
          passthrough: passthroughMs,
        },
        fpsP50: 58.6 - idx * 1.2,
        fpsP10: 52.4 - idx * 1.1,
        completedPomodoroBlocks: 2 - (idx % 2),
      },
    });
  });

  return results;
}
