'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.createTable(
        'user_credit_balances',
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
          credit_type: {
            type: Sequelize.STRING(50),
            allowNull: false
          },
          balance: {
            type: Sequelize.INTEGER,
            allowNull: false,
            defaultValue: 0
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

      await queryInterface.addConstraint('user_credit_balances', {
        fields: ['user_id'],
        type: 'foreign key',
        name: 'fk_user_credit_balances_user',
        references: { table: 'users', field: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
        transaction
      });

      await queryInterface.addConstraint('user_credit_balances', {
        fields: ['user_id', 'credit_type'],
        type: 'unique',
        name: 'uq_user_credit_balances_pair',
        transaction
      });

      await queryInterface.sequelize.query(
        `ALTER TABLE user_credit_balances
         ADD CONSTRAINT chk_user_credit_balances_non_negative
         CHECK (balance >= 0);`,
        { transaction }
      );
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('user_credit_balances');
  }
};
