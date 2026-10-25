// leitores mínimos de valores desconhecidos; acumulam erros em vez de lançar exceção

export type UnknownRecord = Record<string, unknown>;

export class ValidationContext {
  readonly errors: string[] = [];

  fail(path: string, message: string): void {
    this.errors.push(`${path}: ${message}`);
  }
}

export interface StringRules {
  maxLength?: number;
}

export interface ArrayRules {
  minLength?: number;
  exactLength?: number;
}

export interface NumberRules {
  min?: number;
  max?: number;
  integer?: boolean;
}

export function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function readRecord(ctx: ValidationContext, value: unknown, path: string) {
  if (isRecord(value)) return value;
  ctx.fail(path, 'must be an object');
  return undefined;
}

export function checkKeys(
  ctx: ValidationContext,
  record: UnknownRecord,
  allowed: readonly string[],
  path: string,
  optional: readonly string[] = [],
): void {
  // são rejeitadas chaves extras para manter paridade com o pydantic (extra="forbid")
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key) && !optional.includes(key)) {
      ctx.fail(`${path}.${key}`, 'unexpected field');
    }
  }
  for (const key of allowed) {
    if (!(key in record)) ctx.fail(`${path}.${key}`, 'missing field');
  }
}

export function checkString(
  ctx: ValidationContext,
  value: unknown,
  path: string,
  rules: StringRules = {},
): void {
  if (typeof value !== 'string' || value.trim().length === 0) {
    ctx.fail(path, 'must be a non-empty string');
    return;
  }
  // o tamanho é contado em code points, igual ao len() do python
  if (rules.maxLength !== undefined && [...value].length > rules.maxLength) {
    ctx.fail(path, `must have at most ${rules.maxLength} characters`);
  }
}

export function checkNumber(
  ctx: ValidationContext,
  value: unknown,
  path: string,
  rules: NumberRules = {},
): void {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    ctx.fail(path, 'must be a finite number');
    return;
  }
  if (rules.integer && !Number.isInteger(value)) ctx.fail(path, 'must be an integer');
  if (rules.min !== undefined && value < rules.min) ctx.fail(path, `must be >= ${rules.min}`);
  if (rules.max !== undefined && value > rules.max) ctx.fail(path, `must be <= ${rules.max}`);
}

export function readArray(
  ctx: ValidationContext,
  value: unknown,
  path: string,
  rules: ArrayRules = {},
): unknown[] | undefined {
  if (!Array.isArray(value)) {
    ctx.fail(path, 'must be an array');
    return undefined;
  }
  if (rules.minLength !== undefined && value.length < rules.minLength) {
    ctx.fail(path, `must have at least ${rules.minLength} items`);
  }
  if (rules.exactLength !== undefined && value.length !== rules.exactLength) {
    ctx.fail(path, `must have exactly ${rules.exactLength} items`);
  }
  return value;
}

export function checkStringArray(
  ctx: ValidationContext,
  value: unknown,
  path: string,
  rules: ArrayRules = {},
): void {
  readArray(ctx, value, path, rules)?.forEach((item, index) =>
    checkString(ctx, item, `${path}[${index}]`),
  );
}
