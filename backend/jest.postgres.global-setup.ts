const { prepareTestDatabase } = require('./scripts/test-database') as {
  prepareTestDatabase: () => Promise<unknown>;
};

export default async function globalSetup(): Promise<void> {
  await prepareTestDatabase();
}
