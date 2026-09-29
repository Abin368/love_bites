'use strict';

const { Op } = require('sequelize');

const GENDERS = [
  {
    id: '6e6e0001-0000-4000-8000-000000000001',
    code: 'MAN',
    name: 'Man',
    displayOrder: 1
  },
  {
    id: '6e6e0001-0000-4000-8000-000000000002',
    code: 'WOMAN',
    name: 'Woman',
    displayOrder: 2
  },
  {
    id: '6e6e0001-0000-4000-8000-000000000003',
    code: 'NON_BINARY',
    name: 'Non-binary',
    displayOrder: 3
  },
  {
    id: '6e6e0001-0000-4000-8000-000000000004',
    code: 'PREFER_NOT_TO_SAY',
    name: 'Prefer not to say',
    displayOrder: 4
  }
];

function replacements() {
  return GENDERS.reduce((values, gender, index) => {
    values[`id${index}`] = gender.id;
    values[`code${index}`] = gender.code;
    values[`name${index}`] = gender.name;
    values[`displayOrder${index}`] = gender.displayOrder;
    return values;
  }, {});
}

function insertSql() {
  const rows = GENDERS.map(
    (_gender, index) =>
      `(:id${index}, :code${index}, :name${index}, TRUE, :displayOrder${index}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
  ).join(',\n          ');

  return `
        INSERT INTO genders (id, code, name, is_active, display_order, created_at, updated_at)
        VALUES
          ${rows}
        ON CONFLICT (code) DO UPDATE
        SET
          name = EXCLUDED.name,
          is_active = EXCLUDED.is_active,
          display_order = EXCLUDED.display_order,
          updated_at = CURRENT_TIMESTAMP
      `;
}

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(insertSql(), {
        replacements: replacements(),
        transaction
      });
    });
  },

  async down(queryInterface) {
    await queryInterface.bulkDelete('genders', {
      code: { [Op.in]: GENDERS.map((gender) => gender.code) }
    });
  }
};
