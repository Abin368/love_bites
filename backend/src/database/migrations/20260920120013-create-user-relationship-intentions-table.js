'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.createTable(
        'user_relationship_intentions',
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
          relationship_intention_id: {
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

      await queryInterface.addConstraint('user_relationship_intentions', {
        fields: ['user_id'],
        type: 'foreign key',
        name: 'fk_user_intentions_user',
        references: { table: 'users', field: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
        transaction
      });

      await queryInterface.addConstraint('user_relationship_intentions', {
        fields: ['relationship_intention_id'],
        type: 'foreign key',
        name: 'fk_user_intentions_intention',
        references: { table: 'relationship_intentions', field: 'id' },
        onDelete: 'RESTRICT',
        onUpdate: 'CASCADE',
        transaction
      });

      await queryInterface.addConstraint('user_relationship_intentions', {
        fields: ['user_id', 'relationship_intention_id'],
        type: 'unique',
        name: 'uq_user_intentions_pair',
        transaction
      });
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('user_relationship_intentions');
  }
};
