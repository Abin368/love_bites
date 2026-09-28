'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.createTable(
        'profile_photos',
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
          storage_key: {
            type: Sequelize.STRING(512),
            allowNull: false
          },
          original_filename: {
            type: Sequelize.STRING(255),
            allowNull: true
          },
          mime_type: {
            type: Sequelize.STRING(50),
            allowNull: false
          },
          file_size_bytes: {
            type: Sequelize.INTEGER,
            allowNull: false
          },
          display_order: {
            type: Sequelize.SMALLINT,
            allowNull: false,
            defaultValue: 1
          },
          is_primary: {
            type: Sequelize.BOOLEAN,
            allowNull: false,
            defaultValue: false
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

      await queryInterface.addConstraint('profile_photos', {
        fields: ['user_id'],
        type: 'foreign key',
        name: 'fk_profile_photos_user',
        references: {
          table: 'users',
          field: 'id'
        },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
        transaction
      });

      await queryInterface.sequelize.query(
        `ALTER TABLE profile_photos
         ADD CONSTRAINT chk_profile_photos_display_order
         CHECK (display_order BETWEEN 1 AND 5);`,
        { transaction }
      );

      await queryInterface.sequelize.query(
        `ALTER TABLE profile_photos
         ADD CONSTRAINT chk_profile_photos_file_size
         CHECK (file_size_bytes > 0 AND file_size_bytes <= 10485760);`,
        { transaction }
      );

      await queryInterface.sequelize.query(
        `CREATE UNIQUE INDEX uq_profile_photos_primary_per_user
         ON profile_photos (user_id)
         WHERE is_primary = TRUE AND deleted_at IS NULL;`,
        { transaction }
      );

      await queryInterface.sequelize.query(
        `CREATE UNIQUE INDEX uq_profile_photos_order_per_user
         ON profile_photos (user_id, display_order)
         WHERE deleted_at IS NULL;`,
        { transaction }
      );

      await queryInterface.sequelize.query(
        `CREATE INDEX idx_profile_photos_user_active
         ON profile_photos (user_id, display_order)
         WHERE deleted_at IS NULL;`,
        { transaction }
      );
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('profile_photos');
  }
};
