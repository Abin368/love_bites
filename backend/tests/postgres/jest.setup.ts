import { sequelize } from '../../src/config/database';
import { assertTestDatabase, clearTestData } from './database-guard';

jest.setTimeout(30000);

beforeAll(async () => {
  await assertTestDatabase(sequelize, 'run PostgreSQL integration tests');
});

beforeEach(async () => {
  await clearTestData(sequelize);
});

afterAll(async () => {
  await assertTestDatabase(sequelize, 'close the integration test connection');
  await sequelize.close();
});
