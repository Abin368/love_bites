import { QueryTypes } from 'sequelize';
import { sequelize } from '../../config/database';
import type { ViewerDiscoveryContext } from './discovery.types';

export interface DiscoveryCandidateRow {
  userId: string;
  firstName: string;
  age: number | string;
  genderId: string;
  genderCode: string;
  genderName: string;
  bio: string | null;
  occupation: string | null;
  education: string | null;
  city: string | null;
  distanceKm: number | string;
}

interface ViewerDiscoveryContextRow {
  isProfileComplete: boolean;
  hasLocation: boolean;
  hasDatingPreferences: boolean;
}

const NEXT_CANDIDATE_SQL = `
SELECT
  p.user_id AS "userId",
  p.first_name AS "firstName",
  CAST(EXTRACT(YEAR FROM AGE(p.date_of_birth)) AS int) AS "age",
  g.id AS "genderId",
  g.code AS "genderCode",
  g.name AS "genderName",
  p.bio AS "bio",
  p.occupation AS "occupation",
  p.education AS "education",
  p.city AS "city",
  ROUND(CAST(ST_Distance(p.location, v.location) / 1000.0 AS numeric), 1) AS "distanceKm"
FROM profiles p
INNER JOIN users u ON u.id = p.user_id
INNER JOIN dating_preferences dp_cand ON dp_cand.user_id = p.user_id
INNER JOIN genders g ON g.id = p.gender_id
INNER JOIN profiles v ON v.user_id = CAST(:viewerId AS uuid)
INNER JOIN dating_preferences dp_view ON dp_view.user_id = v.user_id
WHERE p.user_id <> CAST(:viewerId AS uuid)
  AND u.status = 'ACTIVE'
  AND u.deleted_at IS NULL
  AND p.is_profile_complete = TRUE
  AND p.location IS NOT NULL
  AND v.location IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM profile_photos ph
    WHERE ph.user_id = p.user_id
      AND ph.is_primary = TRUE
      AND ph.deleted_at IS NULL
  )
  AND ST_DWithin(p.location, v.location, dp_view.max_distance_km * 1000)
  AND ST_DWithin(p.location, v.location, dp_cand.max_distance_km * 1000)
  AND EXTRACT(YEAR FROM AGE(p.date_of_birth)) BETWEEN dp_view.min_age AND dp_view.max_age
  AND EXTRACT(YEAR FROM AGE(v.date_of_birth)) BETWEEN dp_cand.min_age AND dp_cand.max_age
  AND EXISTS (
    SELECT 1
    FROM user_dating_preference_genders pref
    WHERE pref.user_id = CAST(:viewerId AS uuid)
      AND pref.gender_id = p.gender_id
  )
  AND EXISTS (
    SELECT 1
    FROM user_dating_preference_genders pref
    WHERE pref.user_id = p.user_id
      AND pref.gender_id = v.gender_id
  )
  AND EXISTS (
    SELECT 1
    FROM user_relationship_intentions uri
    INNER JOIN user_dating_preference_intentions udpi
      ON udpi.relationship_intention_id = uri.relationship_intention_id
    WHERE uri.user_id = p.user_id
      AND udpi.user_id = CAST(:viewerId AS uuid)
  )
  AND EXISTS (
    SELECT 1
    FROM user_relationship_intentions uri
    INNER JOIN user_dating_preference_intentions udpi
      ON udpi.relationship_intention_id = uri.relationship_intention_id
    WHERE uri.user_id = CAST(:viewerId AS uuid)
      AND udpi.user_id = p.user_id
  )
  AND NOT EXISTS (
    SELECT 1
    FROM likes l
    WHERE l.from_user_id = CAST(:viewerId AS uuid)
      AND l.to_user_id = p.user_id
      AND l.is_undone = FALSE
  )
  AND NOT EXISTS (
    SELECT 1
    FROM matches m
    WHERE m.status = 'ACTIVE'
      AND m.user_one_id = LEAST(CAST(:viewerId AS uuid), p.user_id)
      AND m.user_two_id = GREATEST(CAST(:viewerId AS uuid), p.user_id)
  )
  AND NOT EXISTS (
    SELECT 1
    FROM blocks b
    WHERE (b.blocker_id = CAST(:viewerId AS uuid) AND b.blocked_id = p.user_id)
       OR (b.blocker_id = p.user_id AND b.blocked_id = CAST(:viewerId AS uuid))
  )
ORDER BY COALESCE((
  SELECT MAX(bs.multiplier)
  FROM boost_sessions bs
  WHERE bs.user_id = p.user_id
    AND bs.is_active = TRUE
    AND bs.expires_at > CURRENT_TIMESTAMP
), 1.0) DESC, p.created_at DESC
LIMIT 1
`;

export async function findViewerDiscoveryContext(viewerId: string): Promise<ViewerDiscoveryContext | null> {
  const rows = await sequelize.query<ViewerDiscoveryContextRow>(
    `SELECT
       p.is_profile_complete AS "isProfileComplete",
       (p.location IS NOT NULL) AS "hasLocation",
       EXISTS (
         SELECT 1 FROM dating_preferences dp WHERE dp.user_id = p.user_id
       ) AS "hasDatingPreferences"
     FROM profiles p
     WHERE p.user_id = CAST(:viewerId AS uuid)
     LIMIT 1`,
    {
      replacements: { viewerId },
      type: QueryTypes.SELECT
    }
  );

  return rows[0] ?? null;
}

export async function findNextDiscoveryCandidate(viewerId: string): Promise<DiscoveryCandidateRow | null> {
  const rows = await sequelize.query<DiscoveryCandidateRow>(NEXT_CANDIDATE_SQL, {
    replacements: { viewerId },
    type: QueryTypes.SELECT
  });

  return rows[0] ?? null;
}
