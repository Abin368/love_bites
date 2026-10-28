'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.addColumn(
        'payments',
        'billing_interval',
        {
          type: Sequelize.STRING(20),
          allowNull: true
        },
        { transaction }
      );

      await queryInterface.sequelize.query(
        `ALTER TABLE payments
         ADD CONSTRAINT chk_payments_billing_interval
         CHECK (billing_interval IS NULL OR billing_interval IN ('MONTH', 'YEAR'));`,
        { transaction }
      );
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(
        'ALTER TABLE payments DROP CONSTRAINT chk_payments_billing_interval;',
        { transaction }
      );
      await queryInterface.removeColumn('payments', 'billing_interval', { transaction });
    });
  }
};
