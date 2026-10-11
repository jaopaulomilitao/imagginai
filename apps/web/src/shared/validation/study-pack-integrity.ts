import type { PackSource, SourceAnchor, StudyPack } from '../types/study-pack';
import type { ValidationContext } from './schema-reader';

// regras de integridade referencial, espelhadas em study_pack.py (check_integrity)

function checkUniqueIds(
  ctx: ValidationContext,
  items: readonly { id: string }[],
  path: string,
): void {
  const seen = new Set<string>();
  items.forEach((item, index) => {
    if (seen.has(item.id)) ctx.fail(`${path}[${index}].id`, `duplicated id "${item.id}"`);
    seen.add(item.id);
  });
}

function checkAnchorTargets(
  ctx: ValidationContext,
  anchors: readonly SourceAnchor[],
  sources: ReadonlyMap<string, PackSource>,
  path: string,
): void {
  anchors.forEach((anchor, index) => {
    const source = sources.get(anchor.sourceId);
    if (!source) {
      ctx.fail(`${path}[${index}].sourceId`, `unknown source "${anchor.sourceId}"`);
    } else if (anchor.page > source.pageCount) {
      ctx.fail(`${path}[${index}].page`, `exceeds pageCount ${source.pageCount}`);
    }
  });
}

function checkConceptRefs(
  ctx: ValidationContext,
  ids: readonly string[],
  conceptIds: ReadonlySet<string>,
  path: string,
): void {
  ids.forEach((id, index) => {
    if (!conceptIds.has(id)) ctx.fail(`${path}[${index}]`, `unknown concept "${id}"`);
  });
}

function collectAnchorGroups(pack: StudyPack): [string, readonly SourceAnchor[]][] {
  const groups: [string, readonly SourceAnchor[]][] = [];
  pack.concepts.forEach((c, i) => groups.push([`pack.concepts[${i}].anchors`, c.anchors]));
  pack.edges.forEach((e, i) => groups.push([`pack.edges[${i}].anchors`, e.anchors]));
  pack.cards.forEach((c, i) => groups.push([`pack.cards[${i}].anchors`, c.anchors]));
  pack.quiz.forEach((q, i) => groups.push([`pack.quiz[${i}].anchors`, q.anchors]));
  pack.assets.forEach((asset, i) => {
    if (asset.kind !== 'sequence-order') return;
    asset.steps.forEach((step, j) =>
      groups.push([`pack.assets[${i}].steps[${j}].anchors`, step.anchors]),
    );
  });
  return groups;
}

function checkConceptReferences(ctx: ValidationContext, pack: StudyPack): void {
  const conceptIds = new Set(pack.concepts.map((concept) => concept.id));
  pack.edges.forEach((edge, i) => {
    checkConceptRefs(ctx, [edge.sourceId, edge.targetId], conceptIds, `pack.edges[${i}]`);
  });
  pack.cards.forEach((card, i) =>
    checkConceptRefs(ctx, card.conceptIds, conceptIds, `pack.cards[${i}].conceptIds`),
  );
  pack.quiz.forEach((item, i) =>
    checkConceptRefs(ctx, item.conceptIds, conceptIds, `pack.quiz[${i}].conceptIds`),
  );
  pack.assets.forEach((asset, i) => {
    if (asset.kind === 'concept-graph') {
      checkConceptRefs(ctx, asset.nodeIds, conceptIds, `pack.assets[${i}].nodeIds`);
    } else {
      checkUniqueIds(ctx, asset.steps, `pack.assets[${i}].steps`);
    }
  });
}

export function checkStudyPackIntegrity(ctx: ValidationContext, pack: StudyPack): void {
  checkUniqueIds(ctx, pack.sources, 'pack.sources');
  checkUniqueIds(ctx, pack.concepts, 'pack.concepts');
  checkUniqueIds(ctx, pack.cards, 'pack.cards');
  checkUniqueIds(ctx, pack.quiz, 'pack.quiz');
  checkUniqueIds(ctx, pack.assets, 'pack.assets');
  checkConceptReferences(ctx, pack);

  const sources = new Map(pack.sources.map((source) => [source.id, source]));
  for (const [path, anchors] of collectAnchorGroups(pack)) {
    checkAnchorTargets(ctx, anchors, sources, path);
  }
}
