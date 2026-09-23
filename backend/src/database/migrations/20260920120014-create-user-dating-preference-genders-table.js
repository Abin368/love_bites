'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.createTable(
        'user_dating_preference_genders',
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
          gender_id: {
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

      await queryInterface.addConstraint('user_dating_preference_genders', {
        fields: ['user_id'],
        type: 'foreign key',
        name: 'fk_pref_genders_user',
        references: { table: 'users', field: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
        transaction
      });

      await queryInterface.addConstraint('user_dating_preference_genders', {
        fields: ['gender_id'],
        type: 'foreign key',
        name: 'fk_pref_genders_gender',
        references: { table: 'genders', field: 'id' },
        onDelete: 'RESTRICT',
        onUpdate: 'CASCADE',
        transaction
      });

      await queryInterface.addConstraint('user_dating_preference_genders', {
        fields: ['user_id', 'gender_id'],
        type: 'unique',
        name: 'uq_pref_genders_pair',
        transaction
      });

      await queryInterface.addIndex('user_dating_preference_genders', ['gender_id', 'user_id'], {
        name: 'idx_pref_genders_lookup',
        transaction
      });
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('user_dating_preference_genders');
  }
};
