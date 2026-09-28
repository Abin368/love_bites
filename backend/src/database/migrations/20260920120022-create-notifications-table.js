'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.createTable(
        'notifications',
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
          type: {
            type: Sequelize.STRING(50),
            allowNull: false
          },
          title: {
            type: Sequelize.STRING(255),
            allowNull: false
          },
          message: {
            type: Sequelize.TEXT,
            allowNull: false
          },
          data: {
            type: Sequelize.JSONB,
            allowNull: false,
            defaultValue: Sequelize.literal("'{}'::jsonb")
          },
          read_at: {
            type: Sequelize.DATE,
            allowNull: true
          },
          created_at: {
            type: Sequelize.DATE,
            allowNull: false,
            defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
          }
        },
        { transaction }
      );

      await queryInterface.addConstraint('notifications', {
        fields: ['user_id'],
        type: 'foreign key',
        name: 'fk_notifications_user',
        references: { table: 'users', field: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
        transaction
      });

      await queryInterface.sequelize.query(
        `ALTER TABLE notifications
         ADD CONSTRAINT chk_notifications_type
         CHECK (type IN ('NEW_MATCH', 'NEW_MESSAGE', 'NEW_LIKE'));`,
        { transaction }
      );

      await queryInterface.sequelize.query(
        `CREATE INDEX idx_notifications_user_unread
         ON notifications (user_id, created_at DESC)
         WHERE read_at IS NULL;`,
        { transaction }
      );

      await queryInterface.sequelize.query(
        `CREATE INDEX idx_notifications_user_feed
         ON notifications (user_id, created_at DESC);`,
        { transaction }
      );
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('notifications');
  }
};
