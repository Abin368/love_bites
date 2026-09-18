import { Sequelize } from 'sequelize';
import { env } from './env';
import { logger } from '../utils/logger';

let sequelize: Sequelize;

if (env.DATABASE_URL) {
  sequelize = new Sequelize(env.DATABASE_URL, {
    dialect: 'postgres',
    logging: (msg) => (env.NODE_ENV === 'development' ? logger.debug(msg) : false),
    pool: {
      max: env.DB_POOL_MAX,
      min: env.DB_POOL_MIN,
      idle: env.DB_POOL_IDLE,
      acquire: 30000
    },
    define: {
      timestamps: true,
      underscored: true,
      createdAt: 'created_at',
      updatedAt: 'updated_at'
    }
  });
} else {
  sequelize = new Sequelize({
    dialect: 'postgres',
    host: env.DB_HOST,
    port: env.DB_PORT,
    database: env.DB_NAME,
    username: env.DB_USER,
    password: env.DB_PASSWORD,
    logging: (msg) => (env.NODE_ENV === 'development' ? logger.debug(msg) : false),
    pool: {
      max: env.DB_POOL_MAX,
      min: env.DB_POOL_MIN,
      idle: env.DB_POOL_IDLE,
      acquire: 30000
    },
    define: {
      timestamps: true,
      underscored: true,
      createdAt: 'created_at',
      updatedAt: 'updated_at'
    }
  });
}

export { sequelize };
