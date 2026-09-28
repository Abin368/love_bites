'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.createTable(
        'subscriptions',
        {
          id: {
            type: Sequelize.UUID,
            allowNull: false,
            primaryKey: true,
            defaultValue: Sequelize.literal('gen_random_uuid()')
          },
          user_id: {
            type: Sequelize.UUID,
            allowNull: false
          },
          plan_id: {
            type: Sequelize.UUID,
            allowNull: false
          },
          provider: {
            type: Sequelize.STRING(50),
            allowNull: false,
            defaultValue: 'RAZORPAY'
          },
          provider_subscription_id: {
            type: Sequelize.STRING(255),
            allowNull: true
          },
          provider_customer_id: {
            type: Sequelize.STRING(255),
            allowNull: true
          },
          status: {
            type: Sequelize.STRING(30),
            allowNull: false,
            defaultValue: 'ACTIVE'
          },
          auto_renew: {
            type: Sequelize.BOOLEAN,
            allowNull: false,
            defaultValue: true
          },
          current_period_start: {
            type: Sequelize.DATE,
            allowNull: false
          },
          current_period_end: {
            type: Sequelize.DATE,
            allowNull: false
          },
          grace_period_end: {
            type: Sequelize.DATE,
            allowNull: true
          },
          canceled_at: {
            type: Sequelize.DATE,
            allowNull: true
          },
          ended_at: {
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

      await queryInterface.addConstraint('subscriptions', {
        fields: ['user_id'],
        type: 'foreign key',
        name: 'fk_subscriptions_user',
        references: { table: 'users', field: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
        transaction
      });

      await queryInterface.addConstraint('subscriptions', {
        fields: ['plan_id'],
        type: 'foreign key',
        name: 'fk_subscriptions_plan',
        references: { table: 'plans', field: 'id' },
        onDelete: 'RESTRICT',
        onUpdate: 'CASCADE',
        transaction
      });

      await queryInterface.sequelize.query(
        `ALTER TABLE subscriptions
         ADD CONSTRAINT chk_subscriptions_status
         CHECK (status IN ('ACTIVE', 'PAST_DUE', 'GRACE_PERIOD', 'CANCELED', 'EXPIRED'));`,
        { transaction }
      );

      await queryInterface.sequelize.query(
        `CREATE UNIQUE INDEX uq_subscriptions_single_active_per_user
         ON subscriptions (user_id)
         WHERE status IN ('ACTIVE', 'PAST_DUE', 'GRACE_PERIOD');`,
        { transaction }
      );

      await queryInterface.addIndex('subscriptions', ['provider', 'provider_subscription_id'], {
        name: 'idx_subscriptions_provider_sub_id',
        transaction
      });

      await queryInterface.addIndex(
        'subscriptions',
        ['status', 'current_period_end', 'grace_period_end'],
        {
          name: 'idx_subscriptions_expiration_reconcile',
          transaction
        }
      );
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('subscriptions');
  }
};
