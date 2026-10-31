import { describe, expect, it } from 'vitest';

import demoPackRaw from '../../../../fixtures/demo-pack.json';
import type { SessionAggregateEnvelope } from '../shared/types/telemetry';
import type { Zone } from '../shared/types/zone';
import { validateStudyPack } from '../shared/validation/study-pack-validator';
import { containsForbiddenTelemetryField } from '../zone/systems/telemetry-aggregator';
import {
  buildResearchExportCsv,
  buildResearchExportJson,
  classifyMasteryStatus,
  computeDashboardAnalytics,
  formatDurationHuman,
  generateSampleResearchAggregates,
} from './services/dashboard-analytics';

describe('Phase 10 — Student & Education Researcher Dashboard Analytics & Security', () => {
  it('formats durations and classifies concept mastery accurately', () => {
    expect(formatDurationHuman(0)).toBe('0s');
    expect(formatDurationHuman(45000)).toBe('45s');
    expect(formatDurationHuman(180000)).toBe('3 min');
    expect(formatDurationHuman(195000)).toBe('3m 15s');
    expect(formatDurationHuman(3900000)).toBe('1h 5m');

    expect(classifyMasteryStatus(0, 0)).toEqual({ accuracyPct: null, status: 'untested' });
    expect(classifyMasteryStatus(3, 1)).toEqual({ accuracyPct: 75, status: 'mastered' });
    expect(classifyMasteryStatus(2, 2)).toEqual({ accuracyPct: 50, status: 'consolidating' });
    expect(classifyMasteryStatus(1, 3)).toEqual({ accuracyPct: 25, status: 'needs-review' });
  });

  it('computes student and researcher metrics, rankings, and exports from session aggregates', () => {
    const validated = validateStudyPack(demoPackRaw);
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;

    const pack = validated.pack;
    const zones: Zone[] = [
      {
        id: 'demo',
        name: 'Sistema Cardiovascular (Demo)',
        environment: 'focus-dark',
        sourceIds: pack.sources.map((s) => s.id),
        packId: pack.packId,
        layout: [],
        createdAt: '2026-10-31T10:00:00Z',
        updatedAt: '2026-10-31T10:00:00Z',
      },
    ];

    const c0 = pack.concepts[0]?.id ?? 'c-0';
    const c1 = pack.concepts[1]?.id ?? 'c-1';
    const c2 = pack.concepts[2]?.id ?? 'c-2';

    const aggregates: SessionAggregateEnvelope[] = [
      {
        sessionId: 'sess-1',
        zoneId: 'demo',
        createdAt: '2026-10-31T10:30:00Z',
        synced: true,
        payload: {
          totalFocusTimeMs: 1500000,
          conceptTimeMs: {
            [c0]: 45000,
            [c1]: 12000,
            [c2]: 3000,
          },
          conceptTimeBuckets: {
            [c0]: '>30s',
            [c1]: '5-30s',
            [c2]: '0-5s',
          },
          conceptOpens: {
            [c0]: 4,
            [c1]: 2,
            [c2]: 1,
          },
          quizByConcept: {
            [c0]: { correct: 3, incorrect: 0 },
            [c1]: { correct: 1, incorrect: 1 },
            [c2]: { correct: 0, incorrect: 2 },
          },
          pinchSuccessCount: 45,
          pinchMissCount: 5,
          pinchRepeatCount: 2,
          pinchSuccessRate: 0.9,
          modeTimeMs: {
            focus: 1200000,
            passthrough: 300000,
          },
          fpsP50: 58.5,
          fpsP10: 53.0,
          completedPomodoroBlocks: 1,
        },
      },
    ];

    const report = computeDashboardAnalytics(aggregates, zones, { demo: pack }, 'all');

    expect(report.totalSessions).toBe(1);
    expect(report.totalFocusTimeMs).toBe(1500000);
    expect(report.formattedFocusTime).toBe('25 min');
    expect(report.totalPomodoroBlocks).toBe(1);
    expect(report.overallQuizCorrect).toBe(4);
    expect(report.overallQuizIncorrect).toBe(3);
    expect(report.overallQuizAccuracyPct).toBe(57);
    expect(report.exploredConceptsCount).toBe(3);
    expect(report.totalConceptsCount).toBe(pack.concepts.length);
    expect(report.mostExploredConcepts[0]?.conceptId).toBe(c0);
    expect(report.mostExploredConcepts[0]?.timeBucket).toBe('>30s');
    expect(report.leastExploredConcepts[0]?.focusTimeMs).toBe(0);

    // métricas do pesquisador em educação e ihc espacial
    expect(report.overallPinchSuccessRatePct).toBe(90);
    expect(report.pinchFrictionRatePct).toBe(4);
    expect(report.bucketDistribution['>30s']).toBe(1);
    expect(report.bucketDistribution['5-30s']).toBe(1);
    expect(report.bucketDistribution['0-5s']).toBe(1);
    expect(report.modeDistribution.focusPct).toBe(80);
    expect(report.modeDistribution.passthroughPct).toBe(20);
    expect(report.meanFpsP50).toBe(58.5);
    expect(report.comfortTargetMet).toBe(true);
    expect(report.privacyAuditPassed).toBe(true);

    // exportação json e csv para análise externa
    const jsonStr = buildResearchExportJson(aggregates, zones);
    const parsedJson = JSON.parse(jsonStr) as { sessionCount: number; privacyGuarantee: string };
    expect(parsedJson.sessionCount).toBe(1);
    expect(parsedJson.privacyGuarantee).toContain('zero raw landmarks');

    const csvStr = buildResearchExportCsv(aggregates, zones);
    const csvLines = csvStr.split('\n');
    expect(csvLines).toHaveLength(2);
    expect(csvLines[0]).toContain('session_id,zone_id,zone_name');
    expect(csvLines[1]).toContain('sess-1,demo,"Sistema Cardiovascular (Demo)"');
  });

  it('generates grounded sample research aggregates with zero forbidden biometric fields', () => {
    const validated = validateStudyPack(demoPackRaw);
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;

    const samples = generateSampleResearchAggregates({ demo: validated.pack });
    expect(samples.length).toBeGreaterThan(0);
    for (const sample of samples) {
      expect(containsForbiddenTelemetryField(sample)).toBe(false);
      expect(sample.payload.totalFocusTimeMs).toBeGreaterThan(0);
      expect(Object.keys(sample.payload.conceptTimeMs).length).toBeGreaterThan(0);
    }
  });

  it('detects privacy audit violation if any forbidden biometric key is injected into aggregates', () => {
    const validated = validateStudyPack(demoPackRaw);
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;

    const taintedAggregate = {
      sessionId: 'sess-tainted',
      zoneId: 'demo',
      createdAt: '2026-10-31T12:00:00Z',
      synced: false,
      payload: {
        totalFocusTimeMs: 60000,
        conceptTimeMs: {},
        conceptTimeBuckets: {},
        conceptOpens: {},
        quizByConcept: {},
        pinchSuccessCount: 5,
        pinchMissCount: 0,
        pinchRepeatCount: 0,
        pinchSuccessRate: 1,
        modeTimeMs: { focus: 60000 },
        fpsP50: 60,
        fpsP10: 58,
        completedPomodoroBlocks: 0,
        headOrientationSeries: [1, 2, 3],
      },
    } as unknown as SessionAggregateEnvelope;

    const report = computeDashboardAnalytics([taintedAggregate], [], { demo: validated.pack });
    expect(report.privacyAuditPassed).toBe(false);
  });
});
