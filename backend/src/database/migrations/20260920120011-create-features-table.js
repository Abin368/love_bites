'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.createTable(
        'features',
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
          description: {
            type: Sequelize.TEXT,
            allowNull: true
          },
          is_active: {
            type: Sequelize.BOOLEAN,
            allowNull: false,
            defaultValue: true
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

      await queryInterface.addConstraint('features', {
        fields: ['code'],
        type: 'unique',
        name: 'uq_features_code',
        transaction
      });
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('features');
  }
};
