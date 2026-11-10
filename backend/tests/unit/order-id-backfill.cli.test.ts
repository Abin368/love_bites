import {
  assertAllowedDatabaseTarget,
  assertNonProduction,
  executeOrderIdBackfillCli,
  exitCodeForBackfillResult,
  formatBackfillOutcome,
  normalizeHost,
  parsePaymentIdArg,
  resolveTargetDatabaseInfo,
  runOrderIdBackfillCli
} from '../../src/modules/payments/order-id-backfill.cli';
import type { OrderIdBackfillResult } from '../../src/modules/payments/order-id-backfill.service';

const PAYMENT_ID = '6e6e0001-0000-4000-8000-0000000000aa';
const ORDER_ID = 'order_backfill_1';

function captureIo() {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdoutChunks: stdout,
    stderrChunks: stderr,
    io: {
      stdout: { write(chunk: string) { stdout.push(chunk); } },
      stderr: { write(chunk: string) { stderr.push(chunk); } }
    },
    all() {
      return `${stdout.join('')}\n${stderr.join('')}`;
    }
  };
}

describe('order-id-backfill CLI helpers', () => {
  it('accepts a single payment UUID and rejects invalid input before any lookup', () => {
    expect(parsePaymentIdArg(['node', 'cli', PAYMENT_ID])).toEqual({
      kind: 'payment',
      paymentId: PAYMENT_ID
    });
    expect(parsePaymentIdArg(['node', 'cli', 'not-a-uuid'])).toEqual({
      kind: 'error',
      message: 'Payment id must be a valid UUID.'
    });
    expect(parsePaymentIdArg(['node', 'cli'])).toEqual({
      kind: 'error',
      message: 'Expected exactly one payment UUID argument.'
    });
    expect(parsePaymentIdArg(['node', 'cli', '--help']).kind).toBe('help');
  });

  it('blocks production and identifies the configured database without secrets', () => {
    expect(() => assertNonProduction('production')).toThrow(/production/i);
    expect(() => assertNonProduction('development')).not.toThrow();
    expect(
      resolveTargetDatabaseInfo({
        nodeEnv: 'development',
        databaseUrl: 'postgres://ops:super-secret@localhost:5432/love_bites_dev',
        dbHost: 'localhost',
        dbName: 'love_bites_dev'
      })
    ).toEqual({
      nodeEnv: 'development',
      host: 'localhost',
      database: 'love_bites_dev'
    });
  });

  it('normalizes IPv4 and IPv6 loopback hosts', () => {
    expect(normalizeHost('LocalHost')).toBe('localhost');
    expect(normalizeHost('127.0.0.1')).toBe('127.0.0.1');
    expect(normalizeHost('::1')).toBe('::1');
    expect(normalizeHost('[::1]')).toBe('::1');
    expect(
      resolveTargetDatabaseInfo({
        nodeEnv: 'development',
        databaseUrl: 'postgres://ops:secret@[::1]:5432/love_bites_test',
        dbHost: 'localhost',
        dbName: 'love_bites_dev'
      })
    ).toEqual({
      nodeEnv: 'development',
      host: '::1',
      database: 'love_bites_test'
    });
    expect(() =>
      assertAllowedDatabaseTarget({
        nodeEnv: 'development',
        host: normalizeHost('127.0.0.1'),
        database: 'love_bites_dev'
      })
    ).not.toThrow();
    expect(() =>
      assertAllowedDatabaseTarget({
        nodeEnv: 'development',
        host: normalizeHost('[::1]'),
        database: 'love_bites_test'
      })
    ).not.toThrow();
  });

  it('allows only exact local host and database pairs', () => {
    expect(() =>
      assertAllowedDatabaseTarget({
        nodeEnv: 'development',
        host: 'localhost',
        database: 'love_bites_dev'
      })
    ).not.toThrow();
    expect(() =>
      assertAllowedDatabaseTarget({
        nodeEnv: 'test',
        host: 'localhost',
        database: 'love_bites_test'
      })
    ).not.toThrow();
    expect(() =>
      assertAllowedDatabaseTarget({
        nodeEnv: 'development',
        host: 'localhost',
        database: 'love_bites_prod'
      })
    ).toThrow(/database/i);
    expect(() =>
      assertAllowedDatabaseTarget({
        nodeEnv: 'development',
        host: 'db.example.com',
        database: 'love_bites_dev'
      })
    ).toThrow(/host/i);
    expect(() =>
      assertAllowedDatabaseTarget({
        nodeEnv: 'development',
        host: 'localhost',
        database: 'love_bites_dev_backup'
      })
    ).toThrow(/database/i);
  });

  it('refuses invalid or missing database URL targets', () => {
    expect(() =>
      resolveTargetDatabaseInfo({
        nodeEnv: 'development',
        databaseUrl: '',
        dbHost: 'localhost',
        dbName: 'love_bites_dev'
      })
    ).toThrow(/DATABASE_URL is empty/i);
    expect(() =>
      resolveTargetDatabaseInfo({
        nodeEnv: 'development',
        databaseUrl: 'not-a-url',
        dbHost: 'localhost',
        dbName: 'love_bites_dev'
      })
    ).toThrow(/not a valid URL/i);
    expect(() =>
      resolveTargetDatabaseInfo({
        nodeEnv: 'development',
        databaseUrl: 'postgres:///love_bites_dev',
        dbHost: 'localhost',
        dbName: 'love_bites_dev'
      })
    ).toThrow(/missing a host or database name/i);
  });

  it('maps service outcomes to operator messages and exit codes', () => {
    expect(formatBackfillOutcome({ outcome: 'assigned', providerOrderId: ORDER_ID })).toContain(
      'Successfully associated'
    );
    expect(formatBackfillOutcome({ outcome: 'assigned', providerOrderId: ORDER_ID })).toContain(
      'NOT released'
    );
    expect(
      formatBackfillOutcome({ outcome: 'already_assigned', providerOrderId: ORDER_ID })
    ).toContain('already associated');
    expect(formatBackfillOutcome({ outcome: 'ineligible' })).toContain('not eligible');
    expect(formatBackfillOutcome({ outcome: 'unchanged', reason: 'no_match' })).toContain(
      'No matching Order appeared'
    );
    expect(formatBackfillOutcome({ outcome: 'unchanged', reason: 'no_match' })).toContain(
      'does not prove'
    );
    expect(formatBackfillOutcome({ outcome: 'unchanged', reason: 'no_match' })).toContain(
      'NOT released'
    );
    expect(formatBackfillOutcome({ outcome: 'unchanged', reason: 'ambiguous' })).toContain(
      'Multiple tied Orders'
    );
    expect(formatBackfillOutcome({ outcome: 'unchanged', reason: 'incomplete' })).toContain(
      'full page of 100'
    );
    expect(formatBackfillOutcome({ outcome: 'unchanged', reason: 'uncertain_window' })).toContain(
      '75-second'
    );
    expect(formatBackfillOutcome({ outcome: 'unchanged', reason: 'conflict' })).toContain(
      'Concurrent modification'
    );
    expect(exitCodeForBackfillResult({ outcome: 'assigned', providerOrderId: ORDER_ID })).toBe(0);
    expect(exitCodeForBackfillResult({ outcome: 'unchanged', reason: 'no_match' })).toBe(1);
  });
});

