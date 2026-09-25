import { Sequelize } from 'sequelize';

const TEST_DATABASE_NAME = 'love_bites_test';
const FORBIDDEN_DATABASE_NAME = 'love_bites_dev';

export async function readCurrentDatabase(sequelize: Sequelize): Promise<string> {
  const [rows] = await sequelize.query('SELECT current_database() AS name');
  const name = (rows[0] as { name?: string } | undefined)?.name;
  if (!name) {
    throw new Error('Test database safety check failed: current_database() returned no name.');
  }
  return name;
}

export async function assertTestDatabase(sequelize: Sequelize, action: string): Promise<void> {
  const name = await readCurrentDatabase(sequelize);
  if (name === FORBIDDEN_DATABASE_NAME) {
    throw new Error(
      `Test database safety check failed: refusing to ${action} because current_database() is ${FORBIDDEN_DATABASE_NAME}.`
    );
  }
  if (name !== TEST_DATABASE_NAME) {
    throw new Error(
      `Test database safety check failed: refusing to ${action} because current_database() is "${name}", expected "${TEST_DATABASE_NAME}".`
    );
  }
}

export async function clearTestData(sequelize: Sequelize): Promise<void> {
  await assertTestDatabase(sequelize, 'clear test data');
  await sequelize.query(`
    DO $$
    DECLARE
      stmt text;
    BEGIN
      SELECT 'TRUNCATE TABLE ' || string_agg(format('%I.%I', schemaname, tablename), ', ') || ' RESTART IDENTITY CASCADE'
      INTO stmt
      FROM pg_tables
      WHERE schemaname = 'public'
        AND tablename <> 'SequelizeMeta';

      IF stmt IS NOT NULL THEN
        EXECUTE stmt;
      END IF;
    END $$;
  `);
}
