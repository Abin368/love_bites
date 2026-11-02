'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.addColumn(
        'payments',
        'plan_id',
        {
          type: Sequelize.UUID,
          allowNull: true
        },
        { transaction }
      );

      await queryInterface.addColumn(
        'payments',
        'idempotency_key',
        {
          type: Sequelize.STRING(255),
          allowNull: true
        },
        { transaction }
      );

      await queryInterface.addConstraint('payments', {
        fields: ['plan_id'],
        type: 'foreign key',
        name: 'fk_payments_plan',
        references: { table: 'plans', field: 'id' },
        onDelete: 'RESTRICT',
        onUpdate: 'CASCADE',
        transaction
      });

      const [duplicates] = await queryInterface.sequelize.query(
        `SELECT provider, provider_order_id, COUNT(*)::int AS row_count
         FROM payments
         WHERE provider_order_id IS NOT NULL
         GROUP BY provider, provider_order_id
         HAVING COUNT(*) > 1`,
        { transaction }
      );

      if (duplicates.length > 0) {
        const summary = duplicates
          .map((row) => `${row.provider}:${row.provider_order_id} (${row.row_count})`)
          .join(', ');
        throw new Error(
          `Refusing to add uq_payments_provider_order_id because duplicate provider order ids exist: ${summary}. No ledger rows were changed.`
        );
      }

      await queryInterface.removeIndex('payments', 'idx_payments_order_lookup', { transaction });

      await queryInterface.sequelize.query(
        `CREATE UNIQUE INDEX uq_payments_provider_order_id
         ON payments (provider, provider_order_id)
         WHERE provider_order_id IS NOT NULL;`,
        { transaction }
      );

      await queryInterface.sequelize.query(
        `CREATE UNIQUE INDEX uq_payments_user_idempotency_key
         ON payments (user_id, idempotency_key)
         WHERE user_id IS NOT NULL AND idempotency_key IS NOT NULL;`,
        { transaction }
      );
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query('DROP INDEX IF EXISTS uq_payments_provider_order_id;', { transaction });
      await queryInterface.sequelize.query('DROP INDEX IF EXISTS uq_payments_user_idempotency_key;', { transaction });

      await queryInterface.addIndex('payments', ['provider_order_id'], {
        name: 'idx_payments_order_lookup',
        transaction
      });

      await queryInterface.removeConstraint('payments', 'fk_payments_plan', { transaction });
      await queryInterface.removeColumn('payments', 'idempotency_key', { transaction });
      await queryInterface.removeColumn('payments', 'plan_id', { transaction });
    });
  }
};
