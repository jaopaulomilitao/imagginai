import {
  CONCEPT_DEFINITION_MAX_LENGTH,
  CONCEPT_LABEL_MAX_LENGTH,
  POSITION_MAX,
  POSITION_MIN,
  QUIZ_OPTION_COUNT,
  STUDY_PACK_SCHEMA_VERSION,
} from '../../zone/config/constants';
import type { StudyPack } from '../types/study-pack';
import {
  checkKeys,
  checkNumber,
  checkString,
  checkStringArray,
  readArray,
  readRecord,
  ValidationContext,
} from './schema-reader';
import { checkStudyPackIntegrity } from './study-pack-integrity';

export type StudyPackValidationResult =
  { ok: true; pack: StudyPack } | { ok: false; errors: string[] };

type ItemChecker = (ctx: ValidationContext, value: unknown, path: string) => void;

function checkEach(ctx: ValidationContext, value: unknown, path: string, check: ItemChecker) {
  readArray(ctx, value, path)?.forEach((item, index) => check(ctx, item, `${path}[${index}]`));
}

function checkAnchor(ctx: ValidationContext, value: unknown, path: string): void {
  const record = readRecord(ctx, value, path);
  if (!record) return;
  checkKeys(ctx, record, ['sourceId', 'page', 'chunkId'], path);
  checkString(ctx, record.sourceId, `${path}.sourceId`);
  checkNumber(ctx, record.page, `${path}.page`, { integer: true, min: 1 });
  checkString(ctx, record.chunkId, `${path}.chunkId`);
}

function checkAnchors(ctx: ValidationContext, value: unknown, path: string): void {
  // todo item gerado precisa de ao menos uma âncora de fonte (seção 1.3)
  readArray(ctx, value, path, { minLength: 1 })?.forEach((item, index) =>
    checkAnchor(ctx, item, `${path}[${index}]`),
  );
}

function checkSource(ctx: ValidationContext, value: unknown, path: string): void {
  const record = readRecord(ctx, value, path);
  if (!record) return;
  checkKeys(ctx, record, ['id', 'title', 'pageCount'], path);
  checkString(ctx, record.id, `${path}.id`);
  checkString(ctx, record.title, `${path}.title`);
  checkNumber(ctx, record.pageCount, `${path}.pageCount`, { integer: true, min: 1 });
}

function checkPosition(ctx: ValidationContext, value: unknown, path: string): void {
  readArray(ctx, value, path, { exactLength: 3 })?.forEach((coordinate, index) =>
    checkNumber(ctx, coordinate, `${path}[${index}]`, { min: POSITION_MIN, max: POSITION_MAX }),
  );
}

function checkConcept(ctx: ValidationContext, value: unknown, path: string): void {
  const record = readRecord(ctx, value, path);
  if (!record) return;
  checkKeys(ctx, record, ['id', 'label', 'definition', 'anchors', 'position'], path);
  checkString(ctx, record.id, `${path}.id`);
  checkString(ctx, record.label, `${path}.label`, { maxLength: CONCEPT_LABEL_MAX_LENGTH });
  checkString(ctx, record.definition, `${path}.definition`, {
    maxLength: CONCEPT_DEFINITION_MAX_LENGTH,
  });
  checkAnchors(ctx, record.anchors, `${path}.anchors`);
  checkPosition(ctx, record.position, `${path}.position`);
}

function checkEdge(ctx: ValidationContext, value: unknown, path: string): void {
  const record = readRecord(ctx, value, path);
  if (!record) return;
  checkKeys(ctx, record, ['sourceId', 'targetId', 'relation', 'anchors'], path);
  checkString(ctx, record.sourceId, `${path}.sourceId`);
  checkString(ctx, record.targetId, `${path}.targetId`);
  checkString(ctx, record.relation, `${path}.relation`);
  checkAnchors(ctx, record.anchors, `${path}.anchors`);
}