describe('runOrderIdBackfillCli', () => {
  const createOrder = jest.fn();
  const capture = jest.fn();
  const activate = jest.fn();
  const refund = jest.fn();

  beforeEach(() => {
    createOrder.mockReset();
    capture.mockReset();
    activate.mockReset();
    refund.mockReset();
  });

  async function run(options: {
    argv: string[];
    nodeEnv?: string;
    databaseUrl?: string;
    dbHost?: string;
    dbName?: string;
    backfill: jest.Mock;
  }) {
    const captured = captureIo();
    const code = await runOrderIdBackfillCli({
      argv: options.argv,
      nodeEnv: options.nodeEnv ?? 'development',
      databaseUrl:
        options.databaseUrl ?? 'postgres://ops:super-secret@localhost:5432/love_bites_dev',
      dbHost: options.dbHost ?? 'localhost',
      dbName: options.dbName ?? 'love_bites_dev',
      backfill: options.backfill,
      io: captured.io
    });
    return { code, captured };
  }

  it('invokes the existing backfill service for a valid payment UUID', async () => {
    const backfill = jest.fn(async (): Promise<OrderIdBackfillResult> => ({
      outcome: 'assigned',
      providerOrderId: ORDER_ID
    }));

    const { code, captured } = await run({
      argv: ['node', 'cli', PAYMENT_ID],
      backfill
    });

    expect(backfill).toHaveBeenCalledTimes(1);
    expect(backfill).toHaveBeenCalledWith(PAYMENT_ID);
    expect(code).toBe(0);
    expect(captured.all()).toContain('Successfully associated');
    expect(captured.all()).toContain(`database=love_bites_dev`);
    expect(captured.all()).not.toContain('super-secret');
    expect(createOrder).not.toHaveBeenCalled();
    expect(capture).not.toHaveBeenCalled();
    expect(activate).not.toHaveBeenCalled();
    expect(refund).not.toHaveBeenCalled();
  });

  it('allows love_bites_test on localhost', async () => {
    const backfill = jest.fn(async (): Promise<OrderIdBackfillResult> => ({
      outcome: 'already_assigned',
      providerOrderId: ORDER_ID
    }));

    const { code, captured } = await run({
      argv: ['node', 'cli', PAYMENT_ID],
      databaseUrl: 'postgres://ops:secret@127.0.0.1:5432/love_bites_test',
      backfill
    });

    expect(code).toBe(0);
    expect(backfill).toHaveBeenCalledTimes(1);
    expect(captured.all()).toContain('database=love_bites_test');
    expect(captured.all()).toContain('host=127.0.0.1');
  });

  it('rejects an invalid UUID before provider lookup', async () => {
    const backfill = jest.fn();
    const { code, captured } = await run({
      argv: ['node', 'cli', 'bad-id'],
      backfill
    });

    expect(backfill).not.toHaveBeenCalled();
    expect(code).toBe(2);
    expect(captured.all()).toContain('Payment id must be a valid UUID.');
  });

  it('reports no-match and ambiguous outcomes without implying a status change', async () => {
    const backfill = jest
      .fn()
      .mockResolvedValueOnce({ outcome: 'unchanged', reason: 'no_match' })
      .mockResolvedValueOnce({ outcome: 'unchanged', reason: 'ambiguous' });

    const noMatch = await run({ argv: ['node', 'cli', PAYMENT_ID], backfill });
    expect(noMatch.code).toBe(1);
    expect(noMatch.captured.all()).toContain('No matching Order appeared');
    expect(noMatch.captured.all()).toContain('does not prove');
    expect(noMatch.captured.all()).toContain('Payment remains unchanged');

    const ambiguous = await run({ argv: ['node', 'cli', PAYMENT_ID], backfill });
    expect(ambiguous.code).toBe(1);
    expect(ambiguous.captured.all()).toContain('Multiple tied Orders');
  });

  it('reports ineligible, already-assigned, and concurrent-assignment outcomes', async () => {
    const backfill = jest
      .fn()
      .mockResolvedValueOnce({ outcome: 'ineligible' })
      .mockResolvedValueOnce({ outcome: 'already_assigned', providerOrderId: ORDER_ID })
      .mockResolvedValueOnce({ outcome: 'unchanged', reason: 'conflict' });

    const ineligible = await run({ argv: ['node', 'cli', PAYMENT_ID], backfill });
    expect(ineligible.code).toBe(1);
    expect(ineligible.captured.all()).toContain('not eligible');

    const existing = await run({ argv: ['node', 'cli', PAYMENT_ID], backfill });
    expect(existing.code).toBe(0);
    expect(existing.captured.all()).toContain('already associated');

    const conflict = await run({ argv: ['node', 'cli', PAYMENT_ID], backfill });
    expect(conflict.code).toBe(1);
    expect(conflict.captured.all()).toContain('Concurrent modification');
  });

  it('surfaces provider lookup errors without claiming a payment status change', async () => {
    const backfill = jest.fn(async () => {
      throw new Error('provider timeout');
    });

    const { code, captured } = await run({
      argv: ['node', 'cli', PAYMENT_ID],
      backfill
    });

    expect(code).toBe(1);
    expect(captured.all()).toContain('provider timeout');
    expect(captured.all()).toContain('Payment status was not changed');
  });

  it('blocks production execution before calling backfill', async () => {
    const backfill = jest.fn();
    const { code, captured } = await run({
      argv: ['node', 'cli', PAYMENT_ID],
      nodeEnv: 'production',
      backfill
    });

    expect(backfill).not.toHaveBeenCalled();
    expect(code).toBe(2);
    expect(captured.all()).toMatch(/Refusing to run.*production/i);
    expect(captured.all()).not.toContain('super-secret');
  });

  it('refuses a production database name on localhost', async () => {
    const backfill = jest.fn();
    const { code, captured } = await run({
      argv: ['node', 'cli', PAYMENT_ID],
      databaseUrl: 'postgres://ops:secret@localhost:5432/love_bites_prod',
      backfill
    });

    expect(backfill).not.toHaveBeenCalled();
    expect(code).toBe(2);
    expect(captured.all()).toMatch(/database "love_bites_prod"/i);
  });

  it('refuses love_bites_dev on a remote host', async () => {
    const backfill = jest.fn();
    const { code, captured } = await run({
      argv: ['node', 'cli', PAYMENT_ID],
      databaseUrl: 'postgres://ops:secret@db.example.com:5432/love_bites_dev',
      backfill
    });

    expect(backfill).not.toHaveBeenCalled();
    expect(code).toBe(2);
    expect(captured.all()).toMatch(/host "db.example.com"/i);
  });

  it('refuses development NODE_ENV with a production DATABASE_URL', async () => {
    const backfill = jest.fn();
    const { code, captured } = await run({
      argv: ['node', 'cli', PAYMENT_ID],
      nodeEnv: 'development',
      databaseUrl: 'postgres://ops:secret@prod-db.example.com:5432/love_bites',
      backfill
    });

    expect(backfill).not.toHaveBeenCalled();
    expect(code).toBe(2);
    expect(captured.all()).toMatch(/host "prod-db.example.com"/i);
    expect(captured.all()).not.toContain('secret');
  });

  it('never invokes order creation, capture, subscription activation, or refund hooks', async () => {
    const backfill = jest.fn(async (): Promise<OrderIdBackfillResult> => ({
      outcome: 'assigned',
      providerOrderId: ORDER_ID
    }));

    await run({ argv: ['node', 'cli', PAYMENT_ID], backfill });

    expect(createOrder).not.toHaveBeenCalled();
    expect(capture).not.toHaveBeenCalled();
    expect(activate).not.toHaveBeenCalled();
    expect(refund).not.toHaveBeenCalled();
    expect(backfill).toHaveBeenCalledTimes(1);
  });
});

