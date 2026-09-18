import { logger } from '../../src/utils/logger';

describe('Logger', () => {
  it('should be instantiated and contain standard logging levels', () => {
    expect(logger).toBeDefined();
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.error).toBe('function');
    expect(typeof logger.warn).toBe('function');
    expect(typeof logger.http).toBe('function');
    expect(typeof logger.debug).toBe('function');
  });
});
