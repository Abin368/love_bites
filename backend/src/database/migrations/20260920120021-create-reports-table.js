'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.createTable(
        'reports',
        {
          id: {
            type: Sequelize.UUID,
            allowNull: false,
            primaryKey: true,
            defaultValue: Sequelize.literal('gen_random_uuid()')
          },
          reporter_id: {
            type: Sequelize.UUID,
            allowNull: true
          },
          reported_user_id: {
            type: Sequelize.UUID,
            allowNull: false
          },
          reason: {
            type: Sequelize.STRING(50),
            allowNull: false
          },
          description: {
            type: Sequelize.TEXT,
            allowNull: true
          },
          status: {
            type: Sequelize.STRING(30),
            allowNull: false,
            defaultValue: 'PENDING'
          },
          admin_notes: {
            type: Sequelize.TEXT,
            allowNull: true
          },
          resolved_by: {
            type: Sequelize.UUID,
            allowNull: true
          },
          resolved_at: {
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

      await queryInterface.addConstraint('reports', {
        fields: ['reporter_id'],
        type: 'foreign key',
        name: 'fk_reports_reporter',
        references: { table: 'users', field: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
        transaction
      });

      await queryInterface.addConstraint('reports', {
        fields: ['reported_user_id'],
        type: 'foreign key',
        name: 'fk_reports_reported',
        references: { table: 'users', field: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
        transaction
      });

      await queryInterface.addConstraint('reports', {
        fields: ['resolved_by'],
        type: 'foreign key',
        name: 'fk_reports_resolved_by',
        references: { table: 'users', field: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
        transaction
      });

      await queryInterface.sequelize.query(
        `ALTER TABLE reports
         ADD CONSTRAINT chk_reports_reason
         CHECK (reason IN ('FAKE_PROFILE', 'HARASSMENT', 'SPAM', 'INAPPROPRIATE_CONTENT', 'SCAM', 'OTHER'));`,
        { transaction }
      );

      await queryInterface.sequelize.query(
        `ALTER TABLE reports
         ADD CONSTRAINT chk_reports_status
         CHECK (status IN ('PENDING', 'REVIEWING', 'RESOLVED', 'DISMISSED'));`,
        { transaction }
      );

      await queryInterface.sequelize.query(
        `CREATE INDEX idx_reports_status_created
         ON reports (status, created_at ASC);`,
        { transaction }
      );

      await queryInterface.addIndex('reports', ['reported_user_id', 'status'], {
        name: 'idx_reports_reported_user',
        transaction
      });
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('reports');
  }
};
