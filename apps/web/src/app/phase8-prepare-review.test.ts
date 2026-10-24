import { describe, expect, it } from 'vitest';

import demoPackRaw from '../../../../fixtures/demo-pack.json';
import { DexieLayoutRepository } from '../shared/storage/dexie-db';
import { validateStudyPack } from '../shared/validation/study-pack-validator';
import {
  buildZoneHandoffUrl,
  removeConceptFromPack,
  renameConceptInPack,
  selectResumeZone,
} from './services/pack-customizer';

function getValidDemoPack() {
  const res = validateStudyPack(demoPackRaw);
  if (!res.ok) throw new Error(res.errors.join('; '));
  return res.pack;
}

describe('Phase 8 — Pack Review, Consent, Resume & Handoff', () => {
  it('renameConceptInPack updates label and definition within schema limits', () => {
    const pack = getValidDemoPack();
    const firstConcept = pack.concepts[0];
    if (!firstConcept) throw new Error('expected at least one concept');
    const targetId = firstConcept.id;
    const longLabel = 'Conceito Renomeado com Mais de Quarenta Caracteres Aqui';

    const updated = renameConceptInPack(pack, targetId, longLabel, 'Nova definição revisada.');
    const target = updated.concepts.find((c) => c.id === targetId);

    expect(target).toBeDefined();
    expect([...(target?.label ?? '')].length).toBeLessThanOrEqual(40);
    expect(target?.definition).toBe('Nova definição revisada.');
    expect(validateStudyPack(updated).ok).toBe(true);
  });

  it('removeConceptFromPack removes concept and cleans edges, cards, quiz, and graph assets', () => {
    const pack = getValidDemoPack();
    const firstConcept = pack.concepts[0];
    if (!firstConcept) throw new Error('expected at least one concept');
    const removedId = firstConcept.id;

    const updated = removeConceptFromPack(pack, removedId);

    expect(updated.concepts.some((c) => c.id === removedId)).toBe(false);
    expect(updated.edges.some((e) => e.sourceId === removedId || e.targetId === removedId)).toBe(
      false,
    );
    expect(updated.cards.some((card) => card.conceptIds.includes(removedId))).toBe(false);
    expect(updated.quiz.some((q) => q.conceptIds.includes(removedId))).toBe(false);
    expect(validateStudyPack(updated).ok).toBe(true);
  });

  it('selectResumeZone matches the most recent session state to its Zone', () => {
    const now = new Date().toISOString();
    const zones = [
      {
        id: 'zone-1',
        name: 'Circuitos CC',
        environment: 'focus-dark' as const,
        sourceIds: [],
        packId: 'p1',
        layout: [],
        createdAt: now,
        updatedAt: now,
      },
    ];
    const match = selectResumeZone(zones, {
      zoneId: 'zone-1',
      completedPomodoroBlocks: 2,
      exitedAt: now,
    });

    expect(match?.zone.name).toBe('Circuitos CC');
    expect(match?.session.completedPomodoroBlocks).toBe(2);
    expect(selectResumeZone(zones, null)).toBeNull();
  });

  it('buildZoneHandoffUrl formats zoneId and environment query params', () => {
    expect(buildZoneHandoffUrl('zone-123', 'focus-nature')).toBe(
      '/zone.html?zoneId=zone-123&env=focus-nature',
    );
  });

  it('DexieLayoutRepository seeds bundled demo zones, persists consent, and clears data', async () => {
    const repo = new DexieLayoutRepository();
    const zones = await repo.listZones();

    expect(zones.length).toBeGreaterThanOrEqual(3);
    expect(zones.some((z) => z.id === 'zone-demo-engenharia-circuitos-cc')).toBe(true);
    expect(zones.some((z) => z.id === 'zone-demo-saude-anatomia-humana')).toBe(true);

    expect(await repo.loadConsent()).toBeNull();
    const savedConsent = await repo.saveConsent({ telemetryLocal: true, research: true });
    expect(savedConsent.research).toBe(true);
    expect((await repo.loadConsent())?.telemetryLocal).toBe(true);

    await repo.saveSessionState({
      zoneId: 'zone-demo-engenharia-circuitos-cc',
      completedPomodoroBlocks: 3,
      exitedAt: '2026-10-23T18:00:00.000Z',
    });
    const latest = await repo.loadLatestSessionState();
    expect(latest?.zoneId).toBe('zone-demo-engenharia-circuitos-cc');
    expect(latest?.completedPomodoroBlocks).toBe(3);

    await repo.clearAllLocalData();
    expect(await repo.loadConsent()).toBeNull();
    expect(await repo.loadLatestSessionState()).toBeNull();
    // zonas recém-criadas pelo usuário não recebem pacotes demonstrativos pré-populados antes do upload
    expect(await repo.loadStudyPack('custom-empty-zone-uuid')).toBeNull();
  });
});
