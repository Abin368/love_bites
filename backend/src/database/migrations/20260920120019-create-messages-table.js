'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.createTable(
        'messages',
        {
          id: {
            type: Sequelize.UUID,
            allowNull: false,
            primaryKey: true,
            defaultValue: Sequelize.literal('gen_random_uuid()')
          },
          conversation_id: {
            type: Sequelize.UUID,
            allowNull: false
          },
          sender_id: {
            type: Sequelize.UUID,
            allowNull: false
          },
          message_type: {
            type: Sequelize.STRING(20),
            allowNull: false,
            defaultValue: 'TEXT'
          },
          content: {
            type: Sequelize.TEXT,
            allowNull: true
          },
          media_storage_key: {
            type: Sequelize.STRING(512),
            allowNull: true
          },
          media_mime_type: {
            type: Sequelize.STRING(50),
            allowNull: true
          },
          media_file_size: {
            type: Sequelize.INTEGER,
            allowNull: true
          },
          read_at: {
            type: Sequelize.DATE,
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
          },
          deleted_at: {
            type: Sequelize.DATE,
            allowNull: true
          }
        },
        { transaction }
      );

      await queryInterface.addConstraint('messages', {
        fields: ['conversation_id'],
        type: 'foreign key',
        name: 'fk_messages_conversation',
        references: { table: 'conversations', field: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
        transaction
      });

      await queryInterface.addConstraint('messages', {
        fields: ['sender_id'],
        type: 'foreign key',
        name: 'fk_messages_sender',
        references: { table: 'users', field: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
        transaction
      });

      await queryInterface.sequelize.query(
        `ALTER TABLE messages
         ADD CONSTRAINT chk_messages_type
         CHECK (message_type IN ('TEXT', 'IMAGE', 'GIF', 'VIDEO', 'VOICE'));`,
        { transaction }
      );

      await queryInterface.sequelize.query(
        `ALTER TABLE messages
         ADD CONSTRAINT chk_messages_payload_integrity
         CHECK (
           (message_type = 'TEXT' AND content IS NOT NULL)
           OR (message_type IN ('IMAGE', 'GIF', 'VIDEO', 'VOICE') AND media_storage_key IS NOT NULL)
         );`,
        { transaction }
      );

      await queryInterface.sequelize.query(
        `CREATE INDEX idx_messages_conversation_history
         ON messages (conversation_id, created_at DESC)
         WHERE deleted_at IS NULL;`,
        { transaction }
      );

      await queryInterface.sequelize.query(
        `CREATE INDEX idx_messages_unread_count
         ON messages (conversation_id, sender_id, read_at)
         WHERE read_at IS NULL AND deleted_at IS NULL;`,
        { transaction }
      );
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('messages');
  }
};
