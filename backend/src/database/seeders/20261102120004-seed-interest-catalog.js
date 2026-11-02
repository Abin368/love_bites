'use strict';

/**
 * Approved production interest catalog (40 interests across 8 categories).
 *
 * Upsert policy:
 * - Identify rows by stable `code`.
 * - Insert missing rows with `is_active = true` and `gen_random_uuid()`.
 * - On conflict, refresh product-owned fields only: name, category, display_order, updated_at.
 * - Never overwrite `is_active` on conflict (preserves administrator deactivations).
 * - Never delete catalog rows or touch `user_interests`.
 */

const INTERESTS = [
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
];

function indexedReplacements(rows, fields) {
  return rows.reduce((values, row, index) => {
    for (const field of fields) {
      values[`${field}${index}`] = row[field];
    }
    return values;
  }, {});
}

function insertSql() {
  const rows = INTERESTS.map(
    (_interest, index) =>
      `(gen_random_uuid(), :code${index}, :name${index}, :category${index}, TRUE, :displayOrder${index}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
  ).join(',\n          ');

  return `
    INSERT INTO interests (
      id, code, name, category, is_active, display_order, created_at, updated_at
    )
    VALUES
      ${rows}
    ON CONFLICT (code) DO UPDATE
    SET
      name = EXCLUDED.name,
      category = EXCLUDED.category,
      display_order = EXCLUDED.display_order,
      updated_at = CURRENT_TIMESTAMP
  `;
}

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(insertSql(), {
        replacements: indexedReplacements(INTERESTS, ['code', 'name', 'category', 'displayOrder']),
        transaction
      });
    });
  },

  /**
   * Conservative no-op.
   *
   * Catalog rows may have been edited by administrators or referenced by
   * `user_interests`, so automatic rollback that deletes or deactivates interests
   * is unsafe. This `down` intentionally leaves all interest data unchanged.
   */
  async down() {
    // No-op: do not delete, deactivate, or otherwise mutate interest catalog rows.
  }
};
