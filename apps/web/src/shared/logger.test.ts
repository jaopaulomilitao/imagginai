import { describe, expect, it } from 'vitest';

import { createLogger, type LogLevel } from './logger';

describe('createLogger', () => {
  it('drops messages below the minimum level', () => {
    const received: LogLevel[] = [];
    const logger = createLogger('warn', (level) => received.push(level));

    logger.debug('a');
    logger.info('b');
    logger.warn('c');
    logger.error('d');

    expect(received).toEqual(['warn', 'error']);
  });
});
