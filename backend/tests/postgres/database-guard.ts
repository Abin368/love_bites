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
        AND tablename <> 'SequelizeMeta'
        AND tablename <> 'spatial_ref_sys';

      IF stmt IS NOT NULL THEN
        EXECUTE stmt;
      END IF;
    END $$;
  `);
  await sequelize.query(`
    INSERT INTO spatial_ref_sys (srid, auth_name, auth_srid, srtext, proj4text)
    VALUES (
      4326,
      'EPSG',
      4326,
      'GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563,AUTHORITY["EPSG","7030"]],AUTHORITY["EPSG","6326"]],PRIMEM["Greenwich",0,AUTHORITY["EPSG","8901"]],UNIT["degree",0.0174532925199433,AUTHORITY["EPSG","9122"]],AUTHORITY["EPSG","4326"]]',
      '+proj=longlat +datum=WGS84 +no_defs'
    )
    ON CONFLICT (srid) DO NOTHING
  `);
}
