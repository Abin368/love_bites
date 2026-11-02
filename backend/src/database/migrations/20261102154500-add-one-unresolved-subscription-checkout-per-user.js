'use strict';

const INDEX_NAME = 'uq_payments_one_unresolved_subscription_checkout_per_user';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      const [duplicates] = await queryInterface.sequelize.query(
        `SELECT user_id, COUNT(*)::int AS row_count
         FROM payments
         WHERE user_id IS NOT NULL
           AND payment_type = 'SUBSCRIPTION_INITIAL'
           AND status IN ('INITIATED', 'AUTHORIZED')
         GROUP BY user_id
         HAVING COUNT(*) > 1`,
        { transaction }
      );

      if (duplicates.length > 0) {
        const summary = duplicates
          .map((row) => `${row.user_id} (${row.row_count})`)
          .join(', ');
        throw new Error(
          `Refusing to add ${INDEX_NAME} because duplicate unresolved subscription-initial payments exist for user_id: ${summary}. No ledger rows were changed. Resolve the duplicates before migrating.`
        );
      }

      await queryInterface.sequelize.query(
        `CREATE UNIQUE INDEX ${INDEX_NAME}
         ON payments (user_id)
         WHERE user_id IS NOT NULL
           AND payment_type = 'SUBSCRIPTION_INITIAL'
           AND status IN ('INITIATED', 'AUTHORIZED');`,
        { transaction }
      );
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(`DROP INDEX IF EXISTS ${INDEX_NAME};`, { transaction });
    });
  }
};
