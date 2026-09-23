'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.createTable(
        'conversations',
        {
          id: {
            type: Sequelize.UUID,
            allowNull: false,
            primaryKey: true,
            defaultValue: Sequelize.literal('gen_random_uuid()')
          },
          match_id: {
            type: Sequelize.UUID,
            allowNull: false
          },
          status: {
            type: Sequelize.STRING(20),
            allowNull: false,
            defaultValue: 'ACTIVE'
          },
          last_message_at: {
            type: Sequelize.DATE,
            allowNull: true
          },
          closed_at: {
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
          }
        },
        { transaction }
      );

      await queryInterface.addConstraint('conversations', {
        fields: ['match_id'],
        type: 'foreign key',
        name: 'fk_conversations_match',
        references: { table: 'matches', field: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
        transaction
      });

      await queryInterface.addConstraint('conversations', {
        fields: ['match_id'],
        type: 'unique',
        name: 'uq_conversations_match',
        transaction
      });

      await queryInterface.sequelize.query(
        `ALTER TABLE conversations
         ADD CONSTRAINT chk_conversations_status
         CHECK (status IN ('ACTIVE', 'CLOSED'));`,
        { transaction }
      );

      await queryInterface.sequelize.query(
        `CREATE INDEX idx_conversations_inbox_sort
         ON conversations (status, last_message_at DESC);`,
        { transaction }
      );
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('conversations');
  }
};
