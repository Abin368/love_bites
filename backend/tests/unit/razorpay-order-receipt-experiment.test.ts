import fs from 'fs';
import path from 'path';

jest.mock('razorpay', () => {
  const calls = {
    create: jest.fn(),
    all: jest.fn(),
    fetch: jest.fn(),
    capture: jest.fn(),
    refund: jest.fn()
  };
  const constructed: Array<{ key_id?: string; key_secret?: string }> = [];

  function Razorpay(config: { key_id?: string; key_secret?: string }) {
    constructed.push(config);
    return {
      orders: {
        create: calls.create,
        all: calls.all,
        fetch: calls.fetch
      },
      payments: {
        capture: calls.capture,
        refund: calls.refund
      }
    };
  }

  return Object.assign(Razorpay, { calls, constructed });
});

import {
  ExperimentRefusal,
  UNDELETABLE_WARNING,
  assertReceipt,
  buildReceipt,
  createOrdersClient,
  dispatchExperiment,
  orderCreateBody,
  parseExperimentArgs,
  readCredentialFile,
  readProviderFailure,
  runExperiment,
  runListWindow,
  safeConfigMetadata,
  summarizeCollection,
  summarizeOrderResponse,
  validateExperimentEnv
} from '../../scripts/razorpay-order-receipt-experiment.js';

const TEST_KEY = 'rzp_test_example';
const LIVE_KEY = 'rzp_live_example';
const SECRET = 'test-secret-not-real';
const SCRIPT_PATH = path.resolve(__dirname, '../../scripts/razorpay-order-receipt-experiment.js');

type RazorpayMock = {
  calls: {
    create: jest.Mock;
    all: jest.Mock;
    fetch: jest.Mock;
    capture: jest.Mock;
    refund: jest.Mock;
  };
  constructed: Array<{ key_id?: string; key_secret?: string }>;
};

function razorpayMock(): RazorpayMock {
  return jest.requireMock('razorpay') as RazorpayMock;
}

function acceptedEnv(overrides: Record<string, string | undefined> = {}) {
  return validateExperimentEnv({
    shellNodeEnv: 'development',
    fileNodeEnv: 'development',
    fileKeyId: TEST_KEY,
    fileKeySecret: SECRET,
    shellKeyId: undefined,
    ...overrides
  });
}

function captureStdout() {
  const chunks: string[] = [];
  return {
    chunks,
    stdout: { write(chunk: string) { chunks.push(chunk); } },
    text() { return chunks.join(''); },
    records() {
      return chunks
        .join('')
        .split('\n')
        .filter((line) => line.startsWith('{'))
        .map((line) => JSON.parse(line) as Record<string, unknown>);
    }
  };
}

