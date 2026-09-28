'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.createTable(
        'credit_transactions',
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
          delta: {
            type: Sequelize.INTEGER,
            allowNull: false
          },
          reason: {
            type: Sequelize.STRING(50),
            allowNull: false
          },
          reference_id: {
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

      await queryInterface.addConstraint('credit_transactions', {
        fields: ['user_id'],
        type: 'foreign key',
        name: 'fk_credit_transactions_user',
        references: { table: 'users', field: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
        transaction
      });

      await queryInterface.sequelize.query(
        `ALTER TABLE credit_transactions
         ADD CONSTRAINT chk_credit_transactions_delta_nonzero
         CHECK (delta != 0);`,
        { transaction }
      );

      await queryInterface.sequelize.query(
        `ALTER TABLE credit_transactions
         ADD CONSTRAINT chk_credit_transactions_reason
         CHECK (reason IN ('MONTHLY_GRANT', 'PURCHASE', 'CONSUMPTION', 'ADMIN_ADJUSTMENT', 'REFUND'));`,
        { transaction }
      );

      await queryInterface.sequelize.query(
        `CREATE INDEX idx_credit_transactions_audit
         ON credit_transactions (user_id, credit_type, created_at DESC);`,
        { transaction }
      );
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('credit_transactions');
  }
};
