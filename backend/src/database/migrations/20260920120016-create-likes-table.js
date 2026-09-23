'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.createTable(
        'likes',
        {
          id: {
            type: Sequelize.UUID,
            allowNull: false,
            primaryKey: true,
            defaultValue: Sequelize.literal('gen_random_uuid()')
          },
          from_user_id: {
            type: Sequelize.UUID,
            allowNull: false
          },
          to_user_id: {
            type: Sequelize.UUID,
            allowNull: false
          },
          action: {
            type: Sequelize.STRING(20),
            allowNull: false
          },
          is_undone: {
            type: Sequelize.BOOLEAN,
            allowNull: false,
            defaultValue: false
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

      await queryInterface.addConstraint('likes', {
        fields: ['from_user_id'],
        type: 'foreign key',
        name: 'fk_likes_from_user',
        references: { table: 'users', field: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
        transaction
      });

      await queryInterface.addConstraint('likes', {
        fields: ['to_user_id'],
        type: 'foreign key',
        name: 'fk_likes_to_user',
        references: { table: 'users', field: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
        transaction
      });

      await queryInterface.sequelize.query(
        `ALTER TABLE likes
         ADD CONSTRAINT chk_likes_no_self_like
         CHECK (from_user_id != to_user_id);`,
        { transaction }
      );

      await queryInterface.sequelize.query(
        `ALTER TABLE likes
         ADD CONSTRAINT chk_likes_action_type
         CHECK (action IN ('LIKE', 'PASS', 'SUPER_LIKE'));`,
        { transaction }
      );

      await queryInterface.sequelize.query(
        `CREATE UNIQUE INDEX uq_likes_active_pair
         ON likes (from_user_id, to_user_id)
         WHERE is_undone = FALSE;`,
        { transaction }
      );

      await queryInterface.sequelize.query(
        `CREATE INDEX idx_likes_to_user_likers
         ON likes (to_user_id, action, created_at)
         WHERE is_undone = FALSE;`,
        { transaction }
      );

      await queryInterface.sequelize.query(
        `CREATE INDEX idx_likes_reciprocal_check
         ON likes (to_user_id, from_user_id, action)
         WHERE is_undone = FALSE;`,
        { transaction }
      );
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('likes');
  }
};
