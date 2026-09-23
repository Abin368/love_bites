'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query('CREATE EXTENSION IF NOT EXISTS postgis;');
    await queryInterface.sequelize.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp";');
    await queryInterface.sequelize.query('CREATE EXTENSION IF NOT EXISTS pgcrypto;');
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query('DROP EXTENSION IF EXISTS pgcrypto;');
    await queryInterface.sequelize.query('DROP EXTENSION IF EXISTS "uuid-ossp";');
    await queryInterface.sequelize.query('DROP EXTENSION IF EXISTS postgis;');
  }
};
