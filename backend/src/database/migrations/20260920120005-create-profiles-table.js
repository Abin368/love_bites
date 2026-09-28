'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.createTable(
        'profiles',
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
          first_name: {
            type: Sequelize.STRING(100),
            allowNull: false
          },
          date_of_birth: {
            type: Sequelize.DATEONLY,
            allowNull: false
          },
          gender_id: {
            type: Sequelize.UUID,
            allowNull: false
          },
          bio: {
            type: Sequelize.TEXT,
            allowNull: true
          },
          occupation: {
            type: Sequelize.STRING(100),
            allowNull: true
          },
          education: {
            type: Sequelize.STRING(100),
            allowNull: true
          },
          city: {
            type: Sequelize.STRING(100),
            allowNull: false
          },
          is_profile_complete: {
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
          }
        },
        { transaction }
      );

      await queryInterface.sequelize.query(
        `ALTER TABLE profiles
         ADD COLUMN location geography(Point, 4326) NOT NULL;`,
        { transaction }
      );

      await queryInterface.addConstraint('profiles', {
        fields: ['user_id'],
        type: 'foreign key',
        name: 'fk_profiles_user',
        references: {
          table: 'users',
          field: 'id'
        },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
        transaction
      });

      await queryInterface.addConstraint('profiles', {
        fields: ['gender_id'],
        type: 'foreign key',
        name: 'fk_profiles_gender',
        references: {
          table: 'genders',
          field: 'id'
        },
        onDelete: 'RESTRICT',
        onUpdate: 'CASCADE',
        transaction
      });

      await queryInterface.addConstraint('profiles', {
        fields: ['user_id'],
        type: 'unique',
        name: 'uq_profiles_user_id',
        transaction
      });

      await queryInterface.sequelize.query(
        `ALTER TABLE profiles
         ADD CONSTRAINT chk_profiles_age_18_plus
         CHECK (date_of_birth <= CURRENT_DATE - INTERVAL '18 years');`,
        { transaction }
      );

      await queryInterface.sequelize.query(
        `CREATE INDEX idx_profiles_location_gist
         ON profiles USING GIST (location);`,
        { transaction }
      );

      await queryInterface.addIndex(
        'profiles',
        ['is_profile_complete', 'gender_id', 'date_of_birth'],
        {
          name: 'idx_profiles_discovery_eligibility',
          transaction
        }
      );
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('profiles');
  }
};
