'use strict';

const { Op } = require('sequelize');

const RELATIONSHIP_INTENTIONS = [
  {
    id: '6e6e0002-0000-4000-8000-000000000001',
    code: 'LONG_TERM_RELATIONSHIP',
    name: 'Long-term relationship',
    displayOrder: 1
  },
  {
    id: '6e6e0002-0000-4000-8000-000000000002',
    code: 'SOMETHING_CASUAL',
    name: 'Something casual',
    displayOrder: 2
  },
  {
    id: '6e6e0002-0000-4000-8000-000000000003',
    code: 'FRIENDSHIP',
    name: 'Friendship',
    displayOrder: 3
  },
  {
    id: '6e6e0002-0000-4000-8000-000000000004',
    code: 'NOT_SURE_YET',
    name: 'Not sure yet',
    displayOrder: 4
  }
];

function replacements() {
  return RELATIONSHIP_INTENTIONS.reduce((values, intention, index) => {
    values[`id${index}`] = intention.id;
    values[`code${index}`] = intention.code;
    values[`name${index}`] = intention.name;
    values[`displayOrder${index}`] = intention.displayOrder;
    return values;
  }, {});
}

function insertSql() {
  const rows = RELATIONSHIP_INTENTIONS.map(
    (_intention, index) =>
      `(:id${index}, :code${index}, :name${index}, NULL, TRUE, :displayOrder${index}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
  ).join(',\n          ');

  return `
        INSERT INTO relationship_intentions (
          id, code, name, description, is_active, display_order, created_at, updated_at
        )
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
    await queryInterface.bulkDelete('relationship_intentions', {
      code: { [Op.in]: RELATIONSHIP_INTENTIONS.map((intention) => intention.code) }
    });
  }
};
