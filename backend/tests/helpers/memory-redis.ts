interface StringEntry {
  value: string;
  expiresAt: number | null;
}

interface WindowEntry {
  member: string;
  score: number;
}

const strings = new Map<string, StringEntry>();
const windows = new Map<string, WindowEntry[]>();

function expired(entry: StringEntry): boolean {
  return entry.expiresAt !== null && entry.expiresAt <= Date.now();
}

function readString(key: string): StringEntry | undefined {
  const entry = strings.get(key);
  if (!entry) {
    return undefined;
  }
  if (expired(entry)) {
    strings.delete(key);
    return undefined;
  }
  return entry;
}

export function resetMemoryRedis(): void {
  strings.clear();
  windows.clear();
}

export const redis = {
  status: 'ready',
  on: () => redis,
  async connect() {
    return redis;
  },
  async quit() {
    return 'OK';
  },
  async ping() {
    return 'PONG';
  },
  async get(key: string) {
    return readString(key)?.value ?? null;
  },
  async set(key: string, value: string, ...args: Array<string | number>) {
    let exSeconds: number | undefined;
    let nx = false;
    for (let index = 0; index < args.length; index += 1) {
      const flag = String(args[index]).toUpperCase();
      if (flag === 'EX') {
        exSeconds = Number(args[index + 1]);
        index += 1;
      }
      if (flag === 'NX') {
        nx = true;
      }
    }
    if (nx && readString(key)) {
      return null;
    }
    strings.set(key, {
      value,
      expiresAt: exSeconds ? Date.now() + exSeconds * 1000 : null
    });
    return 'OK';
  },
  async del(key: string) {
    return strings.delete(key) ? 1 : 0;
  },
  async ttl(key: string) {
    const entry = readString(key);
    if (!entry) {
      return -2;
    }
    if (entry.expiresAt === null) {
      return -1;
    }
    return Math.ceil((entry.expiresAt - Date.now()) / 1000);
  },
  async eval(_script: string, numKeys: number, ...args: Array<string | number>) {
    const key = String(args[0]);
    const now = Number(args[numKeys]);
    const windowMs = Number(args[numKeys + 1]);
    const limit = Number(args[numKeys + 2]);
    const member = String(args[numKeys + 3]);
    const current = windows.get(key) ?? [];
    const minimumScore = now - windowMs;
    const active = current.filter((entry) => entry.score > minimumScore);
    const allowed = active.length < limit;
    if (allowed) {
      active.push({ member, score: now });
    }
    windows.set(key, active);
    return allowed ? 1 : 0;
  }
};

export async function checkRedisHealth(): Promise<boolean> {
  return true;
}
