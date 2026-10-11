export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type LogSink = (level: LogLevel, message: string, context?: unknown) => void;

const LEVEL_WEIGHT: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/* eslint-disable no-console -- é o único ponto autorizado a escrever no console */
const consoleSink: LogSink = (level, message, context) => {
  const line = `[imagginai] ${message}`;
  if (context === undefined) {
    console[level](line);
    return;
  }
  console[level](line, context);
};
/* eslint-enable no-console */

export interface Logger {
  debug(message: string, context?: unknown): void;
  info(message: string, context?: unknown): void;
  warn(message: string, context?: unknown): void;
  error(message: string, context?: unknown): void;
}

export function createLogger(minLevel: LogLevel, sink: LogSink = consoleSink): Logger {
  // são descartadas as mensagens abaixo do nível mínimo configurado
  const emit = (level: LogLevel) => (message: string, context?: unknown) => {
    if (LEVEL_WEIGHT[level] >= LEVEL_WEIGHT[minLevel]) sink(level, message, context);
  };
  return { debug: emit('debug'), info: emit('info'), warn: emit('warn'), error: emit('error') };
}

export const logger = createLogger(import.meta.env.DEV ? 'debug' : 'warn');
