'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.createTable(
        'plan_price_changes',
        {
          id: {
            type: Sequelize.UUID,
            allowNull: false,
            primaryKey: true,
            defaultValue: Sequelize.literal('gen_random_uuid()')
          },
          admin_user_id: {
            type: Sequelize.UUID,
            allowNull: true
          },
          plan_id: {
            type: Sequelize.UUID,
            allowNull: false
          },
          old_price_in_cents: {
            type: Sequelize.INTEGER,
            allowNull: false
          },
          new_price_in_cents: {
            type: Sequelize.INTEGER,
            allowNull: false
          },
          old_currency: {
            type: Sequelize.STRING(3),
            allowNull: false
          },
          new_currency: {
            type: Sequelize.STRING(3),
            allowNull: false
          },
          action: {
            type: Sequelize.STRING(50),
            allowNull: false
          },
          reason: {
            type: Sequelize.TEXT,
            allowNull: false
          },
          created_at: {
            type: Sequelize.DATE,
            allowNull: false,
            defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
          }
        },
        { transaction }
      );

      await queryInterface.addConstraint('plan_price_changes', {
        fields: ['admin_user_id'],
        type: 'foreign key',
        name: 'fk_plan_price_changes_admin',
        references: { table: 'users', field: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
        transaction
      });

      await queryInterface.addConstraint('plan_price_changes', {
        fields: ['plan_id'],
        type: 'foreign key',
        name: 'fk_plan_price_changes_plan',
        references: { table: 'plans', field: 'id' },
        onDelete: 'RESTRICT',
        onUpdate: 'CASCADE',
        transaction
      });

      await queryInterface.sequelize.query(
        `ALTER TABLE plan_price_changes
         ADD CONSTRAINT chk_plan_price_changes_prices
         CHECK (old_price_in_cents >= 0 AND new_price_in_cents >= 0);`,
        { transaction }
      );

      await queryInterface.sequelize.query(
        `ALTER TABLE plan_price_changes
         ADD CONSTRAINT chk_plan_price_changes_new_currency
         CHECK (new_currency = 'INR');`,
        { transaction }
      );

      await queryInterface.sequelize.query(
        `ALTER TABLE plan_price_changes
         ADD CONSTRAINT chk_plan_price_changes_action
         CHECK (action = 'PLAN_PRICE_CHANGED');`,
        { transaction }
      );

      await queryInterface.sequelize.query(
        `ALTER TABLE plan_price_changes
         ADD CONSTRAINT chk_plan_price_changes_reason
         CHECK (char_length(btrim(reason)) > 0);`,
        { transaction }
      );

      await queryInterface.sequelize.query(
        `CREATE INDEX idx_plan_price_changes_plan_created
         ON plan_price_changes (plan_id, created_at DESC);`,
        { transaction }
      );
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('plan_price_changes');
  }
};
