'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.createTable(
        'users',
        {
          id: {
            type: Sequelize.UUID,
            allowNull: false,
            primaryKey: true,
            defaultValue: Sequelize.literal('gen_random_uuid()')
          },
          email: {
            type: Sequelize.STRING(255),
            allowNull: true
          },
          phone: {
            type: Sequelize.STRING(32),
            allowNull: true
          },
          password_hash: {
            type: Sequelize.STRING(255),
            allowNull: false
          },
          role: {
            type: Sequelize.STRING(20),
            allowNull: false,
            defaultValue: 'USER'
          },
          status: {
            type: Sequelize.STRING(20),
            allowNull: false,
            defaultValue: 'UNVERIFIED'
          },
          email_verified: {
            type: Sequelize.BOOLEAN,
            allowNull: false,
            defaultValue: false
          },
          phone_verified: {
            type: Sequelize.BOOLEAN,
            allowNull: false,
            defaultValue: false
          },
          last_active_at: {
            type: Sequelize.DATE,
            allowNull: true,
            defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
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

      await queryInterface.sequelize.query(
        `ALTER TABLE users
         ADD CONSTRAINT chk_users_identifier_present
         CHECK (email IS NOT NULL OR phone IS NOT NULL);`,
        { transaction }
      );

      await queryInterface.sequelize.query(
        `ALTER TABLE users
         ADD CONSTRAINT chk_users_role
         CHECK (role IN ('USER', 'ADMIN'));`,
        { transaction }
      );

      await queryInterface.sequelize.query(
        `ALTER TABLE users
         ADD CONSTRAINT chk_users_status
         CHECK (status IN ('UNVERIFIED', 'ACTIVE', 'SUSPENDED', 'BANNED', 'DELETED'));`,
        { transaction }
      );

      await queryInterface.sequelize.query(
        `CREATE UNIQUE INDEX uq_users_email_active
         ON users (email)
         WHERE email IS NOT NULL AND deleted_at IS NULL;`,
        { transaction }
      );

      await queryInterface.sequelize.query(
        `CREATE UNIQUE INDEX uq_users_phone_active
         ON users (phone)
         WHERE phone IS NOT NULL AND deleted_at IS NULL;`,
        { transaction }
      );

      await queryInterface.sequelize.query(
        `CREATE INDEX idx_users_status
         ON users (status)
         WHERE deleted_at IS NULL;`,
        { transaction }
      );
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('users');
  }
};
