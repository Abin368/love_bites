'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(
        `ALTER TABLE profiles
         ALTER COLUMN city DROP NOT NULL;`,
        { transaction }
      );

      await queryInterface.sequelize.query(
        `ALTER TABLE profiles
         ALTER COLUMN location DROP NOT NULL;`,
        { transaction }
      );
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(
        `ALTER TABLE profiles
         ALTER COLUMN city SET NOT NULL;`,
        { transaction }
      );

      await queryInterface.sequelize.query(
        `ALTER TABLE profiles
         ALTER COLUMN location SET NOT NULL;`,
        { transaction }
      );
    });
  }
};
