'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.createTable(
        'blocks',
        {
          id: {
            type: Sequelize.UUID,
            allowNull: false,
            primaryKey: true,
            defaultValue: Sequelize.literal('gen_random_uuid()')
          },
          blocker_id: {
            type: Sequelize.UUID,
            allowNull: false
          },
          blocked_id: {
            type: Sequelize.UUID,
            allowNull: false
          },
          reason: {
            type: Sequelize.STRING(255),
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

      await queryInterface.addConstraint('blocks', {
        fields: ['blocker_id'],
        type: 'foreign key',
        name: 'fk_blocks_blocker',
        references: { table: 'users', field: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
        transaction
      });

      await queryInterface.addConstraint('blocks', {
        fields: ['blocked_id'],
        type: 'foreign key',
        name: 'fk_blocks_blocked',
        references: { table: 'users', field: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
        transaction
      });

      await queryInterface.sequelize.query(
        `ALTER TABLE blocks
         ADD CONSTRAINT chk_blocks_no_self_block
         CHECK (blocker_id != blocked_id);`,
        { transaction }
      );

      await queryInterface.addConstraint('blocks', {
        fields: ['blocker_id', 'blocked_id'],
        type: 'unique',
        name: 'uq_blocks_pair',
        transaction
      });

      await queryInterface.addIndex('blocks', ['blocker_id', 'blocked_id'], {
        name: 'idx_blocks_lookup',
        transaction
      });

      await queryInterface.addIndex('blocks', ['blocked_id', 'blocker_id'], {
        name: 'idx_blocks_reverse_lookup',
        transaction
      });
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('blocks');
  }
};
