import { describe, expect, it } from 'vitest';

import demoPackRaw from '../../../../fixtures/demo-pack.json';
import { DexieLayoutRepository, ImagginaiDatabase } from '../shared/storage/dexie-db';
import type { ConceptGraphAsset, SequenceOrderAsset } from '../shared/types/study-pack';
import { validateStudyPack } from '../shared/validation/study-pack-validator';
import {
  CONCEPT_GRAPH_VOLUME_HALF_DEPTH_M,
  CONCEPT_GRAPH_VOLUME_HALF_HEIGHT_M,
  CONCEPT_GRAPH_VOLUME_HALF_WIDTH_M,
  ConceptGraphController,
  QuizSessionController,
  SequenceOrderController,
  selectPomodoroQuizItems,
} from './systems/learning-assets-controller';
import { PerfDegradationController } from './systems/perf-degradation-controller';
import { SessionTelemetryCollector } from './systems/session-telemetry-collector';
import {
  aggregateSessionTelemetry,
  classifyConceptTimeBucket,
  containsForbiddenTelemetryField,
  sanitizeTelemetryPayload,
} from './systems/telemetry-aggregator';

function loadValidatedDemoPack() {
  const res = validateStudyPack(demoPackRaw);
  if (!res.ok) {
    throw new Error(`demo pack validation failed: ${res.errors.join('; ')}`);
  }
  return res.pack;
}