describe('Razorpay receipt experiment safety', () => {
  it('refuses production from the shell or the env file without echoing credentials', () => {
    expect(() => acceptedEnv({ shellNodeEnv: 'production' })).toThrow(ExperimentRefusal);
    expect(() => acceptedEnv({ fileNodeEnv: 'production' })).toThrow(ExperimentRefusal);
    expect(() => acceptedEnv({ shellNodeEnv: ' production ', fileNodeEnv: 'development' })).toThrow(
      /production/
    );

    try {
      acceptedEnv({ shellNodeEnv: 'production', fileKeyId: TEST_KEY, fileKeySecret: SECRET });
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      expect(message).not.toContain(TEST_KEY);
      expect(message).not.toContain(SECRET);
    }
  });

  it('refuses missing credentials and a non-test file key', () => {
    expect(() => acceptedEnv({ fileKeyId: '' })).toThrow(/credentials are missing/);
    expect(() => acceptedEnv({ fileKeySecret: '   ' })).toThrow(/credentials are missing/);
    expect(() => acceptedEnv({ fileKeyId: undefined, fileKeySecret: undefined })).toThrow(
      /credentials are missing/
    );
    expect(() => acceptedEnv({ fileKeyId: 'rzp_other_example' })).toThrow(/not a Razorpay test key/);
  });

  it('refuses a live key in the file or the shell and accepts a test file key', () => {
    expect(() => acceptedEnv({ fileKeyId: LIVE_KEY })).toThrow(/live Razorpay key/);
    expect(() => acceptedEnv({ shellKeyId: ` ${LIVE_KEY} ` })).toThrow(/live Razorpay key/);

    try {
      acceptedEnv({ shellKeyId: LIVE_KEY });
      throw new Error('expected refusal');
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      expect(message).not.toContain(LIVE_KEY);
      expect(message).not.toContain(TEST_KEY);
      expect(message).not.toContain(SECRET);
    }

    const accepted = acceptedEnv({ shellKeyId: 'unrelated-shell-value' });
    expect(accepted.keyId).toBe(TEST_KEY);
    expect(accepted.keySecret).toBe(SECRET);
    const metadata = JSON.stringify(safeConfigMetadata(accepted));
    expect(metadata).toContain('"keyIdHasTestPrefix":true');
    expect(metadata).toContain(`"keyIdLength":${TEST_KEY.length}`);
    expect(metadata).toContain('"secretPresent":true');
    expect(metadata).not.toContain(TEST_KEY);
    expect(metadata).not.toContain(SECRET);
    expect(metadata).not.toContain('unrelated-shell-value');
  });

  it('reads only the three credential fields from env text', () => {
    const parsed = readCredentialFile(
      [
        'NODE_ENV=development',
        `RAZORPAY_KEY_ID=${TEST_KEY}`,
        `RAZORPAY_KEY_SECRET=${SECRET}`,
        'DATABASE_URL=postgres://user:secret-db@localhost:5432/love_bites_dev',
        'JWT_ACCESS_SECRET=not-a-razorpay-secret'
      ].join('\n')
    );

    expect(parsed).toEqual({
      fileNodeEnv: 'development',
      fileKeyId: TEST_KEY,
      fileKeySecret: SECRET
    });
    expect(parsed).not.toHaveProperty('DATABASE_URL');
    expect(parsed).not.toHaveProperty('JWT_ACCESS_SECRET');
  });

  it('keeps generated receipts inside the 40-character lbexp limit', () => {
    const receipt = buildReceipt('abcd1234', 'none');
    expect(receipt.startsWith('lbexp')).toBe(true);
    expect(receipt.length).toBeLessThanOrEqual(40);
    expect(assertReceipt(`${'lbexp'}${'a'.repeat(35)}`)).toHaveLength(40);
    expect(() => assertReceipt(`${'lbexp'}${'a'.repeat(36)}`)).toThrow(/40 characters/);
    expect(() => assertReceipt('')).toThrow(ExperimentRefusal);
    expect(() => assertReceipt('order-real-payment')).toThrow(/lbexp/);
    expect(() => buildReceipt('abcd1234', 'slot-with-dash')).toThrow(ExperimentRefusal);
  });

  it('builds an unpaid order body without a payment id or customer fields', () => {
    const body = orderCreateBody('lbexpabcd1234a', 'abcd1234', 'a');
    expect(body).toEqual({
      amount: 100,
      currency: 'INR',
      receipt: 'lbexpabcd1234a',
      notes: {
        experiment: 'lb-order-receipt-probe',
        run: 'abcd1234',
        slot: 'a'
      }
    });
    expect(body.notes).not.toHaveProperty('paymentId');
  });

  it('reports collection and order shapes without unapproved values', () => {
    const secretNote = 'note-value-must-stay-hidden';
    const collection = summarizeCollection('lookup-a-count-2-skip-0', {
      entity: 'collection',
      count: 1,
      items: [
        {
          id: 'order_example_a',
          entity: 'order',
          amount: 100,
          currency: 'INR',
          receipt: 'lbexpabcd1234a',
          status: 'created',
          attempts: 0,
          amount_paid: 0,
          amount_due: 100,
          created_at: 1700000000,
          notes: { experiment: 'lb-order-receipt-probe', run: secretNote, slot: 'a' },
          email: 'person@example.com',
          card: { last4: '4242' }
        }
      ],
      email: 'person@example.com',
      secret: SECRET
    });

    const serialized = JSON.stringify(collection);
    expect(collection.topLevelKeys).toEqual(['count', 'email', 'entity', 'items', 'secret']);
    expect(collection.entity).toBe('collection');
    expect(collection.countType).toBe('number');
    expect(collection.count).toBe(1);
    expect(collection.itemsLength).toBe(1);
    expect(collection.countEqualsItemsLength).toBe(true);
    expect(collection.orders[0]).toMatchObject({
      id: 'order_example_a',
      notesType: 'object',
      notesKeys: ['experiment', 'run', 'slot']
    });
    expect(serialized).not.toContain(SECRET);
    expect(serialized).not.toContain(secretNote);
    expect(serialized).not.toContain('person@example.com');
    expect(serialized).not.toContain('4242');
    expect(collection.orders[0]).not.toHaveProperty('email');

    const fetched = summarizeOrderResponse('fetch-order-a', {
      id: 'order_example_a',
      entity: 'order',
      amount: 100,
      email: 'person@example.com'
    });
    expect(fetched.countType).toBe('absent');
    expect(fetched.countEqualsItemsLength).toBeNull();
    expect(JSON.stringify(fetched)).not.toContain('person@example.com');
  });

  it('keeps provider failures to status and code', () => {
    const failure = readProviderFailure({
      statusCode: 400,
      error: {
        code: 'BAD_REQUEST_ERROR',
        description: `duplicate ${SECRET}`,
        metadata: { key: TEST_KEY }
      },
      config: { auth: { password: SECRET }, headers: { Authorization: 'Basic abc' } },
      response: { data: SECRET }
    });

    expect(failure).toEqual({ statusCode: 400, errorCode: 'BAD_REQUEST_ERROR' });
    expect(JSON.stringify(failure)).not.toContain(SECRET);
    expect(JSON.stringify(failure)).not.toContain(TEST_KEY);
    expect(JSON.stringify(failure)).not.toContain('Basic');
  });
});

