'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.createTable(
        'auth_refresh_tokens',
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
          token_hash: {
            type: Sequelize.STRING(255),
            allowNull: false
          },
          device_info: {
            type: Sequelize.STRING(255),
            allowNull: true
          },
          ip_address: {
            type: Sequelize.STRING(45),
            allowNull: true
          },
          expires_at: {
            type: Sequelize.DATE,
            allowNull: false
          },
          revoked_at: {
            type: Sequelize.DATE,
            allowNull: true
          },
          replaced_by_hash: {
            type: Sequelize.STRING(255),
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

      await queryInterface.addConstraint('auth_refresh_tokens', {
        fields: ['user_id'],
        type: 'foreign key',
        name: 'fk_auth_refresh_tokens_user',
        references: {
          table: 'users',
          field: 'id'
        },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
        transaction
      });

      await queryInterface.addIndex('auth_refresh_tokens', ['token_hash'], {
        unique: true,
        name: 'uq_auth_refresh_tokens_hash',
        transaction
      });

      await queryInterface.sequelize.query(
        `CREATE INDEX idx_auth_refresh_tokens_user_active
         ON auth_refresh_tokens (user_id)
         WHERE revoked_at IS NULL;`,
        { transaction }
      );
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('auth_refresh_tokens');
  }
};