function checkCard(ctx: ValidationContext, value: unknown, path: string): void {
  const record = readRecord(ctx, value, path);
  if (!record) return;
  checkKeys(ctx, record, ['id', 'title', 'body', 'conceptIds', 'anchors'], path);
  checkString(ctx, record.id, `${path}.id`);
  checkString(ctx, record.title, `${path}.title`);
  checkString(ctx, record.body, `${path}.body`);
  checkStringArray(ctx, record.conceptIds, `${path}.conceptIds`);
  checkAnchors(ctx, record.anchors, `${path}.anchors`);
}

const REQUIRED_QUIZ_KEYS = [
  'id',
  'prompt',
  'options',
  'correctIndex',
  'explanation',
  'conceptIds',
  'anchors',
] as const;

const OPTIONAL_QUIZ_KEYS = ['answered'] as const;

function checkQuizItem(ctx: ValidationContext, value: unknown, path: string): void {
  const record = readRecord(ctx, value, path);
  if (!record) return;
  checkKeys(ctx, record, REQUIRED_QUIZ_KEYS, path, OPTIONAL_QUIZ_KEYS);
  checkString(ctx, record.id, `${path}.id`);
  checkString(ctx, record.prompt, `${path}.prompt`);
  checkStringArray(ctx, record.options, `${path}.options`, { exactLength: QUIZ_OPTION_COUNT });
  checkNumber(ctx, record.correctIndex, `${path}.correctIndex`, {
    integer: true,
    min: 0,
    max: QUIZ_OPTION_COUNT - 1,
  });
  checkString(ctx, record.explanation, `${path}.explanation`);
  checkStringArray(ctx, record.conceptIds, `${path}.conceptIds`);
  checkAnchors(ctx, record.anchors, `${path}.anchors`);
  if (record.answered !== undefined && typeof record.answered !== 'boolean') {
    ctx.fail(`${path}.answered`, 'must be a boolean if provided');
  }
}

function checkSequenceStep(ctx: ValidationContext, value: unknown, path: string): void {
  const record = readRecord(ctx, value, path);
  if (!record) return;
  checkKeys(ctx, record, ['id', 'text', 'anchors'], path);
  checkString(ctx, record.id, `${path}.id`);
  checkString(ctx, record.text, `${path}.text`);
  checkAnchors(ctx, record.anchors, `${path}.anchors`);
}

function checkSsoAnnotation(ctx: ValidationContext, value: unknown, path: string): void {
  const record = readRecord(ctx, value, path);
  if (!record) return;
  const allowedKeys = ['id', 'title', 'description', 'position'];
  if ('pageAnchor' in record) allowedKeys.push('pageAnchor');
  checkKeys(ctx, record, allowedKeys, path);
  checkString(ctx, record.id, `${path}.id`);
  checkString(ctx, record.title, `${path}.title`);
  checkString(ctx, record.description, `${path}.description`);
  checkPosition(ctx, record.position, `${path}.position`);
  if (record.pageAnchor !== undefined) {
    checkNumber(ctx, record.pageAnchor, `${path}.pageAnchor`, { integer: true, min: 1 });
  }
}

