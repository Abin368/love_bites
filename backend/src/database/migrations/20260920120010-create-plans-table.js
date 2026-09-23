'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.createTable(
        'plans',
        {
          id: {
            type: Sequelize.UUID,
            allowNull: false,
            primaryKey: true,
            defaultValue: Sequelize.literal('gen_random_uuid()')
          },
          code: {
            type: Sequelize.STRING(50),
            allowNull: false
          },
          name: {
            type: Sequelize.STRING(100),
            allowNull: false
          },
          billing_interval: {
            type: Sequelize.STRING(20),
            allowNull: false,
            defaultValue: 'NONE'
          },
          price_in_cents: {
            type: Sequelize.INTEGER,
            allowNull: false,
            defaultValue: 0
          },
          currency: {
            type: Sequelize.STRING(3),
            allowNull: false,
            defaultValue: 'INR'
          },
          is_active: {
            type: Sequelize.BOOLEAN,
            allowNull: false,
            defaultValue: true
          },
          display_order: {
            type: Sequelize.SMALLINT,
            allowNull: false,
            defaultValue: 0
          },
          created_at: {
            type: Sequelize.DATE,
            allowNull: false,
            defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
          },
          updated_at: {
            type: Sequelize.DATE,
            allowNull: false,
            defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
          }
        },
        { transaction }
      );

      await queryInterface.addConstraint('plans', {
        fields: ['code'],
        type: 'unique',
        name: 'uq_plans_code',
        transaction
      });

      await queryInterface.sequelize.query(
        `ALTER TABLE plans
         ADD CONSTRAINT chk_plans_interval
         CHECK (billing_interval IN ('NONE', 'MONTH', 'YEAR'));`,
        { transaction }
      );

      await queryInterface.sequelize.query(
        `ALTER TABLE plans
         ADD CONSTRAINT chk_plans_price
         CHECK (price_in_cents >= 0);`,
        { transaction }
      );
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('plans');
  }
};
