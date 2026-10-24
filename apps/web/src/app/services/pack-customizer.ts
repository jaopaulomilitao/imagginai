import type { StoredZoneSessionState } from '../../shared/storage/dexie-db';
import type { LearningAsset, StudyPack } from '../../shared/types/study-pack';
import type { Zone } from '../../shared/types/zone';
import {
  CONCEPT_DEFINITION_MAX_LENGTH,
  CONCEPT_LABEL_MAX_LENGTH,
  type EnvironmentPreset,
} from '../../zone/config/constants';

export interface ResumeZoneMatch {
  readonly zone: Zone;
  readonly session: StoredZoneSessionState;
}

function sliceCodePoints(input: string, maxLength: number): string {
  // corta por pontos de código unicode para manter paridade com len() do python
  const chars = [...input.trim()];
  return chars.slice(0, maxLength).join('');
}

export function renameConceptInPack(
  pack: StudyPack,
  conceptId: string,
  newLabel: string,
  newDefinition?: string,
): StudyPack {
  // atualiza o rótulo e opcionalmente a definição de um conceito respeitando os limites da seção 3.6.2
  const cleanedLabel = sliceCodePoints(newLabel, CONCEPT_LABEL_MAX_LENGTH);
  if (cleanedLabel.length === 0) {
    return pack;
  }

  const nextConcepts = pack.concepts.map((concept) => {
    if (concept.id !== conceptId) return concept;
    const cleanedDef =
      newDefinition !== undefined
        ? sliceCodePoints(newDefinition, CONCEPT_DEFINITION_MAX_LENGTH)
        : concept.definition;
    return {
      ...concept,
      label: cleanedLabel,
      definition: cleanedDef.length > 0 ? cleanedDef : concept.definition,
    };
  });

  return {
    ...pack,
    concepts: nextConcepts,
  };
}

export function removeConceptFromPack(pack: StudyPack, conceptId: string): StudyPack {
  // remove um conceito e limpa referências órfãs em arestas, cartões, quiz e grafo 3d
  if (pack.concepts.length <= 1) {
    return pack;
  }
  const nextConcepts = pack.concepts.filter((concept) => concept.id !== conceptId);
  if (nextConcepts.length === pack.concepts.length) {
    return pack;
  }
  const remainingIds = new Set(nextConcepts.map((concept) => concept.id));

  const nextEdges = pack.edges.filter(
    (edge) => remainingIds.has(edge.sourceId) && remainingIds.has(edge.targetId),
  );

  const nextCards = pack.cards
    .map((card) => ({
      ...card,
      conceptIds: card.conceptIds.filter((id) => remainingIds.has(id)),
    }))
    .filter((card) => card.conceptIds.length > 0);

  const nextQuiz = pack.quiz
    .map((item) => ({
      ...item,
      conceptIds: item.conceptIds.filter((id) => remainingIds.has(id)),
    }))
    .filter((item) => item.conceptIds.length > 0);

  const nextAssets: LearningAsset[] = [];
  for (const asset of pack.assets) {
    if (asset.kind === 'concept-graph') {
      const filteredNodes = asset.nodeIds.filter((id) => remainingIds.has(id));
      if (filteredNodes.length > 0) {
        nextAssets.push({
          ...asset,
          nodeIds: filteredNodes,
        });
      }
    } else {
      nextAssets.push(asset);
    }
  }

  return {
    ...pack,
    concepts: nextConcepts,
    edges: nextEdges,
    cards: nextCards,
    quiz: nextQuiz,
    assets: nextAssets,
  };
}

export function selectResumeZone(
  zones: readonly Zone[],
  latestSession: StoredZoneSessionState | null,
): ResumeZoneMatch | null {
  // identifica a zona correspondente à última sessão salva para o banner de retomada
  if (!latestSession) return null;
  const zone = zones.find((item) => item.id === latestSession.zoneId);
  if (!zone) return null;
  return { zone, session: latestSession };
}

export function buildZoneHandoffUrl(zoneId: string, environment: EnvironmentPreset): string {
  // monta a url de entrada na zona espacial com parâmetros de zona e ambiente
  const params = new URLSearchParams({
    zoneId,
    env: environment,
  });
  return `/zone.html?${params.toString()}`;
}
