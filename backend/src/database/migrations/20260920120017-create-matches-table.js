'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.createTable(
        'matches',
        {
          id: {
            type: Sequelize.UUID,
            allowNull: false,
            primaryKey: true,
            defaultValue: Sequelize.literal('gen_random_uuid()')
          },
          user_one_id: {
            type: Sequelize.UUID,
            allowNull: false
          },
          user_two_id: {
            type: Sequelize.UUID,
            allowNull: false
          },
          status: {
            type: Sequelize.STRING(20),
            allowNull: false,
            defaultValue: 'ACTIVE'
          },
          matched_at: {
            type: Sequelize.DATE,
            allowNull: false,
            defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
          },
          unmatched_at: {
            type: Sequelize.DATE,
            allowNull: true
          },
          unmatched_by_user_id: {
            type: Sequelize.UUID,
            allowNull: true
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

      await queryInterface.addConstraint('matches', {
        fields: ['user_one_id'],
        type: 'foreign key',
        name: 'fk_matches_user_one',
        references: { table: 'users', field: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
        transaction
      });

      await queryInterface.addConstraint('matches', {
        fields: ['user_two_id'],
        type: 'foreign key',
        name: 'fk_matches_user_two',
        references: { table: 'users', field: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
        transaction
      });

      await queryInterface.addConstraint('matches', {
        fields: ['unmatched_by_user_id'],
        type: 'foreign key',
        name: 'fk_matches_unmatched_by',
        references: { table: 'users', field: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
        transaction
      });

      await queryInterface.sequelize.query(
        `ALTER TABLE matches
         ADD CONSTRAINT chk_matches_canonical_order
         CHECK (user_one_id < user_two_id);`,
        { transaction }
      );

      await queryInterface.sequelize.query(
        `ALTER TABLE matches
         ADD CONSTRAINT chk_matches_status
         CHECK (status IN ('ACTIVE', 'UNMATCHED', 'UNDONE'));`,
        { transaction }
      );

      await queryInterface.sequelize.query(
        `CREATE UNIQUE INDEX uq_matches_single_active_pair
         ON matches (user_one_id, user_two_id)
         WHERE status = 'ACTIVE';`,
        { transaction }
      );

      await queryInterface.addIndex('matches', ['user_one_id', 'status'], {
        name: 'idx_matches_user_one',
        transaction
      });

      await queryInterface.addIndex('matches', ['user_two_id', 'status'], {
        name: 'idx_matches_user_two',
        transaction
      });
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('matches');
  }
};
