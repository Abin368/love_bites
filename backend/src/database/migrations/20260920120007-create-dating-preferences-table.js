'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.createTable(
        'dating_preferences',
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
          min_age: {
            type: Sequelize.SMALLINT,
            allowNull: false,
            defaultValue: 18
          },
          max_age: {
            type: Sequelize.SMALLINT,
            allowNull: false,
            defaultValue: 100
          },
          max_distance_km: {
            type: Sequelize.INTEGER,
            allowNull: false,
            defaultValue: 50
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

      await queryInterface.addConstraint('dating_preferences', {
        fields: ['user_id'],
        type: 'foreign key',
        name: 'fk_dating_preferences_user',
        references: {
          table: 'users',
          field: 'id'
        },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
        transaction
      });

      await queryInterface.addConstraint('dating_preferences', {
        fields: ['user_id'],
        type: 'unique',
        name: 'uq_dating_preferences_user',
        transaction
      });

      await queryInterface.sequelize.query(
        `ALTER TABLE dating_preferences
         ADD CONSTRAINT chk_dating_preferences_age_range
         CHECK (min_age >= 18 AND max_age >= min_age AND max_age <= 100);`,
        { transaction }
      );

      await queryInterface.sequelize.query(
        `ALTER TABLE dating_preferences
         ADD CONSTRAINT chk_dating_preferences_distance
         CHECK (max_distance_km >= 1 AND max_distance_km <= 500);`,
        { transaction }
      );
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('dating_preferences');
  }
};
