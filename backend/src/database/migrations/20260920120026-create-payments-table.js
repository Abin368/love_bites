'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.createTable(
        'payments',
        {
          id: {
            type: Sequelize.UUID,
            allowNull: false,
            primaryKey: true,
            defaultValue: Sequelize.literal('gen_random_uuid()')
          },
          user_id: {
            type: Sequelize.UUID,
            allowNull: true
          },
          subscription_id: {
            type: Sequelize.UUID,
            allowNull: true
          },
          provider: {
            type: Sequelize.STRING(50),
            allowNull: false,
            defaultValue: 'RAZORPAY'
          },
          provider_payment_id: {
            type: Sequelize.STRING(255),
            allowNull: true
          },
          provider_order_id: {
            type: Sequelize.STRING(255),
            allowNull: true
          },
          amount_in_cents: {
            type: Sequelize.INTEGER,
            allowNull: false
          },
          currency: {
            type: Sequelize.STRING(3),
            allowNull: false,
            defaultValue: 'INR'
          },
          status: {
            type: Sequelize.STRING(30),
            allowNull: false,
            defaultValue: 'INITIATED'
          },
          payment_type: {
            type: Sequelize.STRING(30),
            allowNull: false
          },
          raw_payload: {
            type: Sequelize.JSONB,
            allowNull: true
          },
          failure_reason: {
            type: Sequelize.TEXT,
            allowNull: true
          },
          paid_at: {
            type: Sequelize.DATE,
            allowNull: true
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

      await queryInterface.addConstraint('payments', {
        fields: ['user_id'],
        type: 'foreign key',
        name: 'fk_payments_user',
        references: { table: 'users', field: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
        transaction
      });

      await queryInterface.addConstraint('payments', {
        fields: ['subscription_id'],
        type: 'foreign key',
        name: 'fk_payments_subscription',
        references: { table: 'subscriptions', field: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
        transaction
      });

      await queryInterface.sequelize.query(
        `ALTER TABLE payments
         ADD CONSTRAINT chk_payments_status
         CHECK (status IN ('INITIATED', 'AUTHORIZED', 'CAPTURED', 'FAILED', 'REFUNDED'));`,
        { transaction }
      );

      await queryInterface.sequelize.query(
        `ALTER TABLE payments
         ADD CONSTRAINT chk_payments_type
         CHECK (payment_type IN ('SUBSCRIPTION_INITIAL', 'SUBSCRIPTION_RECURRING', 'CREDIT_PURCHASE'));`,
        { transaction }
      );

      await queryInterface.sequelize.query(
        `ALTER TABLE payments
         ADD CONSTRAINT chk_payments_amount
         CHECK (amount_in_cents > 0);`,
        { transaction }
      );

      await queryInterface.sequelize.query(
        `CREATE UNIQUE INDEX uq_payments_provider_payment_id
         ON payments (provider, provider_payment_id)
         WHERE provider_payment_id IS NOT NULL;`,
        { transaction }
      );

      await queryInterface.sequelize.query(
        `CREATE INDEX idx_payments_user_history
         ON payments (user_id, created_at DESC);`,
        { transaction }
      );

      await queryInterface.addIndex('payments', ['provider_order_id'], {
        name: 'idx_payments_order_lookup',
        transaction
      });
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('payments');
  }
};