describe('Razorpay receipt experiment sequence', () => {
  const scriptSource = fs.readFileSync(SCRIPT_PATH, 'utf8');

  beforeEach(() => {
    const mock = razorpayMock();
    mock.constructed.length = 0;
    mock.calls.create.mockReset();
    mock.calls.all.mockReset();
    mock.calls.fetch.mockReset();
    mock.calls.capture.mockReset();
    mock.calls.refund.mockReset();
  });

  it('stays isolated from the application and from payment operations', () => {
    expect(scriptSource).not.toContain('dotenv.config');
    expect(scriptSource).not.toMatch(/sequelize|require\('pg'\)|config\/database|config\/env/);
    expect(scriptSource).not.toMatch(/payments\.service|razorpay-webhook|order-id-backfill/);
    expect(scriptSource).not.toMatch(/\.capture\(|\.refund\(|paymentLink|subscriptions|customers/);
    expect(scriptSource).toContain(UNDELETABLE_WARNING);
  });

  it('runs the audited sequence through the mocked SDK and redacts a duplicate failure', async () => {
    const mock = razorpayMock();
    const ordersById = new Map<string, Record<string, unknown>>();

    mock.calls.all.mockImplementation(async (params: { receipt: string; count: number; skip: number }) => {
      const matches = [...ordersById.values()].filter((order) => order.receipt === params.receipt);
      const items = matches.slice(params.skip, params.skip + params.count);
      return {
        entity: 'collection',
        count: items.length,
        items,
        secret: SECRET
      };
    });
    mock.calls.create.mockImplementation(async (body: { receipt: string; notes: { slot: string }; amount: number; currency: string }) => {
      if ([...ordersById.values()].some((order) => order.receipt === body.receipt)) {
        throw {
          statusCode: 400,
          error: { code: 'BAD_REQUEST_ERROR', description: `duplicate ${SECRET}` },
          config: { auth: { password: SECRET } }
        };
      }
      const created = {
        id: `order_${body.notes.slot}`,
        entity: 'order',
        amount: body.amount,
        currency: body.currency,
        receipt: body.receipt,
        status: 'created',
        attempts: 0,
        amount_paid: 0,
        amount_due: body.amount,
        created_at: 1700000000,
        notes: body.notes,
        email: 'person@example.com'
      };
      ordersById.set(created.id, created);
      return created;
    });
    mock.calls.fetch.mockImplementation(async (orderId: string) => {
      const order = ordersById.get(orderId);
      return order ? { ...order, contact: '9999999999' } : null;
    });

    const client = createOrdersClient(TEST_KEY, SECRET);
    const output = captureStdout();
    await runExperiment(client, output.stdout);

    expect(mock.constructed).toEqual([{ key_id: TEST_KEY, key_secret: SECRET }]);
    expect(mock.calls.capture).not.toHaveBeenCalled();
    expect(mock.calls.refund).not.toHaveBeenCalled();
    expect(mock.calls.create).toHaveBeenCalledTimes(3);
    expect(mock.calls.fetch).toHaveBeenCalledTimes(1);
    expect(mock.calls.all.mock.calls.map((call) => call[0])).toEqual([
      expect.objectContaining({ count: 2, skip: 0 }),
      expect.objectContaining({ count: 2, skip: 0 }),
      expect.objectContaining({ count: 1, skip: 0 }),
      expect.objectContaining({ count: 1, skip: 1 }),
      expect.objectContaining({ count: 2, skip: 0 }),
      expect.objectContaining({ count: 2, skip: 0 })
    ]);

    const firstCreate = mock.calls.create.mock.calls[0][0] as { amount: number; notes: Record<string, string> };
    expect(firstCreate.amount).toBe(100);
    expect(firstCreate.notes).not.toHaveProperty('paymentId');

    const records = output.records();
    expect(records.map((record) => record.operation)).toEqual([
      'plan',
      'lookup-never-created-before',
      'create-order-a',
      'fetch-order-a',
      'lookup-a-count-2-skip-0',
      'lookup-a-count-1-skip-0',
      'lookup-a-count-1-skip-1',
      'create-order-b',
      'lookup-a-after-b',
      'lookup-never-created-after',
      'create-duplicate-receipt'
    ]);

    const appLookup = records.find((record) => record.operation === 'lookup-a-count-2-skip-0');
    expect(appLookup).toMatchObject({
      countType: 'number',
      count: 1,
      itemsLength: 1,
      countEqualsItemsLength: true
    });
    const afterOther = records.find((record) => record.operation === 'lookup-a-after-b');
    expect(afterOther).toMatchObject({ count: 1, itemsLength: 1 });
    expect(records.find((record) => record.operation === 'create-duplicate-receipt')).toEqual({
      operation: 'create-duplicate-receipt',
      outcome: 'failed',
      statusCode: 400,
      errorCode: 'BAD_REQUEST_ERROR'
    });

    const text = output.text();
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain(TEST_KEY);
    expect(text).not.toContain('person@example.com');
    expect(text).not.toContain('9999999999');
    expect(text).not.toContain(`duplicate ${SECRET}`);
  });

  it('stops on an unexpected provider error without a payment or cleanup call', async () => {
    const mock = razorpayMock();
    mock.calls.all.mockRejectedValue({
      statusCode: '500',
      error: { code: 'SERVER_ERROR', description: SECRET },
      config: { headers: { Authorization: `Bearer ${SECRET}` } }
    });

    const output = captureStdout();
    await expect(runExperiment(createOrdersClient(TEST_KEY, SECRET), output.stdout)).rejects.toThrow(
      'orders.all failed (status=500, code=SERVER_ERROR).'
    );
    expect(mock.calls.create).not.toHaveBeenCalled();
    expect(mock.calls.capture).not.toHaveBeenCalled();
    expect(mock.calls.refund).not.toHaveBeenCalled();
    expect(output.text()).not.toContain(SECRET);
  });
});

const CREATED_AT = 1762300000;
const RECEIPT_A = 'lbexpwindowa';
const RECEIPT_B = 'lbexpwindowb';
const UNMATCHED_RECEIPT = 'lbexpwindowax';
const HIDDEN_NOTE = 'hidden-note-value';
const HIDDEN_EMAIL = 'hidden-person@example.com';

function captureIo() {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    io: {
      stdout: { write(chunk: string) { stdout.push(chunk); } },
      stderr: { write(chunk: string) { stderr.push(chunk); } }
    },
    text() {
      return `${stdout.join('')}\n${stderr.join('')}`;
    },
    records() {
      return stdout
        .join('')
        .split('\n')
        .filter((line) => line.startsWith('{'))
        .map((line) => JSON.parse(line) as Record<string, unknown>);
    }
  };
}

function listArgv(createdAt: string = String(CREATED_AT), receipts: string[] = [RECEIPT_A, RECEIPT_B]) {
  return ['node', 'script', '--list-window', '--created-at', createdAt, ...receipts.flatMap((receipt) => ['--receipt', receipt])];
}

function listedOrder(receipt: string, id: string) {
  return {
    id,
    entity: 'order',
    amount: 100,
    currency: 'INR',
    receipt,
    status: 'created',
    attempts: 0,
    amount_paid: 0,
    amount_due: 100,
    created_at: CREATED_AT,
    notes: { experiment: 'lb-order-receipt-probe', run: HIDDEN_NOTE, slot: 'a' },
    email: HIDDEN_EMAIL,
    card: { last4: '4242' }
  };
}

describe('Razorpay read-only order listing', () => {
  const scriptSource = fs.readFileSync(SCRIPT_PATH, 'utf8');

  it('lists only the supplied receipts through orders.all', async () => {
    const unmatched = listedOrder(UNMATCHED_RECEIPT, 'order_unmatched');
    const items = [
      unmatched,
      listedOrder(RECEIPT_A, 'order_a'),
      listedOrder(`${RECEIPT_A} `, 'order_padded'),
      listedOrder(RECEIPT_B, 'order_b'),
      ...Array.from({ length: 96 }, (_, index) => listedOrder(`other${index}`, `order_other_${index}`))
    ];
    const orders = {
      all: jest.fn().mockResolvedValue({
        entity: 'collection',
        count: items.length,
        items,
        secret: SECRET,
        email: HIDDEN_EMAIL
      }),
      create: jest.fn(),
      fetch: jest.fn(),
      capture: jest.fn(),
      refund: jest.fn()
    };
    const output = captureStdout();

    await runListWindow(orders, output.stdout, {
      kind: 'list-window',
      createdAt: CREATED_AT,
      from: CREATED_AT - 60,
      to: CREATED_AT + 300,
      receipts: [RECEIPT_A, RECEIPT_B]
    });

    expect(orders.all).toHaveBeenCalledTimes(1);
    expect(orders.all).toHaveBeenCalledWith({
      from: CREATED_AT - 60,
      to: CREATED_AT + 300,
      count: 100,
      skip: 0
    });
    expect(orders.all.mock.calls[0][0]).not.toHaveProperty('receipt');
    expect(orders.create).not.toHaveBeenCalled();
    expect(orders.fetch).not.toHaveBeenCalled();
    expect(orders.capture).not.toHaveBeenCalled();
    expect(orders.refund).not.toHaveBeenCalled();

    const report = output.records()[0];
    expect(report).toMatchObject({
      operation: 'list-window',
      from: CREATED_AT - 60,
      to: CREATED_AT + 300,
      entity: 'collection',
      countType: 'number',
      count: 100,
      itemsLength: 100,
      countEqualsItemsLength: true,
      matchedCount: 2,
      pageFull: true
    });
    expect(report.orders).toEqual([
      expect.objectContaining({ id: 'order_a', receipt: RECEIPT_A, notesType: 'object' }),
      expect.objectContaining({ id: 'order_b', receipt: RECEIPT_B })
    ]);

    const text = output.text();
    expect(text).not.toContain(UNMATCHED_RECEIPT);
    expect(text).not.toContain('order_unmatched');
    expect(text).not.toContain('order_padded');
    expect(text).not.toContain('order_other_0');
    expect(text).not.toContain(HIDDEN_NOTE);
    expect(text).not.toContain(HIDDEN_EMAIL);
    expect(text).not.toContain('4242');
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain(TEST_KEY);
  });

  it('rejects invalid timestamps and receipts before any provider call', async () => {
    const cases = [
      listArgv(''),
      listArgv('0'),
      listArgv('-5'),
      listArgv('1700000000.5'),
      listArgv('1700000000000'),
      listArgv(String(CREATED_AT), [RECEIPT_A]),
      listArgv(String(CREATED_AT), [RECEIPT_A, RECEIPT_A]),
      listArgv(String(CREATED_AT), [RECEIPT_A, '']),
      listArgv(String(CREATED_AT), [RECEIPT_A, 'x'.repeat(41)]),
      listArgv(String(CREATED_AT), [RECEIPT_A, RECEIPT_B, 'lbexpthird']),
      ['node', 'script', '--list-window', '--receipt', RECEIPT_A, '--receipt', RECEIPT_B]
    ];

    for (const argv of cases) {
      const parsed = parseExperimentArgs(argv);
      expect(parsed.kind).toBe('error');
      const orders = { all: jest.fn(), create: jest.fn(), fetch: jest.fn() };
      const output = captureIo();
      const code = await dispatchExperiment(argv, {
        io: output.io,
        loadCredentials: jest.fn(),
        createOrders: jest.fn(() => orders),
        runCreate: runExperiment,
        runList: runListWindow
      });
      expect(code).toBe(2);
      expect(orders.all).not.toHaveBeenCalled();
      expect(orders.create).not.toHaveBeenCalled();
      expect(orders.fetch).not.toHaveBeenCalled();
      expect(output.text()).not.toContain(TEST_KEY);
      expect(output.text()).not.toContain(SECRET);
    }

    expect(parseExperimentArgs(listArgv('1700000000000')).message).toMatch(/millisecond/);
    expect(parseExperimentArgs(listArgv(String(CREATED_AT))).kind).toBe('list-window');
  });

  it('makes no API call for usage, unknown flags, or conflicting modes', async () => {
    const argvs = [
      ['node', 'script'],
      ['node', 'script', '--bogus'],
      ['node', 'script', '--create', '--list-window'],
      ['node', 'script', '--list-window', '--create', '--created-at', String(CREATED_AT)],
      ['node', 'script', '--created-at', String(CREATED_AT), '--receipt', RECEIPT_A, '--receipt', RECEIPT_B]
    ];

    for (const argv of argvs) {
      const orders = { all: jest.fn(), create: jest.fn(), fetch: jest.fn(), capture: jest.fn() };
      const loadCredentials = jest.fn();
      const output = captureIo();
      const code = await dispatchExperiment(argv, {
        io: output.io,
        loadCredentials,
        createOrders: jest.fn(() => orders),
        runCreate: runExperiment,
        runList: runListWindow
      });
      expect(loadCredentials).not.toHaveBeenCalled();
      expect(orders.all).not.toHaveBeenCalled();
      expect(orders.create).not.toHaveBeenCalled();
      expect(orders.fetch).not.toHaveBeenCalled();
      expect(orders.capture).not.toHaveBeenCalled();
      expect(code).toBe(argv.length === 2 ? 0 : 2);
    }
  });

  it('runs the original experiment only when --create is explicit', async () => {
    expect(scriptSource).toContain('runCreate: runExperiment');
    const orders = {
      all: jest.fn().mockResolvedValue({ entity: 'collection', count: 0, items: [] }),
      create: jest.fn(async (body: { notes: { slot: string }; receipt: string; amount: number; currency: string }) => ({
        id: `order_${body.notes.slot}`,
        entity: 'order',
        amount: body.amount,
        currency: body.currency,
        receipt: body.receipt,
        status: 'created',
        attempts: 0,
        amount_paid: 0,
        amount_due: body.amount,
        created_at: CREATED_AT,
        notes: body.notes
      })),
      fetch: jest.fn(async (id: string) => ({
        id,
        entity: 'order',
        amount: 100,
        currency: 'INR',
        receipt: RECEIPT_A,
        status: 'created',
        attempts: 0,
        amount_paid: 0,
        amount_due: 100,
        created_at: CREATED_AT,
        notes: { experiment: 'lb-order-receipt-probe' }
      })),
      capture: jest.fn(),
      refund: jest.fn()
    };
    const output = captureIo();
    const code = await dispatchExperiment(['node', 'script', '--create'], {
      io: output.io,
      loadCredentials: async () => acceptedEnv(),
      createOrders: () => orders,
      runCreate: runExperiment,
      runList: runListWindow
    });

    expect(code).toBe(0);
    expect(orders.create).toHaveBeenCalled();
    expect(orders.fetch).toHaveBeenCalled();
    expect(orders.capture).not.toHaveBeenCalled();
    expect(orders.refund).not.toHaveBeenCalled();
    expect(output.text()).toContain(UNDELETABLE_WARNING);
    expect(output.text()).not.toContain(TEST_KEY);
    expect(output.text()).not.toContain(SECRET);

    const listOrders = { all: jest.fn(), create: jest.fn(), fetch: jest.fn() };
    const listOutput = captureIo();
    await dispatchExperiment(listArgv(), {
      io: listOutput.io,
      loadCredentials: async () => {
        throw new ExperimentRefusal('Refusing to run because NODE_ENV is production.');
      },
      createOrders: () => listOrders,
      runCreate: runExperiment,
      runList: runListWindow
    });
    expect(listOrders.all).not.toHaveBeenCalled();
    expect(listOrders.create).not.toHaveBeenCalled();
    expect(listOrders.fetch).not.toHaveBeenCalled();
    expect(listOutput.text()).not.toContain(TEST_KEY);
    expect(listOutput.text()).not.toContain(SECRET);
  });
});