describe('Phase 9 — Learning Assets, Quiz, Telemetry & Performance Degradation', () => {
  it('ConceptGraphController scales nodes into ~0.8 m volume and resolves grounded node cards', () => {
    const pack = loadValidatedDemoPack();
    const graphAsset = pack.assets.find(
      (item): item is ConceptGraphAsset => item.kind === 'concept-graph',
    );
    expect(graphAsset).toBeDefined();
    if (!graphAsset) return;

    const controller = new ConceptGraphController(graphAsset, pack.concepts, pack.edges);
    expect(controller.nodes.length).toBeGreaterThan(0);
    expect(controller.edges.length).toBeGreaterThan(0);

    for (const node of controller.nodes) {
      expect(Math.abs(node.x)).toBeLessThanOrEqual(CONCEPT_GRAPH_VOLUME_HALF_WIDTH_M);
      expect(Math.abs(node.y)).toBeLessThanOrEqual(CONCEPT_GRAPH_VOLUME_HALF_HEIGHT_M);
      expect(Math.abs(node.z)).toBeLessThanOrEqual(CONCEPT_GRAPH_VOLUME_HALF_DEPTH_M);
      expect(node.depth).toBeGreaterThanOrEqual(0);
    }

    const targetConceptId = controller.nodes[0]?.conceptId ?? '';
    const selection = controller.selectNode(targetConceptId);
    expect(selection).not.toBeNull();
    expect(selection?.card.conceptIds).toContain(targetConceptId);
    expect(selection?.card.anchors.length).toBeGreaterThan(0);
    expect(Array.isArray(selection?.parents)).toBe(true);
    expect(Array.isArray(selection?.children)).toBe(true);
  });

  it('SequenceOrderController shuffles steps, swaps slots, and validates correct order with citations', () => {
    const pack = loadValidatedDemoPack();
    const seqAsset = pack.assets.find(
      (item): item is SequenceOrderAsset => item.kind === 'sequence-order',
    );
    expect(seqAsset).toBeDefined();
    if (!seqAsset) return;

    const controller = new SequenceOrderController(seqAsset);
    const initialSlots = controller.getSlots();
    expect(initialSlots.length).toBe(seqAsset.steps.length);

    // verifica que os passos começam embaralhados
    const startsSolved = initialSlots.every((step, idx) => step.id === seqAsset.steps[idx]?.id);
    expect(startsSolved).toBe(false);

    // ordena todos os slots colocando cada passo na posição correta usando interactWithSlot
    for (let targetIdx = 0; targetIdx < seqAsset.steps.length; targetIdx++) {
      const expectedId = seqAsset.steps[targetIdx]?.id;
      const currentIdx = controller.getSlots().findIndex((s) => s.id === expectedId);
      if (currentIdx !== -1 && currentIdx !== targetIdx) {
        controller.interactWithSlot(targetIdx);
        controller.interactWithSlot(currentIdx);
      }
    }

    const checkResult = controller.checkOrder();
    expect(checkResult.isCorrect).toBe(true);
    expect(checkResult.correctSlotsCount).toBe(seqAsset.steps.length);
    expect(checkResult.attempts).toBe(1);
    expect(checkResult.anchors.length).toBeGreaterThan(0);
  });

  it('selectPomodoroQuizItems prioritizes least-viewed concepts and QuizSessionController scores answers', () => {
    const pack = loadValidatedDemoPack();
    const conceptOpens: Record<string, number> = {};
    // marca todos os conceitos como muito visualizados, exceto os das últimas 2 questões
    for (const c of pack.concepts) {
      conceptOpens[c.id] = 10;
    }
    const lastQuestion = pack.quiz[pack.quiz.length - 1];
    const secondLastQuestion = pack.quiz[pack.quiz.length - 2];
    for (const cid of lastQuestion?.conceptIds ?? []) {
      conceptOpens[cid] = 0;
    }
    for (const cid of secondLastQuestion?.conceptIds ?? []) {
      conceptOpens[cid] = 1;
    }

    const selected = selectPomodoroQuizItems(pack.quiz, conceptOpens, 4);
    expect(selected.length).toBe(4);
    expect(selected[0]?.id).toBe(lastQuestion?.id);

    const quizController = new QuizSessionController(selected);
    const current = quizController.getCurrentQuestion();
    expect(current).not.toBeNull();
    if (!current) return;

    const feedback = quizController.submitAnswer(current.correctIndex);
    expect(feedback?.isCorrect).toBe(true);
    expect(feedback?.explanation.length).toBeGreaterThan(0);
    expect(quizController.getScoreSummary()).toEqual({
      answered: 1,
      correct: 1,
      total: 4,
    });

    // verifica inicialização na questão clicada e avanço pelo botão "próxima pergunta"
    const secondId = pack.quiz[1]?.id;
    const fullController = new QuizSessionController(pack.quiz, secondId);
    expect(fullController.getCurrentIndex()).toBe(1);
    expect(fullController.getCurrentQuestion()?.id).toBe(secondId);

    const nextQ = fullController.advanceToNextUnanswered();
    expect(nextQ?.id).not.toBe(secondId);
    expect(fullController.getCurrentIndex()).toBe(2);
  });

  it('aggregates session telemetry into buckets (0-5s, 5-30s, >30s) and computes quiz/pinch/mode metrics', () => {
    expect(classifyConceptTimeBucket(3200)).toBe('0-5s');
    expect(classifyConceptTimeBucket(5000)).toBe('0-5s');
    expect(classifyConceptTimeBucket(12000)).toBe('5-30s');
    expect(classifyConceptTimeBucket(45000)).toBe('>30s');

    const envelope = aggregateSessionTelemetry({
      sessionId: 'sess-001',
      zoneId: 'demo',
      completedPomodoroBlocks: 1,
      events: [
        {
          sessionId: 'sess-001',
          zoneId: 'demo',
          type: 'concept.open',
          tMonoMs: 100,
          payload: { conceptId: 'c-short' },
        },
        {
          sessionId: 'sess-001',
          zoneId: 'demo',
          type: 'concept.focus',
          tMonoMs: 200,
          payload: { conceptId: 'c-short', durationMs: 4000 },
        },
        {
          sessionId: 'sess-001',
          zoneId: 'demo',
          type: 'concept.focus',
          tMonoMs: 500,
          payload: { conceptId: 'c-medium', durationMs: 18000 },
        },
        {
          sessionId: 'sess-001',
          zoneId: 'demo',
          type: 'concept.focus',
          tMonoMs: 900,
          payload: { conceptId: 'c-long', durationMs: 42000 },
        },
        {
          sessionId: 'sess-001',
          zoneId: 'demo',
          type: 'quiz.answer',
          tMonoMs: 1200,
          payload: { conceptId: 'c-medium', correct: true },
        },
        {
          sessionId: 'sess-001',
          zoneId: 'demo',
          type: 'quiz.answer',
          tMonoMs: 1500,
          payload: { conceptId: 'c-medium', correct: false },
        },
        {
          sessionId: 'sess-001',
          zoneId: 'demo',
          type: 'gesture.pinch.success',
          tMonoMs: 2000,
          payload: { targetId: 'btn-1' },
        },
        {
          sessionId: 'sess-001',
          zoneId: 'demo',
          type: 'gesture.pinch.miss',
          tMonoMs: 2500,
          payload: { hasTarget: false },
        },
        {
          sessionId: 'sess-001',
          zoneId: 'demo',
          type: 'mode.switch',
          tMonoMs: 6000,
          payload: { mode: 'passthrough' },
        },
        {
          sessionId: 'sess-001',
          zoneId: 'demo',
          type: 'perf.window',
          tMonoMs: 10000,
          payload: { fpsP50: 58.5, fpsP10: 52.1 },
        },
      ],
    });

    expect(envelope.payload.conceptTimeBuckets).toEqual({
      'c-short': '0-5s',
      'c-medium': '5-30s',
      'c-long': '>30s',
    });
    expect(envelope.payload.conceptOpens['c-short']).toBe(1);
    expect(envelope.payload.quizByConcept['c-medium']).toEqual({
      correct: 1,
      incorrect: 1,
    });
    expect(envelope.payload.pinchSuccessCount).toBe(1);
    expect(envelope.payload.pinchMissCount).toBe(1);
    expect(envelope.payload.pinchSuccessRate).toBe(0.5);
    expect(envelope.payload.modeTimeMs.focus).toBe(5900);
    expect(envelope.payload.modeTimeMs.passthrough).toBe(4000);
    expect(envelope.payload.fpsP50).toBe(58.5);
    expect(envelope.payload.fpsP10).toBe(52.1);
  });

  it('PRIVACY GUARD: never allows forbidden fields (landmarks, headOrientationSeries, videoFrames, audio) in telemetry events or aggregates', async () => {
    const dirtyPayload = {
      conceptId: 'c-1',
      durationMs: 12000,
      landmarks: [[0.1, 0.2, 0.3]],
      rawLandmarks: 'secret-hand-points',
      headOrientationSeries: [10, 20, 30],
      videoFrames: 'base64-frame',
      audioBuffer: 'pcm-data',
    };

    const sanitized = sanitizeTelemetryPayload(dirtyPayload);
    expect(sanitized).toEqual({
      conceptId: 'c-1',
      durationMs: 12000,
    });
    expect(containsForbiddenTelemetryField(sanitized)).toBe(false);
    expect(containsForbiddenTelemetryField(dirtyPayload)).toBe(true);

    const repo = new DexieLayoutRepository(new ImagginaiDatabase(`test-phase9-${Date.now()}`));
    let fakeNow = 1000;
    const collector = new SessionTelemetryCollector('demo', repo, () => fakeNow, 'sess-priv-1');
    collector.setConsentFlags({ telemetryLocal: true, research: true });

    collector.record('concept.focus', dirtyPayload);
    fakeNow += 400;
    collector.recordPinchAttempt('btn-quiz-a');
    fakeNow += 300;
    collector.recordPinchAttempt('btn-quiz-a'); // < 1000ms -> aciona gesture.pinch.repeat

    const events = collector.getRecordedEvents();
    expect(events.some((e) => e.type === 'gesture.pinch.repeat')).toBe(true);
    for (const ev of events) {
      expect(containsForbiddenTelemetryField(ev)).toBe(false);
    }

    const aggregate = await collector.finalizeSession(2);
    expect(aggregate).not.toBeNull();
    expect(containsForbiddenTelemetryField(aggregate)).toBe(false);
    const serialized = JSON.stringify(aggregate);
    expect(serialized).not.toContain('landmarks');
    expect(serialized).not.toContain('headOrientation');
    expect(serialized).not.toContain('videoFrame');
    expect(serialized).not.toContain('audio');
    collector.dispose();
  });

  it('PerfDegradationController activates 10 Hz economy mode on sustained low FPS (< 50 for 10 s) or latency > 1.4x baseline', () => {
    const fpsPerf = new PerfDegradationController();
    // 10 segundos com fps em 44 (< 50)
    for (let i = 0; i < 10; i++) {
      const report = fpsPerf.recordSample(1000, 44, 20);
      if (i < 9) {
        expect(report).toBeNull();
      } else {
        expect(report?.economyModeActive).toBe(true);
        expect(report?.economyJustTriggered).toBe(true);
      }
    }

    const latencyPerf = new PerfDegradationController();
    // primeira janela de 10 s define latência média inicial = 20 ms
    const firstWindow = latencyPerf.recordSample(10000, 58, 20);
    expect(firstWindow?.economyModeActive).toBe(false);
    expect(latencyPerf.getInitialMeanLatencyMs()).toBe(20);

    // segunda janela com latência de 32 ms (> 1.4 * 20 = 28 ms) aciona modo econômico
    const secondWindow = latencyPerf.recordSample(10000, 58, 32);
    expect(secondWindow?.economyModeActive).toBe(true);
    expect(secondWindow?.economyJustTriggered).toBe(true);
  });
});
