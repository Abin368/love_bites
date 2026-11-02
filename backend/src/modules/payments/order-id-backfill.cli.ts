import { z } from 'zod';
import type {
  OrderIdBackfillResult,
  OrderIdBackfillUnchangedReason
} from './order-id-backfill.service';

const paymentIdSchema = z.string().uuid('Payment id must be a valid UUID.');

export const ALLOWED_BACKFILL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
export const ALLOWED_BACKFILL_DATABASES = new Set(['love_bites_dev', 'love_bites_test']);

export type CliIo = {
  stdout: { write(chunk: string): void };
  stderr: { write(chunk: string): void };
};

export type TargetDatabaseInfo = {
  nodeEnv: string;
  host: string;
  database: string;
};

export type OrderIdBackfillEnvConfig = {
  nodeEnv: string;
  databaseUrl?: string;
  dbHost: string;
  dbName: string;
};

export type OrderIdBackfillRuntime = {
  backfill: (paymentId: string) => Promise<OrderIdBackfillResult>;
  close?: () => Promise<void>;
};

export type ExecuteOrderIdBackfillCliDeps = {
  argv: string[];
  processNodeEnv: string;
  loadEnv: () => Promise<OrderIdBackfillEnvConfig>;
  loadRuntime: () => Promise<OrderIdBackfillRuntime>;
  io: CliIo;
};

const HELP = `Love Bite — internal checkout Order-ID recovery (Phase 1)

Usage:
  npm run ops:backfill-order-id -- <paymentUuid>

Accepts one local payments.id UUID. Calls backfillProviderOrderId only.

Safety:
  - Never runs when NODE_ENV=production
  - Only allowed hosts: localhost, 127.0.0.1, ::1
  - Only allowed databases: love_bites_dev, love_bites_test
  - Never creates a Razorpay Order
  - Never changes payment status (does not mark FAILED)
  - Never captures, refunds, activates Premium, or creates a subscription
  - Never releases the outstanding-checkout unique index
  - Matching uses receipt + notes.paymentId + amount + currency only

Note:
  A successful Order-ID association does NOT release the outstanding-checkout
  slot. The payment remains INITIATED until webhook capture (or a later Phase
  abandon path, which is not implemented). Automatic abandonment is not
  implemented.
`;

const UNCHANGED_MESSAGES: Record<OrderIdBackfillUnchangedReason, string> = {
  no_match: 'No matching Order was found; payment remains unchanged.',
  ambiguous: 'Multiple or incomplete matches; payment remains unchanged.',
  malformed: 'Provider Order page was malformed; payment remains unchanged.',
  receipt_mismatch: 'Listed Order receipt did not match the payment; payment remains unchanged.',
  note_mismatch: 'Listed Order notes.paymentId did not match the payment; payment remains unchanged.',
  amount_mismatch: 'Listed Order amount did not match the payment; payment remains unchanged.',
  currency_mismatch: 'Listed Order currency did not match the payment; payment remains unchanged.',
  conflict: 'Concurrent modification detected; inspect the current payment state.'
};

export function printHelp(io: CliIo): void {
  io.stdout.write(`${HELP}\n`);
}

export function parsePaymentIdArg(argv: string[]):
  | { kind: 'help' }
  | { kind: 'payment'; paymentId: string }
  | { kind: 'error'; message: string } {
  const args = argv.slice(2).filter((arg) => arg.length > 0);
  if (args.includes('--help') || args.includes('-h')) {
    return { kind: 'help' };
  }
  if (args.length === 0) {
    return { kind: 'error', message: 'Expected exactly one payment UUID argument.' };
  }
  if (args.length !== 1) {
    return { kind: 'error', message: 'Expected exactly one payment UUID argument.' };
  }

  const parsed = paymentIdSchema.safeParse(args[0]);
  if (!parsed.success) {
    return { kind: 'error', message: 'Payment id must be a valid UUID.' };
  }
  return { kind: 'payment', paymentId: parsed.data };
}

export function assertNonProduction(nodeEnv: string): void {
  if (nodeEnv === 'production') {
    throw new Error(
      'Refusing to run Order-ID backfill against production (NODE_ENV=production).'
    );
  }
}

