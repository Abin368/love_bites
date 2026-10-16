import { QueryInterface } from 'sequelize';
import { sequelize } from '../../src/config/database';

interface PlanCatalogSeeder {
  up: (queryInterface: QueryInterface) => Promise<void>;
}

const planCatalogSeeder = require('../../src/database/seeders/20261015120003-seed-plan-catalog') as PlanCatalogSeeder;

export async function ensurePlanCatalog(): Promise<void> {
  await planCatalogSeeder.up(sequelize.getQueryInterface());
}
