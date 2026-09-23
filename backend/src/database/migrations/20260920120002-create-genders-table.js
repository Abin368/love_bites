'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.createTable(
        'genders',
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

      await queryInterface.addConstraint('genders', {
        fields: ['code'],
        type: 'unique',
        name: 'uq_genders_code',
        transaction
      });

      await queryInterface.addIndex('genders', ['is_active', 'display_order'], {
        name: 'idx_genders_active_order',
        transaction
      });
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('genders');
  }
};
