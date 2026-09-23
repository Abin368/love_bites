'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.createTable(
        'usage_records',
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
          metric_key: {
            type: Sequelize.STRING(50),
            allowNull: false
          },
          period_start: {
            type: Sequelize.DATE,
            allowNull: false
          },
          period_end: {
            type: Sequelize.DATE,
            allowNull: false
          },
          usage_count: {
            type: Sequelize.INTEGER,
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

      await queryInterface.addConstraint('usage_records', {
        fields: ['user_id'],
        type: 'foreign key',
        name: 'fk_usage_records_user',
        references: { table: 'users', field: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
        transaction
      });

      await queryInterface.addConstraint('usage_records', {
        fields: ['user_id', 'metric_key', 'period_start'],
        type: 'unique',
        name: 'uq_usage_records_window',
        transaction
      });

      await queryInterface.sequelize.query(
        `ALTER TABLE usage_records
         ADD CONSTRAINT chk_usage_records_count
         CHECK (usage_count >= 0);`,
        { transaction }
      );

      await queryInterface.addIndex(
        'usage_records',
        ['user_id', 'metric_key', 'period_start', 'period_end'],
        {
          name: 'idx_usage_records_lookup',
          transaction
        }
      );
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('usage_records');
  }
};