export function normalizeHost(host: string): string {
  const trimmed = host.trim().toLowerCase();
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export function resolveTargetDatabaseInfo(input: {
  nodeEnv: string;
  databaseUrl?: string;
  dbHost: string;
  dbName: string;
}): TargetDatabaseInfo {
  if (input.databaseUrl !== undefined) {
    const raw = input.databaseUrl.trim();
    if (raw.length === 0) {
      throw new Error('Refusing to run Order-ID backfill: DATABASE_URL is empty.');
    }

    let parsed: URL;
    try {
      parsed = new URL(raw);
    } catch {
      throw new Error('Refusing to run Order-ID backfill: DATABASE_URL is not a valid URL.');
    }

    const host = normalizeHost(parsed.hostname);
    const database = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
    if (!host || !database) {
      throw new Error(
        'Refusing to run Order-ID backfill: DATABASE_URL is missing a host or database name.'
      );
    }

    return {
      nodeEnv: input.nodeEnv,
      host,
      database
    };
  }

  const host = normalizeHost(input.dbHost);
  const database = input.dbName.trim();
  if (!host || !database) {
    throw new Error(
      'Refusing to run Order-ID backfill: DB_HOST or DB_NAME is missing.'
    );
  }

  return {
    nodeEnv: input.nodeEnv,
    host,
    database
  };
}

export function assertAllowedDatabaseTarget(target: TargetDatabaseInfo): void {
  if (!ALLOWED_BACKFILL_HOSTS.has(target.host)) {
    throw new Error(
      `Refusing to run Order-ID backfill: host "${target.host}" is not an allowed local target.`
    );
  }
  if (!ALLOWED_BACKFILL_DATABASES.has(target.database)) {
    throw new Error(
      `Refusing to run Order-ID backfill: database "${target.database}" is not love_bites_dev or love_bites_test.`
    );
  }
}

export function formatBackfillOutcome(result: OrderIdBackfillResult): string {
  if (result.outcome === 'assigned') {
    return `Successfully associated an existing Razorpay Order (${result.providerOrderId}). Payment status is unchanged. Outstanding-checkout slot is NOT released.`;
  }
  if (result.outcome === 'already_assigned') {
    return `An Order is already associated (${result.providerOrderId}). Payment status is unchanged.`;
  }
  if (result.outcome === 'ineligible') {
    return 'Payment is not eligible for backfill.';
  }
  return UNCHANGED_MESSAGES[result.reason];
}

export function exitCodeForBackfillResult(result: OrderIdBackfillResult): number {
  if (result.outcome === 'assigned' || result.outcome === 'already_assigned') {
    return 0;
  }
  return 1;
}

function writeRefusal(io: CliIo, error: unknown): number {
  const message = error instanceof Error ? error.message : 'Refusing to run.';
  io.stderr.write(`${message}\n`);
  return 2;
}

export async function executeOrderIdBackfillCli(
  deps: ExecuteOrderIdBackfillCliDeps
): Promise<number> {
  const parsed = parsePaymentIdArg(deps.argv);
  if (parsed.kind === 'help') {
    printHelp(deps.io);
    return 0;
  }
  if (parsed.kind === 'error') {
    deps.io.stderr.write(`${parsed.message}\n`);
    printHelp(deps.io);
    return 2;
  }

  try {
    assertNonProduction(deps.processNodeEnv);
  } catch (error) {
    return writeRefusal(deps.io, error);
  }

  let envConfig: OrderIdBackfillEnvConfig;
  try {
    envConfig = await deps.loadEnv();
  } catch (error) {
    return writeRefusal(deps.io, error);
  }

  try {
    assertNonProduction(envConfig.nodeEnv);
  } catch (error) {
    return writeRefusal(deps.io, error);
  }

  let target: TargetDatabaseInfo;
  try {
    target = resolveTargetDatabaseInfo({
      nodeEnv: envConfig.nodeEnv,
      databaseUrl: envConfig.databaseUrl,
      dbHost: envConfig.dbHost,
      dbName: envConfig.dbName
    });
    assertAllowedDatabaseTarget(target);
  } catch (error) {
    return writeRefusal(deps.io, error);
  }

  deps.io.stdout.write(
    `Target environment: NODE_ENV=${target.nodeEnv} host=${target.host} database=${target.database}\n`
  );
  deps.io.stdout.write(`Payment id: ${parsed.paymentId}\n`);
  deps.io.stdout.write(
    'Calling backfillProviderOrderId (Order association only; no status change).\n'
  );

  let runtime: OrderIdBackfillRuntime;
  try {
    runtime = await deps.loadRuntime();
  } catch (error) {
    return writeRefusal(deps.io, error);
  }

  try {
    const result = await runtime.backfill(parsed.paymentId);
    deps.io.stdout.write(`${formatBackfillOutcome(result)}\n`);
    return exitCodeForBackfillResult(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Order-ID backfill failed.';
    deps.io.stderr.write(`Provider or database error: ${message}\n`);
    deps.io.stderr.write('Payment status was not changed by this command.\n');
    return 1;
  } finally {
    if (runtime.close) {
      await runtime.close();
    }
  }
}

export async function runOrderIdBackfillCli(deps: {
  argv: string[];
  nodeEnv: string;
  databaseUrl?: string;
  dbHost: string;
  dbName: string;
  backfill: (paymentId: string) => Promise<OrderIdBackfillResult>;
  io: CliIo;
  close?: () => Promise<void>;
}): Promise<number> {
  return executeOrderIdBackfillCli({
    argv: deps.argv,
    processNodeEnv: deps.nodeEnv,
    loadEnv: async () => ({
      nodeEnv: deps.nodeEnv,
      databaseUrl: deps.databaseUrl,
      dbHost: deps.dbHost,
      dbName: deps.dbName
    }),
    loadRuntime: async () => ({
      backfill: deps.backfill,
      close: deps.close
    }),
    io: deps.io
  });
}

async function main(): Promise<void> {
  const io: CliIo = {
    stdout: process.stdout,
    stderr: process.stderr
  };

  const code = await executeOrderIdBackfillCli({
    argv: process.argv,
    processNodeEnv: process.env.NODE_ENV ?? 'development',
    loadEnv: async () => {
      const { env } = await import('../../config/env.js');
      return {
        nodeEnv: env.NODE_ENV,
        databaseUrl: env.DATABASE_URL,
        dbHost: env.DB_HOST,
        dbName: env.DB_NAME
      };
    },
    loadRuntime: async () => {
      const { sequelize } = await import('../../config/database.js');
      const { backfillProviderOrderId } = await import('./order-id-backfill.service.js');
      return {
        backfill: backfillProviderOrderId,
        close: async () => {
          await sequelize.close();
        }
      };
    },
    io
  });
  process.exitCode = code;
}

const executedAsScript =
  typeof require !== 'undefined' &&
  typeof module !== 'undefined' &&
  require.main === module;

if (executedAsScript) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : 'Order-ID backfill failed.';
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
