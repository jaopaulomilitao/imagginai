import { describe, expect, it } from 'vitest';

import demoPack from '../../../../../fixtures/demo-pack.json';
import invalidCases from '../../../../../fixtures/study-pack-invalid-cases.json';
import engineeringDemoPack from '../../../public/demo-packs/engineering-dc-circuits.json';
import healthDemoPack from '../../../public/demo-packs/health-human-anatomy.json';
import { isRecord } from './schema-reader';
import { validateStudyPack } from './study-pack-validator';

type PathSegment = string | number;

interface InvalidCase {
  name: string;
  path: PathSegment[];
  value?: unknown;
  remove?: boolean;
}

function applyCase(source: unknown, invalidCase: InvalidCase): unknown {
  const copy: unknown = structuredClone(source);
  const parentPath = invalidCase.path.slice(0, -1);
  const lastKey = invalidCase.path.at(-1);
  // é percorrido o caminho até o contêiner do campo a ser alterado
  const parent = parentPath.reduce<unknown>(
    (node, key) => (isRecord(node) || Array.isArray(node) ? Reflect.get(node, key) : undefined),
    copy,
  );
  if (lastKey === undefined || !(isRecord(parent) || Array.isArray(parent))) {
    throw new Error(`invalid case path: ${invalidCase.name}`);
  }
  if (invalidCase.remove) Reflect.deleteProperty(parent, lastKey);
  else Reflect.set(parent, lastKey, invalidCase.value);
  return copy;
}

describe('validateStudyPack', () => {
  it('accepts the hand-written demo pack', () => {
    const result = validateStudyPack(demoPack);

    expect(result.ok ? [] : result.errors).toEqual([]);
  });

  it('demo pack matches the Phase 1 content requirements', () => {
    const result = validateStudyPack(demoPack);
    if (!result.ok) throw new Error(result.errors.join('\n'));
    const kinds = result.pack.assets.map((asset) => asset.kind).sort();

    expect(result.pack.concepts).toHaveLength(12);
    expect(result.pack.quiz).toHaveLength(8);
    expect(kinds).toEqual(['concept-graph', 'sequence-order', 'special-study-object']);
  });

  it('rejects non-object input', () => {
    expect(validateStudyPack(null).ok).toBe(false);
    expect(validateStudyPack([]).ok).toBe(false);
  });

  it.each(invalidCases as InvalidCase[])('rejects: $name', (invalidCase) => {
    expect(validateStudyPack(applyCase(demoPack, invalidCase)).ok).toBe(false);
  });

  it('accepts the Phase 7 real grounded Engineering and Health demo packs', () => {
    const engResult = validateStudyPack(engineeringDemoPack);
    const healthResult = validateStudyPack(healthDemoPack);

    expect(engResult.ok ? [] : engResult.errors).toEqual([]);
    expect(healthResult.ok ? [] : healthResult.errors).toEqual([]);
  });
});
