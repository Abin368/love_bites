'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.createTable(
        'processed_webhooks',
        {
          event_id: {
            type: Sequelize.STRING(255),
            allowNull: false,
            primaryKey: true
          },
          provider: {
            type: Sequelize.STRING(50),
            allowNull: false,
            defaultValue: 'RAZORPAY'
          },
          event_type: {
            type: Sequelize.STRING(100),
            allowNull: false
          },
          payload: {
            type: Sequelize.JSONB,
            allowNull: false
          },
          processed_at: {
            type: Sequelize.DATE,
            allowNull: false,
            defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
          }
        },
        { transaction }
      );

      await queryInterface.sequelize.query(
        `CREATE INDEX idx_processed_webhooks_provider_type
         ON processed_webhooks (provider, event_type, processed_at DESC);`,
        { transaction }
      );
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('processed_webhooks');
  }
};
