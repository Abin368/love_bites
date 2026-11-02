import request from 'supertest';
import { QueryInterface } from 'sequelize';
import { sequelize } from '../../src/config/database';
import { Interest } from '../../src/database/models/interest.model';
import { UserInterest } from '../../src/database/models/user-interest.model';
import { createUser } from '../../src/modules/users/users.data-access';
import { resetMemoryRedis } from '../../src/config/redis';

jest.mock('../../src/config/redis', () => jest.requireActual('../helpers/memory-redis'));

import { app } from '../../src/app';

interface Seeder {
  up: (queryInterface: QueryInterface) => Promise<void>;
  down: (queryInterface: QueryInterface) => Promise<void>;
}

const interestCatalogSeeder = require('../../src/database/seeders/20261102120004-seed-interest-catalog') as Seeder;

const INTEREST_SEED = [
  { code: 'TRAVEL', name: 'Travel', category: 'Travel & Adventure', displayOrder: 1 },
  { code: 'ROAD_TRIPS', name: 'Road Trips', category: 'Travel & Adventure', displayOrder: 2 },
  { code: 'ADVENTURE', name: 'Adventure', category: 'Travel & Adventure', displayOrder: 3 },
  { code: 'HIKING', name: 'Hiking', category: 'Travel & Adventure', displayOrder: 4 },
  { code: 'CAMPING', name: 'Camping', category: 'Travel & Adventure', displayOrder: 5 },
  { code: 'FOODIE', name: 'Foodie', category: 'Food & Drinks', displayOrder: 6 },
  { code: 'COOKING', name: 'Cooking', category: 'Food & Drinks', displayOrder: 7 },
  { code: 'COFFEE', name: 'Coffee', category: 'Food & Drinks', displayOrder: 8 },
  { code: 'BAKING', name: 'Baking', category: 'Food & Drinks', displayOrder: 9 },
  { code: 'STREET_FOOD', name: 'Street Food', category: 'Food & Drinks', displayOrder: 10 },
  { code: 'MOVIES', name: 'Movies', category: 'Entertainment', displayOrder: 11 },
  { code: 'TV_SHOWS', name: 'TV Shows', category: 'Entertainment', displayOrder: 12 },
  { code: 'MUSIC', name: 'Music', category: 'Entertainment', displayOrder: 13 },
  { code: 'CONCERTS', name: 'Concerts', category: 'Entertainment', displayOrder: 14 },
  { code: 'ANIME', name: 'Anime', category: 'Entertainment', displayOrder: 15 },
  { code: 'FITNESS', name: 'Fitness', category: 'Sports & Fitness', displayOrder: 16 },
  { code: 'CRICKET', name: 'Cricket', category: 'Sports & Fitness', displayOrder: 17 },
  { code: 'FOOTBALL', name: 'Football', category: 'Sports & Fitness', displayOrder: 18 },
  { code: 'BADMINTON', name: 'Badminton', category: 'Sports & Fitness', displayOrder: 19 },
  { code: 'YOGA', name: 'Yoga', category: 'Sports & Fitness', displayOrder: 20 },
  { code: 'PHOTOGRAPHY', name: 'Photography', category: 'Arts & Creativity', displayOrder: 21 },
  { code: 'PAINTING', name: 'Painting', category: 'Arts & Creativity', displayOrder: 22 },
  { code: 'DANCING', name: 'Dancing', category: 'Arts & Creativity', displayOrder: 23 },
  { code: 'WRITING', name: 'Writing', category: 'Arts & Creativity', displayOrder: 24 },
  { code: 'FASHION', name: 'Fashion', category: 'Arts & Creativity', displayOrder: 25 },
  { code: 'NIGHTLIFE', name: 'Nightlife', category: 'Lifestyle & Social', displayOrder: 26 },
  { code: 'PARTIES', name: 'Parties', category: 'Lifestyle & Social', displayOrder: 27 },
  { code: 'SHOPPING', name: 'Shopping', category: 'Lifestyle & Social', displayOrder: 28 },
  { code: 'PETS', name: 'Pets', category: 'Lifestyle & Social', displayOrder: 29 },
  { code: 'VOLUNTEERING', name: 'Volunteering', category: 'Lifestyle & Social', displayOrder: 30 },
  { code: 'TECHNOLOGY', name: 'Technology', category: 'Learning & Technology', displayOrder: 31 },
  { code: 'READING', name: 'Reading', category: 'Learning & Technology', displayOrder: 32 },
  { code: 'ENTREPRENEURSHIP', name: 'Entrepreneurship', category: 'Learning & Technology', displayOrder: 33 },
  { code: 'SCIENCE', name: 'Science', category: 'Learning & Technology', displayOrder: 34 },
  { code: 'LEARNING_LANGUAGES', name: 'Learning Languages', category: 'Learning & Technology', displayOrder: 35 },
  { code: 'NATURE', name: 'Nature', category: 'Nature & Wellness', displayOrder: 36 },
  { code: 'MEDITATION', name: 'Meditation', category: 'Nature & Wellness', displayOrder: 37 },
  { code: 'PERSONAL_GROWTH', name: 'Personal Growth', category: 'Nature & Wellness', displayOrder: 38 },
  { code: 'BEACH_LIFE', name: 'Beach Life', category: 'Nature & Wellness', displayOrder: 39 },
  { code: 'GARDENING', name: 'Gardening', category: 'Nature & Wellness', displayOrder: 40 }
] as const;

