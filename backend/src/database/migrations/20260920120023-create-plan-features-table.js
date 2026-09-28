'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.createTable(
        'plan_features',
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
          feature_id: {
            type: Sequelize.UUID,
            allowNull: false
          },
          created_at: {
            type: Sequelize.DATE,
            allowNull: false,
            defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
          }
        },
        { transaction }
      );

      await queryInterface.addConstraint('plan_features', {
        fields: ['plan_id'],
        type: 'foreign key',
        name: 'fk_plan_features_plan',
        references: { table: 'plans', field: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
        transaction
      });

      await queryInterface.addConstraint('plan_features', {
        fields: ['feature_id'],
        type: 'foreign key',
        name: 'fk_plan_features_feature',
        references: { table: 'features', field: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
        transaction
      });

      await queryInterface.addConstraint('plan_features', {
        fields: ['plan_id', 'feature_id'],
        type: 'unique',
        name: 'uq_plan_features_pair',
        transaction
      });
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('plan_features');
  }
};
