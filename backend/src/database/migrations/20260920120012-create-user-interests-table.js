'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.createTable(
        'user_interests',
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
          interest_id: {
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

      await queryInterface.addConstraint('user_interests', {
        fields: ['user_id'],
        type: 'foreign key',
        name: 'fk_user_interests_user',
        references: { table: 'users', field: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
        transaction
      });

      await queryInterface.addConstraint('user_interests', {
        fields: ['interest_id'],
        type: 'foreign key',
        name: 'fk_user_interests_interest',
        references: { table: 'interests', field: 'id' },
        onDelete: 'RESTRICT',
        onUpdate: 'CASCADE',
        transaction
      });

      await queryInterface.addConstraint('user_interests', {
        fields: ['user_id', 'interest_id'],
        type: 'unique',
        name: 'uq_user_interests_pair',
        transaction
      });

      await queryInterface.addIndex('user_interests', ['interest_id', 'user_id'], {
        name: 'idx_user_interests_interest_lookup',
        transaction
      });
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('user_interests');
  }
};