const PASSWORD_HASH = '$argon2id$v=19$m=65536,t=3,p=4$integration-test-hash';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function queryInterface(): QueryInterface {
  return sequelize.getQueryInterface();
}

function catalogFields(row: {
  code: string;
  name: string;
  category: string | null;
  displayOrder: number;
  isActive: boolean;
}) {
  return {
    code: row.code,
    name: row.name,
    category: row.category,
    displayOrder: row.displayOrder,
    isActive: row.isActive
  };
}

async function interestRows() {
  const rows = await Interest.findAll({ order: [['displayOrder', 'ASC'], ['code', 'ASC']] });
  return rows.map((row) => ({
    id: row.id,
    code: row.code,
    name: row.name,
    category: row.category,
    displayOrder: row.displayOrder,
    isActive: row.isActive
  }));
}

beforeEach(() => {
  resetMemoryRedis();
});

describe('interest catalog seeder', () => {
  it('seeds the approved 40 interests with exact codes, names, categories, and display order', async () => {
    expect(await Interest.count()).toBe(0);

    await interestCatalogSeeder.up(queryInterface());

    const rows = await interestRows();
    expect(rows).toHaveLength(40);
    expect(rows.map((row) => catalogFields(row))).toEqual(
      INTEREST_SEED.map((interest) => ({
        code: interest.code,
        name: interest.name,
        category: interest.category,
        displayOrder: interest.displayOrder,
        isActive: true
      }))
    );
    for (const row of rows) {
      expect(row.id).toMatch(UUID_PATTERN);
    }
  });

  it('is idempotent and does not create duplicate rows', async () => {
    await interestCatalogSeeder.up(queryInterface());
    const first = await interestRows();

    await interestCatalogSeeder.up(queryInterface());
    await interestCatalogSeeder.up(queryInterface());

    const second = await interestRows();
    expect(second).toHaveLength(40);
    expect(second.map((row) => row.id)).toEqual(first.map((row) => row.id));
    expect(second.map((row) => catalogFields(row))).toEqual(first.map((row) => catalogFields(row)));
    expect(await Interest.count()).toBe(40);
  });

  it('restores product-owned fields on conflict while preserving UUIDs', async () => {
    await interestCatalogSeeder.up(queryInterface());
    const before = await Interest.findOne({ where: { code: 'HIKING' } });
    expect(before).not.toBeNull();

    await Interest.update(
      {
        name: 'Drifted Name',
        category: 'Drifted Category',
        displayOrder: 999
      },
      { where: { code: 'HIKING' } }
    );

    await interestCatalogSeeder.up(queryInterface());

    const after = await Interest.findOne({ where: { code: 'HIKING' } });
    expect(after).not.toBeNull();
    expect(after!.id).toBe(before!.id);
    expect(after!.name).toBe('Hiking');
    expect(after!.category).toBe('Travel & Adventure');
    expect(after!.displayOrder).toBe(4);
    expect(await Interest.count()).toBe(40);
  });

  it('preserves administrator deactivation on reseeding', async () => {
    await interestCatalogSeeder.up(queryInterface());

    await Interest.update({ isActive: false }, { where: { code: 'ANIME' } });
    const deactivatedBefore = await Interest.findOne({ where: { code: 'ANIME' } });
    expect(deactivatedBefore?.isActive).toBe(false);

    await interestCatalogSeeder.up(queryInterface());

    const deactivatedAfter = await Interest.findOne({ where: { code: 'ANIME' } });
    expect(deactivatedAfter?.isActive).toBe(false);
    expect(deactivatedAfter?.id).toBe(deactivatedBefore!.id);
    expect(deactivatedAfter?.name).toBe('Anime');
    expect(deactivatedAfter?.category).toBe('Entertainment');
    expect(deactivatedAfter?.displayOrder).toBe(15);

    const activeCount = await Interest.count({ where: { isActive: true } });
    expect(activeCount).toBe(39);
    expect(await Interest.count()).toBe(40);
  });

  it('does not modify existing user_interests relationships', async () => {
    await interestCatalogSeeder.up(queryInterface());
    const hiking = await Interest.findOne({ where: { code: 'HIKING' } });
    expect(hiking).not.toBeNull();

    const user = await createUser({
      email: `interest-catalog-${Date.now()}@example.com`,
      phone: null,
      passwordHash: PASSWORD_HASH,
      role: 'USER',
      status: 'UNVERIFIED',
      emailVerified: false,
      phoneVerified: false
    });

    const createdAt = new Date();
    await UserInterest.create({
      userId: user.id,
      interestId: hiking!.id,
      createdAt
    });

    const linkBefore = await UserInterest.findOne({ where: { userId: user.id } });
    expect(linkBefore).not.toBeNull();

    await interestCatalogSeeder.up(queryInterface());

    const links = await UserInterest.findAll({ where: { userId: user.id } });
    expect(links).toHaveLength(1);
    expect(links[0].id).toBe(linkBefore!.id);
    expect(links[0].userId).toBe(user.id);
    expect(links[0].interestId).toBe(hiking!.id);
    expect(await Interest.count()).toBe(40);
  });

  it('exposes only active seeded interests through GET /api/v1/interests in display order', async () => {
    await interestCatalogSeeder.up(queryInterface());
    await Interest.update({ isActive: false }, { where: { code: 'ANIME' } });

    const response = await request(app).get('/api/v1/interests');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.message).toBe('Interests retrieved successfully');
    expect(response.body.data).toHaveLength(39);
    expect(response.body.data.map((item: { code: string }) => item.code)).toEqual(
      INTEREST_SEED.filter((interest) => interest.code !== 'ANIME').map((interest) => interest.code)
    );
    for (const item of response.body.data) {
      expect(Object.keys(item).sort()).toEqual(['category', 'code', 'id', 'name']);
      expect(item.id).toMatch(UUID_PATTERN);
    }
    expect(response.body.data.find((item: { code: string }) => item.code === 'ANIME')).toBeUndefined();
  });

  it('down is a no-op that leaves catalog rows and user relationships unchanged', async () => {
    await interestCatalogSeeder.up(queryInterface());
    await Interest.update({ isActive: false }, { where: { code: 'MUSIC' } });

    const hiking = await Interest.findOne({ where: { code: 'HIKING' } });
    const user = await createUser({
      email: `interest-catalog-down-${Date.now()}@example.com`,
      phone: null,
      passwordHash: PASSWORD_HASH,
      role: 'USER',
      status: 'UNVERIFIED',
      emailVerified: false,
      phoneVerified: false
    });
    await UserInterest.create({
      userId: user.id,
      interestId: hiking!.id,
      createdAt: new Date()
    });

    const beforeRows = await interestRows();
    const beforeLinks = await UserInterest.findAll({ where: { userId: user.id } });

    await interestCatalogSeeder.down(queryInterface());

    const afterRows = await interestRows();
    const afterLinks = await UserInterest.findAll({ where: { userId: user.id } });

    expect(afterRows.map((row) => ({ id: row.id, ...catalogFields(row) }))).toEqual(
      beforeRows.map((row) => ({ id: row.id, ...catalogFields(row) }))
    );
    expect(afterLinks.map((link) => ({ id: link.id, userId: link.userId, interestId: link.interestId }))).toEqual(
      beforeLinks.map((link) => ({ id: link.id, userId: link.userId, interestId: link.interestId }))
    );
    expect(await Interest.count()).toBe(40);
    expect(await Interest.count({ where: { code: 'MUSIC', isActive: false } })).toBe(1);
  });
});
