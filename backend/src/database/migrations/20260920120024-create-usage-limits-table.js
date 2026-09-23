'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.createTable(
        'usage_limits',
        {
          id: {
            type: Sequelize.UUID,
            allowNull: false,
            primaryKey: true,
            defaultValue: Sequelize.literal('gen_random_uuid()')
          },
          plan_id: {
            type: Sequelize.UUID,
            allowNull: false
          },
          metric_key: {
            type: Sequelize.STRING(50),
            allowNull: false
          },
          limit_value: {
            type: Sequelize.INTEGER,
            allowNull: false
          },
          period_type: {
            type: Sequelize.STRING(20),
            allowNull: false,
            defaultValue: 'DAILY'
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

      await queryInterface.addConstraint('usage_limits', {
        fields: ['plan_id'],
        type: 'foreign key',
        name: 'fk_usage_limits_plan',
        references: { table: 'plans', field: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
        transaction
      });

      await queryInterface.addConstraint('usage_limits', {
        fields: ['plan_id', 'metric_key'],
        type: 'unique',
        name: 'uq_usage_limits_metric',
        transaction
      });

      await queryInterface.sequelize.query(
        `ALTER TABLE usage_limits
         ADD CONSTRAINT chk_usage_limits_period
         CHECK (period_type IN ('DAILY', 'MONTHLY', 'LIFETIME'));`,
        { transaction }
      );
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('usage_limits');
  }
};