describe('executeOrderIdBackfillCli target gating', () => {
  it('does not initialize Sequelize or invoke backfill when the target is refused', async () => {
    const captured = captureIo();
    const loadEnv = jest.fn(async () => ({
      nodeEnv: 'development',
      databaseUrl: 'postgres://ops:secret@prod.example.com:5432/love_bites_dev',
      dbHost: 'localhost',
      dbName: 'love_bites_dev'
    }));
    const loadRuntime = jest.fn(async () => ({
      backfill: jest.fn()
    }));

    const code = await executeOrderIdBackfillCli({
      argv: ['node', 'cli', PAYMENT_ID],
      processNodeEnv: 'development',
      loadEnv,
      loadRuntime,
      io: captured.io
    });

    expect(code).toBe(2);
    expect(loadEnv).toHaveBeenCalledTimes(1);
    expect(loadRuntime).not.toHaveBeenCalled();
    expect(captured.all()).toMatch(/host "prod.example.com"/i);
  });

  it('loads runtime only after an allowlisted local target is validated', async () => {
    const captured = captureIo();
    const backfill = jest.fn(async (): Promise<OrderIdBackfillResult> => ({
      outcome: 'assigned',
      providerOrderId: ORDER_ID
    }));
    const loadRuntime = jest.fn(async () => ({ backfill }));

    const code = await executeOrderIdBackfillCli({
      argv: ['node', 'cli', PAYMENT_ID],
      processNodeEnv: 'development',
      loadEnv: async () => ({
        nodeEnv: 'development',
        databaseUrl: 'postgres://ops:secret@localhost:5432/love_bites_dev',
        dbHost: 'localhost',
        dbName: 'love_bites_dev'
      }),
      loadRuntime,
      io: captured.io
    });

    expect(code).toBe(0);
    expect(loadRuntime).toHaveBeenCalledTimes(1);
    expect(backfill).toHaveBeenCalledWith(PAYMENT_ID);
    expect(captured.all()).toContain('host=localhost');
    expect(captured.all()).toContain('database=love_bites_dev');
  });

  it('refuses NODE_ENV=production before loading env or runtime', async () => {
    const captured = captureIo();
    const loadEnv = jest.fn();
    const loadRuntime = jest.fn();

    const code = await executeOrderIdBackfillCli({
      argv: ['node', 'cli', PAYMENT_ID],
      processNodeEnv: 'production',
      loadEnv,
      loadRuntime,
      io: captured.io
    });

    expect(code).toBe(2);
    expect(loadEnv).not.toHaveBeenCalled();
    expect(loadRuntime).not.toHaveBeenCalled();
  });
});