function checkAsset(ctx: ValidationContext, value: unknown, path: string): void {
  const record = readRecord(ctx, value, path);
  if (!record) return;
  checkString(ctx, record.id, `${path}.id`);
  checkString(ctx, record.title, `${path}.title`);
  // sem justificativa espacial o ativo é descartado na geração (seção 3.6.3)
  checkString(ctx, record.whySpatial, `${path}.whySpatial`);
  if (record.kind === 'concept-graph') {
    checkKeys(ctx, record, ['id', 'kind', 'title', 'whySpatial', 'nodeIds'], path);
    checkStringArray(ctx, record.nodeIds, `${path}.nodeIds`, { minLength: 1 });
  } else if (record.kind === 'sequence-order') {
    checkKeys(ctx, record, ['id', 'kind', 'title', 'whySpatial', 'steps'], path);
    readArray(ctx, record.steps, `${path}.steps`, { minLength: 2 })?.forEach((step, index) =>
      checkSequenceStep(ctx, step, `${path}.steps[${index}]`),
    );
  } else if (record.kind === 'special-study-object') {
    const allowedKeys = ['id', 'kind', 'title', 'whySpatial', 'modelUrl', 'tags', 'annotations'];
    if ('scale' in record) allowedKeys.push('scale');
    checkKeys(ctx, record, allowedKeys, path);
    checkString(ctx, record.modelUrl, `${path}.modelUrl`);
    checkStringArray(ctx, record.tags, `${path}.tags`, { minLength: 1 });
    readArray(ctx, record.annotations, `${path}.annotations`, { minLength: 1 })?.forEach(
      (ann, index) => checkSsoAnnotation(ctx, ann, `${path}.annotations[${index}]`),
    );
  } else {
    ctx.fail(`${path}.kind`, 'must be "concept-graph", "sequence-order" or "special-study-object"');
  }
}

function checkMeta(ctx: ValidationContext, value: unknown, path: string): void {
  const record = readRecord(ctx, value, path);
  if (!record) return;
  checkKeys(ctx, record, ['generatedAt', 'promptVersion', 'model', 'discarded'], path);
  checkIsoDateTime(ctx, record.generatedAt, `${path}.generatedAt`);
  checkString(ctx, record.promptVersion, `${path}.promptVersion`);
  checkString(ctx, record.model, `${path}.model`);
  checkNumber(ctx, record.discarded, `${path}.discarded`, { integer: true, min: 0 });
}

// formato iso 8601 com fuso explícito, aceito igualmente pelo datetime do python
const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

function checkIsoDateTime(ctx: ValidationContext, value: unknown, path: string): void {
  if (typeof value !== 'string' || !ISO_DATE_TIME.test(value) || Number.isNaN(Date.parse(value))) {
    ctx.fail(path, 'must be an ISO 8601 date-time with timezone');
  }
}

const PACK_KEYS = [
  'schemaVersion',
  'packId',
  'zoneId',
  'sources',
  'concepts',
  'edges',
  'cards',
  'quiz',
  'assets',
  'meta',
] as const;

function checkPackStructure(ctx: ValidationContext, record: Record<string, unknown>): void {
  checkKeys(ctx, record, PACK_KEYS, 'pack');
  if (record.schemaVersion !== STUDY_PACK_SCHEMA_VERSION) {
    ctx.fail('pack.schemaVersion', `must be "${STUDY_PACK_SCHEMA_VERSION}"`);
  }
  checkString(ctx, record.packId, 'pack.packId');
  checkString(ctx, record.zoneId, 'pack.zoneId');
  readArray(ctx, record.sources, 'pack.sources', { minLength: 1 });
  checkEach(ctx, record.sources, 'pack.sources', checkSource);
  checkEach(ctx, record.concepts, 'pack.concepts', checkConcept);
  checkEach(ctx, record.edges, 'pack.edges', checkEdge);
  checkEach(ctx, record.cards, 'pack.cards', checkCard);
  checkEach(ctx, record.quiz, 'pack.quiz', checkQuizItem);
  checkEach(ctx, record.assets, 'pack.assets', checkAsset);
  checkMeta(ctx, record.meta, 'pack.meta');
}

export function validateStudyPack(input: unknown): StudyPackValidationResult {
  const ctx = new ValidationContext();
  const record = readRecord(ctx, input, 'pack');
  if (record) checkPackStructure(ctx, record);
  if (ctx.errors.length > 0) return { ok: false, errors: ctx.errors };

  // a estrutura já foi verificada campo a campo, então a conversão de tipo é segura
  const pack = input as StudyPack;
  checkStudyPackIntegrity(ctx, pack);
  return ctx.errors.length > 0 ? { ok: false, errors: ctx.errors } : { ok: true, pack };
}
