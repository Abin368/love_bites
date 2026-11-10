'use strict';

/**
 * Manual Test Mode receipt probe. Run from backend/:
 *   node scripts/razorpay-order-receipt-experiment.js --create
 *   node scripts/razorpay-order-receipt-experiment.js --list-window --created-at <unix-seconds> --receipt <receiptA> --receipt <receiptB>
 *
 * No arguments prints usage and makes no API call.
 * --list-window is read-only. --create runs the Order creation experiment.
 * Not an npm script. Not part of checkout, webhooks, or Order-ID backfill.
 * Parses backend/.env with dotenv.parse. Does not call dotenv's config helper.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const RECEIPT_MAX_LENGTH = 40;
const RECEIPT_PREFIX = 'lbexp';
const TEST_KEY_PREFIX = 'rzp_test_';
const LIVE_KEY_PREFIX = 'rzp_live_';
const ORDER_AMOUNT_PAISE = 100;
const EXPERIMENT_NOTE = 'lb-order-receipt-probe';
const WINDOW_BEFORE_SECONDS = 60;
const WINDOW_AFTER_SECONDS = 300;
const LIST_WINDOW_COUNT = 100;

const USAGE = `Love Bite — Razorpay Test Mode receipt experiment

Usage:
  node scripts/razorpay-order-receipt-experiment.js --create
  node scripts/razorpay-order-receipt-experiment.js --list-window --created-at <unix-seconds> --receipt <receiptA> --receipt <receiptB>

--create runs the Order creation experiment.
--list-window is read-only. It does not create Orders.
No arguments prints this usage and makes no API call.
`;

const ORDER_FIELDS = [
  'id',
  'entity',
  'amount',
  'currency',
  'receipt',
  'status',
  'attempts',
  'amount_paid',
  'amount_due',
  'created_at'
];

const UNDELETABLE_WARNING =
  'WARNING: Unpaid Test Mode Orders created by this script cannot be deleted through the installed Razorpay SDK. They remain in the Test Mode dashboard. This script does not capture, refund, or cancel them, and a later failure does not attempt cleanup.';

class ExperimentRefusal extends Error {
  constructor(message) {
    super(message);
    this.name = 'ExperimentRefusal';
    this.exitCode = 2;
  }
}

class ExperimentFailure extends Error {
  constructor(message) {
    super(message);
    this.name = 'ExperimentFailure';
    this.exitCode = 1;
  }
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeEnv(value) {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim();
}

function normalizeCredential(value) {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim();
}

function isReportablePrimitive(value) {
  return value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

function describeType(value) {
  if (value === null) {
    return 'null';
  }
  if (Array.isArray(value)) {
    return 'array';
  }
  return typeof value;
}

function readCredentialFile(contents) {
  const parsed = dotenv.parse(Buffer.isBuffer(contents) ? contents : String(contents));
  return {
    fileNodeEnv: parsed.NODE_ENV,
    fileKeyId: parsed.RAZORPAY_KEY_ID,
    fileKeySecret: parsed.RAZORPAY_KEY_SECRET
  };
}

function validateExperimentEnv(input) {
  const shellNodeEnv = normalizeEnv(input.shellNodeEnv);
  const fileNodeEnv = normalizeEnv(input.fileNodeEnv);
  if (shellNodeEnv === 'production' || fileNodeEnv === 'production') {
    throw new ExperimentRefusal('Refusing to run because NODE_ENV is production.');
  }

  const fileKeyId = normalizeCredential(input.fileKeyId);
  const fileKeySecret = normalizeCredential(input.fileKeySecret);
  const shellKeyId = normalizeCredential(input.shellKeyId);

  if (!fileKeyId || !fileKeySecret) {
    throw new ExperimentRefusal('Refusing to run because Razorpay test credentials are missing.');
  }
  if (fileKeyId.startsWith(LIVE_KEY_PREFIX) || shellKeyId.startsWith(LIVE_KEY_PREFIX)) {
    throw new ExperimentRefusal('Refusing to run because a live Razorpay key was found.');
  }
  if (!fileKeyId.startsWith(TEST_KEY_PREFIX)) {
    throw new ExperimentRefusal('Refusing to run because the file Key ID is not a Razorpay test key.');
  }

  return {
    shellNodeEnv: shellNodeEnv || null,
    fileNodeEnv: fileNodeEnv || null,
    nodeEnv: shellNodeEnv || fileNodeEnv || 'development',
    keyId: fileKeyId,
    keySecret: fileKeySecret
  };
}

function safeConfigMetadata(credentials) {
  return {
    shellNodeEnv: credentials.shellNodeEnv,
    fileNodeEnv: credentials.fileNodeEnv,
    nodeEnv: credentials.nodeEnv,
    keyIdHasTestPrefix: credentials.keyId.startsWith(TEST_KEY_PREFIX),
    keyIdLength: credentials.keyId.length,
    secretPresent: credentials.keySecret.length > 0
  };
}

function assertReceipt(receipt) {
  if (
    typeof receipt !== 'string' ||
    receipt.length < 1 ||
    receipt.length > RECEIPT_MAX_LENGTH ||
    !receipt.startsWith(RECEIPT_PREFIX)
  ) {
    throw new ExperimentRefusal('Receipt must be 1 to 40 characters and start with lbexp.');
  }
  return receipt;
}

function createRunId(byteSource = (size) => crypto.randomBytes(size)) {
  return byteSource(4).toString('hex');
}

function buildReceipt(runId, slot) {
  if (typeof runId !== 'string' || !/^[a-z0-9]+$/i.test(runId)) {
    throw new ExperimentRefusal('Run identifier is not usable for a receipt.');
  }
  if (typeof slot !== 'string' || !/^[a-z0-9]+$/i.test(slot)) {
    throw new ExperimentRefusal('Receipt slot is not usable.');
  }
  return assertReceipt(`${RECEIPT_PREFIX}${runId}${slot}`);
}

function orderCreateBody(receipt, runId, slot) {
  assertReceipt(receipt);
  return {
    amount: ORDER_AMOUNT_PAISE,
    currency: 'INR',
    receipt,
    notes: {
      experiment: EXPERIMENT_NOTE,
      run: runId,
      slot
    }
  };
}

function notesSummary(notes) {
  if (Array.isArray(notes)) {
    return { notesType: 'array', notesKeys: [] };
  }
  if (isPlainObject(notes)) {
    return { notesType: 'object', notesKeys: Object.keys(notes).sort() };
  }
  if (notes === null) {
    return { notesType: 'null', notesKeys: [] };
  }
  return { notesType: describeType(notes), notesKeys: [] };
}

function pickOrder(order) {
  if (!isPlainObject(order)) {
    return { malformed: true };
  }
  const summary = {};
  for (const field of ORDER_FIELDS) {
    const value = order[field];
    summary[field] = isReportablePrimitive(value) ? value : null;
  }
  const notes = notesSummary(order.notes);
  summary.notesType = notes.notesType;
  summary.notesKeys = notes.notesKeys;
  return summary;
}

function summarizeCollection(operation, payload) {
  const record = isPlainObject(payload) ? payload : null;
  const count = record ? record.count : undefined;
  const items = record ? record.items : undefined;
  const itemsLength = Array.isArray(items) ? items.length : null;
  return {
    operation,
    topLevelKeys: record ? Object.keys(record).sort() : [],
    entity: record && typeof record.entity === 'string' ? record.entity : null,
    countType: describeType(count),
    count: isReportablePrimitive(count) ? count : null,
    itemsLength,
    countEqualsItemsLength: typeof count === 'number' && itemsLength !== null && count === itemsLength,
    orders: Array.isArray(items) ? items.map(pickOrder) : []
  };
}

function summarizeOrderResponse(operation, payload) {
  const record = isPlainObject(payload) ? payload : null;
  return {
    operation,
    topLevelKeys: record ? Object.keys(record).sort() : [],
    entity: record && typeof record.entity === 'string' ? record.entity : null,
    countType: 'absent',
    count: null,
    itemsLength: null,
    countEqualsItemsLength: null,
    orders: [pickOrder(payload)]
  };
}

function readProviderFailure(error) {
  let statusCode = null;
  let errorCode = null;
  if (isPlainObject(error)) {
    const status = error.statusCode;
    if (typeof status === 'number' && Number.isInteger(status)) {
      statusCode = status;
    } else if (typeof status === 'string' && /^[0-9]+$/.test(status)) {
      statusCode = Number(status);
    }
    const inner = error.error;
    if (
      isPlainObject(inner) &&
      typeof inner.code === 'string' &&
      inner.code.length > 0 &&
      inner.code.length <= 64 &&
      /^[A-Za-z0-9_]+$/.test(inner.code)
    ) {
      errorCode = inner.code;
    }
  }
  return { statusCode, errorCode };
}

function providerFailureMessage(method, error) {
  const failure = readProviderFailure(error);
  const status = failure.statusCode === null ? 'unknown' : String(failure.statusCode);
  const code = failure.errorCode === null ? 'unknown' : failure.errorCode;
  return `${method} failed (status=${status}, code=${code}).`;
}

function writeLine(stdout, value) {
  stdout.write(`${JSON.stringify(value)}\n`);
}

function createOrdersClient(keyId, keySecret) {
  const Razorpay = require('razorpay');
  const client = new Razorpay({
    key_id: keyId,
    key_secret: keySecret
  });
  const orders = client && client.orders;
  if (
    !orders ||
    typeof orders.create !== 'function' ||
    typeof orders.all !== 'function' ||
    typeof orders.fetch !== 'function'
  ) {
    throw new ExperimentRefusal('Razorpay orders client is missing an allowed method.');
  }
  return {
    create: (params) => orders.create(params),
    all: (params) => orders.all(params),
    fetch: (orderId) => orders.fetch(orderId)
  };
}

async function invokeOrderMethod(method, fn) {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof ExperimentRefusal || error instanceof ExperimentFailure) {
      throw error;
    }
    throw new ExperimentFailure(providerFailureMessage(method, error));
  }
}

async function runExperiment(orders, stdout) {
  if (
    !orders ||
    typeof orders.create !== 'function' ||
    typeof orders.all !== 'function' ||
    typeof orders.fetch !== 'function'
  ) {
    throw new ExperimentRefusal('Razorpay orders client is missing an allowed method.');
  }

  const runId = createRunId();
  const receiptNever = buildReceipt(runId, 'none');
  const receiptA = buildReceipt(runId, 'a');
  const receiptB = buildReceipt(runId, 'b');

  writeLine(stdout, {
    operation: 'plan',
    runId,
    receipts: {
      neverCreated: receiptNever,
      orderA: receiptA,
      orderB: receiptB
    }
  });

  async function lookup(operation, receipt, count, skip) {
    const payload = await invokeOrderMethod('orders.all', () => orders.all({ receipt, count, skip }));
    writeLine(stdout, summarizeCollection(operation, payload));
  }

  async function create(operation, receipt, slot) {
    const payload = await invokeOrderMethod('orders.create', () =>
      orders.create(orderCreateBody(receipt, runId, slot))
    );
    writeLine(stdout, summarizeOrderResponse(operation, payload));
    const order = isPlainObject(payload) ? payload : null;
    if (!order || typeof order.id !== 'string' || order.id.length === 0) {
      throw new ExperimentFailure(`${operation} did not return an order id.`);
    }
    return order.id;
  }

  await lookup('lookup-never-created-before', receiptNever, 2, 0);
  const orderIdA = await create('create-order-a', receiptA, 'a');
  const fetched = await invokeOrderMethod('orders.fetch', () => orders.fetch(orderIdA));
  writeLine(stdout, summarizeOrderResponse('fetch-order-a', fetched));
  await lookup('lookup-a-count-2-skip-0', receiptA, 2, 0);
  await lookup('lookup-a-count-1-skip-0', receiptA, 1, 0);
  await lookup('lookup-a-count-1-skip-1', receiptA, 1, 1);
  await create('create-order-b', receiptB, 'b');
  await lookup('lookup-a-after-b', receiptA, 2, 0);
  await lookup('lookup-never-created-after', receiptNever, 2, 0);

  try {
    const duplicate = await orders.create(orderCreateBody(receiptA, runId, 'dup'));
    writeLine(stdout, {
      ...summarizeOrderResponse('create-duplicate-receipt', duplicate),
      outcome: 'succeeded'
    });
  } catch (error) {
    if (error instanceof ExperimentRefusal || error instanceof ExperimentFailure) {
      throw error;
    }
    const failure = readProviderFailure(error);
    writeLine(stdout, {
      operation: 'create-duplicate-receipt',
      outcome: 'failed',
      statusCode: failure.statusCode,
      errorCode: failure.errorCode
    });
  }
}

function argumentError(message) {
  return { kind: 'error', message };
}

function parseCreatedAt(token) {
  if (typeof token !== 'string' || !/^[1-9][0-9]*$/.test(token)) {
    throw new ExperimentRefusal('Refusing to run because created-at must be a positive integer in Unix seconds.');
  }
  if (token.length === 13) {
    throw new ExperimentRefusal('Refusing to run because created-at is a millisecond timestamp. Pass Unix seconds.');
  }
  if (token.length > 13 || !Number.isSafeInteger(Number(token))) {
    throw new ExperimentRefusal('Refusing to run because created-at must be a positive integer in Unix seconds.');
  }
  return Number(token);
}

function parseListingReceipt(token) {
  if (typeof token !== 'string') {
    throw new ExperimentRefusal('Refusing to run because a receipt is missing.');
  }
  const receipt = token.trim();
  if (receipt.length < 1 || receipt.length > RECEIPT_MAX_LENGTH) {
    throw new ExperimentRefusal('Refusing to run because a receipt must be 1 to 40 characters.');
  }
  return receipt;
}

function parseReceiptPair(receipts) {
  if (receipts.length !== 2) {
    throw new ExperimentRefusal('Refusing to run because exactly two receipts are required.');
  }
  const parsed = receipts.map(parseListingReceipt);
  if (parsed[0] === parsed[1]) {
    throw new ExperimentRefusal('Refusing to run because the two receipts must be distinct.');
  }
  return parsed;
}

function parseExperimentArgs(argv) {
  const args = argv.slice(2);
  if (args.length === 0) {
    return { kind: 'usage' };
  }

  let create = false;
  let list = false;
  let createdAtToken = null;
  let sawCreatedAt = false;
  const receiptTokens = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--create') {
      if (create) {
        return argumentError('Refusing to run because --create was repeated.');
      }
      create = true;
      continue;
    }
    if (arg === '--list-window') {
      if (list) {
        return argumentError('Refusing to run because --list-window was repeated.');
      }
      list = true;
      continue;
    }
    if (arg === '--created-at') {
      const value = args[index + 1];
      if (value === undefined || value.startsWith('--')) {
        return argumentError('Refusing to run because created-at is missing.');
      }
      if (sawCreatedAt) {
        return argumentError('Refusing to run because created-at was repeated.');
      }
      sawCreatedAt = true;
      createdAtToken = value;
      index += 1;
      continue;
    }
    if (arg === '--receipt') {
      const value = args[index + 1];
      if (value === undefined || value.startsWith('--')) {
        return argumentError('Refusing to run because a receipt is missing.');
      }
      receiptTokens.push(value);
      index += 1;
      continue;
    }
    return argumentError('Refusing to run because an argument is unknown.');
  }

  if (create && list) {
    return argumentError('Refusing to run because --list-window and --create cannot be combined.');
  }
  if (!create && !list) {
    return argumentError('Refusing to run because the mode is missing or unknown.');
  }
  if (create) {
    if (sawCreatedAt || receiptTokens.length > 0) {
      return argumentError('Refusing to run because --create does not accept other arguments.');
    }
    return { kind: 'create' };
  }
  if (!sawCreatedAt) {
    return argumentError('Refusing to run because created-at is missing.');
  }

  try {
    const createdAt = parseCreatedAt(createdAtToken);
    const receipts = parseReceiptPair(receiptTokens);
    return {
      kind: 'list-window',
      createdAt,
      from: createdAt - WINDOW_BEFORE_SECONDS,
      to: createdAt + WINDOW_AFTER_SECONDS,
      receipts
    };
  } catch (error) {
    if (error instanceof ExperimentRefusal) {
      return argumentError(error.message);
    }
    throw error;
  }
}

function summarizeListWindow(payload, input) {
  const record = isPlainObject(payload) ? payload : null;
  const count = record ? record.count : undefined;
  const items = record && Array.isArray(record.items) ? record.items : null;
  const itemsLength = items ? items.length : null;
  const known = new Set(input.receipts);
  const matched = items
    ? items.filter((item) => isPlainObject(item) && known.has(item.receipt))
    : [];
  return {
    operation: 'list-window',
    from: input.from,
    to: input.to,
    entity: record && typeof record.entity === 'string' ? record.entity : null,
    countType: describeType(count),
    count: isReportablePrimitive(count) ? count : null,
    itemsLength,
    countEqualsItemsLength: typeof count === 'number' && itemsLength !== null && count === itemsLength,
    matchedCount: matched.length,
    pageFull: itemsLength === LIST_WINDOW_COUNT,
    orders: matched.map(pickOrder)
  };
}

async function runListWindow(orders, stdout, input) {
  if (!orders || typeof orders.all !== 'function') {
    throw new ExperimentRefusal('Razorpay orders client is missing an allowed method.');
  }
  const payload = await invokeOrderMethod('orders.all', () =>
    orders.all({
      from: input.from,
      to: input.to,
      count: LIST_WINDOW_COUNT,
      skip: 0
    })
  );
  writeLine(stdout, summarizeListWindow(payload, input));
}

function loadCredentialsFromEnvFile() {
  const envPath = path.resolve(__dirname, '../.env');
  let contents;
  try {
    contents = fs.readFileSync(envPath, 'utf8');
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      throw new ExperimentRefusal('Refusing to run because backend/.env could not be read.');
    }
    throw error;
  }
  const file = readCredentialFile(contents);
  return validateExperimentEnv({
    shellNodeEnv: process.env.NODE_ENV,
    shellKeyId: process.env.RAZORPAY_KEY_ID,
    fileNodeEnv: file.fileNodeEnv,
    fileKeyId: file.fileKeyId,
    fileKeySecret: file.fileKeySecret
  });
}

function writeDispatchError(io, error) {
  if (error instanceof ExperimentRefusal) {
    io.stderr.write(`${error.message}\n`);
    return 2;
  }
  const known = error instanceof ExperimentFailure;
  io.stderr.write(`${known ? error.message : 'Experiment failed.'}\n`);
  io.stderr.write('Experiment stopped. No payment, refund, capture, or cleanup call was made.\n');
  return 1;
}

async function dispatchExperiment(argv, deps) {
  const parsed = parseExperimentArgs(argv);
  if (parsed.kind === 'usage') {
    deps.io.stdout.write(`${USAGE}\n`);
    return 0;
  }
  if (parsed.kind === 'error') {
    deps.io.stderr.write(`${parsed.message}\n`);
    return 2;
  }

  let credentials;
  try {
    credentials = await deps.loadCredentials();
  } catch (error) {
    return writeDispatchError(deps.io, error);
  }

  writeLine(deps.io.stdout, safeConfigMetadata(credentials));
  const orders = deps.createOrders(credentials);
  try {
    if (parsed.kind === 'create') {
      deps.io.stdout.write(`${UNDELETABLE_WARNING}\n`);
      await deps.runCreate(orders, deps.io.stdout);
      deps.io.stdout.write(`${UNDELETABLE_WARNING}\n`);
      return 0;
    }
    deps.io.stdout.write(
      'Read-only listing. This mode does not create, fetch, capture, refund, or delete Orders.\n'
    );
    await deps.runList(orders, deps.io.stdout, parsed);
    return 0;
  } catch (error) {
    return writeDispatchError(deps.io, error);
  }
}

async function main() {
  const code = await dispatchExperiment(process.argv, {
    io: { stdout: process.stdout, stderr: process.stderr },
    loadCredentials: loadCredentialsFromEnvFile,
    createOrders: (credentials) => createOrdersClient(credentials.keyId, credentials.keySecret),
    runCreate: runExperiment,
    runList: runListWindow
  });
  process.exitCode = code;
}

if (require.main === module) {
  main();
}

module.exports = {
  ExperimentFailure,
  ExperimentRefusal,
  UNDELETABLE_WARNING,
  assertReceipt,
  buildReceipt,
  createOrdersClient,
  createRunId,
  orderCreateBody,
  readCredentialFile,
  dispatchExperiment,
  parseCreatedAt,
  parseExperimentArgs,
  readProviderFailure,
  runExperiment,
  runListWindow,
  safeConfigMetadata,
  summarizeCollection,
  summarizeListWindow,
  summarizeOrderResponse,
  validateExperimentEnv
};
