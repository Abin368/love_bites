'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.createTable(
        'relationship_intentions',
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
            type: Sequelize.STRING(255),
            allowNull: true
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

      await queryInterface.addConstraint('relationship_intentions', {
        fields: ['code'],
        type: 'unique',
        name: 'uq_relationship_intentions_code',
        transaction
      });
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('relationship_intentions');
  }
};
