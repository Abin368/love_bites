# Love Bite - Database Design Specification

> **Document Path:** `backend/docs/02-database-design.md`  
> **Target Schema Engine:** PostgreSQL 16+ with PostGIS 3.4+ Extension  
> **ORM Layer:** Sequelize ORM (TypeScript)  
> **Status:** Approved Source of Truth for Database Architecture

---

## 1. Overview

This document serves as the authoritative specification and definitive source of truth for the **Love Bite** relational and spatial database design. 

The primary objective of this schema is to deliver a highly reliable, normalized, performant, and secure data foundation for a modern dating platform. The design is built from the ground up to support:
* Strict privacy safeguards (such as server-side location coordinate obfuscation and liker identity protection).
* Complex spatial discovery queries using PostGIS geography types and Generalized Search Tree (GiST) spatial indexing.
* Concurrency-safe mutual matching mechanics and race-condition-free interaction recording.
* Centralized monetization, multi-tier subscription lifecycles, and atomic usage quota tracking.
* Dynamic, administrator-managed configuration for profile attributes, dating preferences, plans, and feature limits.

---

## 2. Database Technology

| Layer / Technology | Specification | Rationale & Architectural Purpose |
| :--- | :--- | :--- |
| **Database Engine** | **PostgreSQL (v16+)** | Primary persistent relational database supporting ACID transactions, JSONB, row-level locking, partial unique indexes, and advanced check constraints. |
| **Spatial Engine** | **PostGIS (v3.4+)** | Native spatial extension providing geodesic calculation algorithms (`ST_DWithin`, `ST_Distance`) over spherical coordinates (`geography(Point, 4326)`), indexed by GiST. |
| **Object-Relational Mapping** | **Sequelize ORM (v6+)** | Enterprise TypeScript/JavaScript ORM managing connection pooling, declarative model associations, parameterized queries, and database migration lifecycles. |
| **Primary Keys** | **UUIDv4 (`UUID` / `gen_random_uuid()`)** | Cryptographically secure, non-enumerable, globally unique primary keys preventing enumeration attacks across public APIs and distributed nodes. |
| **Ephemeral / Cache Tier** | **Redis (v7+)** *(Non-Primary)* | High-throughput in-memory cache and pub/sub broker for real-time WebSocket distribution and sliding-window rate limiters. *Redis is never used as the persistent database.* |
| **Blob / Object Storage** | **AWS S3** *(Private)* | Secure cloud object storage for binary media (images, audio, video). PostgreSQL stores only verified object keys and metadata; binaries are never stored in the database. |

---

## 3. Database Design Principles

1. **Strict Referential Integrity:** Foreign key constraints are enforced across all relational boundaries with explicit `ON DELETE` and `ON UPDATE` actions. Dangling records or orphan state transitions are strictly prohibited.
2. **PostgreSQL-Enforced Domain Integrity:** Business rules invariant to external state (e.g., coordinate bounds, age thresholds, self-interactions, canonical ID ordering) are enforced directly in the database engine using `CHECK` constraints and partial unique indexes.
3. **Appropriate Normalization:** Core domain entities (users, profiles, preferences, subscriptions, payments) are normalized to 3NF/BCNF to prevent update anomalies. Dynamic configuration entities (genders, interests, relationship intentions) use dedicated reference tables.
4. **Optimized for PostGIS Spatial Discovery:** Location coordinates are stored as native PostGIS spherical points (`geography(Point, 4326)`). Proximity evaluations are executed within the database engine using spatial indexing, eliminating the need to transfer large datasets to the application tier.
5. **No Blind Cascades:** Critical operational, financial, moderation, and communication records (`payments`, `reports`, `messages`, `matches`) are protected against accidental cascading deletions.
6. **Soft Deletion for Auditability:** User accounts, profile media, and messages support soft deletion (`deleted_at`) to comply with safety audits, dispute resolutions, and legal data-retention requirements.
7. **Monetization via Entitlements (Not User Roles):** Premium status is modeled as an active subscription entitlement state rather than a static user role or boolean flag on the `users` table.

---

## 4. Entity Relationship Overview

```
                                      ┌───────────────┐
                                      │     users     │
                                      └───┬───┬───┬───┘
                                          │   │   │
        ┌─────────────────────────────────┘   │   └──────────────────────────────────┐
        │                                     │                                      │
        ▼ 1:1                                 ▼ 1:1                                  ▼ 1:N
┌───────────────┐                     ┌───────────────┐                     ┌─────────────────┐
│   profiles    │                     │dating_pref-   │                     │ profile_photos  │
│               │                     │erences        │                     └─────────────────┘
└───┬───────┬───┘                     └───┬───────┬───┘
    │       │                             │       │
    │       ▼ 1:N                         │       ▼ 1:N
    │   ┌───────────────────────────┐     │   ┌──────────────────────────────────────────┐
    │   │      user_interests       │     │   │     user_dating_preference_genders       │
    │   └─────────────┬─────────────┘     │   └────────────────────┬─────────────────────┘
    │                 │                   │                        │
    │                 ▼ N:1               │                        ▼ N:1
    │           ┌───────────┐             │                  ┌───────────┐
    │           │ interests │             │                  │  genders  │
    │           └───────────┘             │                  └───────────┘
    │                                     ▼ 1:N
    ▼ 1:N                             ┌──────────────────────────────────────────┐
┌───────────────────────────┐         │   user_dating_preference_intentions      │
│user_relationship_         │         └────────────────────┬─────────────────────┘
│intentions                 │                              │
└─────────────┬─────────────┘                              ▼ N:1
              │                               ┌───────────────────────────┐
              ▼ N:1                           │  relationship_intentions  │
        ┌───────────────────────────┐         └───────────────────────────┘
        │  relationship_intentions  │
        └───────────────────────────┘

─────────────────────────────────────────────────────────────────────────────────────────────
INTERACTION, CHAT & SAFETY DOMAIN

        ┌───────────────┐
        │     users     │
        └───┬───┬───┬───┘
            │   │   │
  ┌─────────┘   │   └─────────┐
  │             │             │
  ▼ 1:N         ▼ 1:N         ▼ 1:N
┌───────┐   ┌───────┐     ┌────────┐
│ likes │   │blocks │     │reports │
└───────┘   └───────┘     └────────┘
    │
    ▼ (Mutual Likes Trigger)
┌───────────────────────────────────────┐
│                matches                │
└───────────────────┬───────────────────┘
                    │ 1:1
                    ▼
┌───────────────────────────────────────┐
│             conversations             │
└───────────────────┬───────────────────┘
                    │ 1:N
                    ▼
┌───────────────────────────────────────┐
│               messages                │
└───────────────────────────────────────┘

─────────────────────────────────────────────────────────────────────────────────────────────
MONETIZATION, SUBSCRIPTIONS & ENTITLEMENTS DOMAIN

┌───────────┐ 1:N ┌────────────────┐ N:1 ┌────────────┐
│   plans   ├───► │ plan_features  │◄───┤  features  │
└─────┬─────┘     └────────────────┘     └────────────┘
      │ 1:N
      ├───────────►┌────────────────┐
      │            │  usage_limits  │
      │            └────────────────┘
      │ 1:N
      ▼
┌───────────────┐ 1:N ┌───────────────┐
│ subscriptions ├───► │   payments    │
└───────┬───────┘     └───────────────┘
        │ N:1
        ▼
  ┌───────────┐ 1:N ┌─────────────────┐
  │   users   ├───► │  usage_records  │
  └─────┬─────┘     └─────────────────┘
        │ 1:N
        ▼
  ┌───────────┐ 1:N ┌─────────────────┐
  │user_credit├───► │credit_trans-    │
  │_balances  │     │actions          │
  └───────────┘     └─────────────────┘
```

---

## 5. Core Tables

### 5.1 `users`

#### Purpose
Stores primary account credentials, administrative roles, global account status, verification flags, and soft-deletion markers. It serves as the root identity record for all user interactions.

#### Columns
| Column | Type | Nullable | Default | Description |
| :--- | :--- | :--- | :--- | :--- |
| `id` | `UUID` | `NO` | `gen_random_uuid()` | Primary key. |
| `email` | `VARCHAR(255)` | `YES` | `NULL` | Normalized lowercase email address. Unique among active accounts. |
| `phone` | `VARCHAR(32)` | `YES` | `NULL` | E.164 formatted telephone number. Unique among active accounts. |
| `password_hash` | `VARCHAR(255)` | `NO` | — | Argon2id cryptographic password hash. |
| `role` | `VARCHAR(20)` | `NO` | `'USER'` | System role: `'USER'` or `'ADMIN'`. |
| `status` | `VARCHAR(20)` | `NO` | `'UNVERIFIED'` | Account state: `'UNVERIFIED'`, `'ACTIVE'`, `'SUSPENDED'`, `'BANNED'`, `'DELETED'`. |
| `email_verified` | `BOOLEAN` | `NO` | `FALSE` | Email ownership verification flag. |
| `phone_verified` | `BOOLEAN` | `NO` | `FALSE` | Phone OTP ownership verification flag. |
| `last_active_at` | `TIMESTAMPTZ` | `YES` | `CURRENT_TIMESTAMP` | Timestamp of last API interaction. |
| `created_at` | `TIMESTAMPTZ` | `NO` | `CURRENT_TIMESTAMP` | Account creation timestamp. |
| `updated_at` | `TIMESTAMPTZ` | `NO` | `CURRENT_TIMESTAMP` | Timestamp of last row modification. |
| `deleted_at` | `TIMESTAMPTZ` | `YES` | `NULL` | Soft-deletion timestamp. |

#### Primary Key
* `PRIMARY KEY (id)`

#### Constraints
* `CONSTRAINT chk_users_identifier_present CHECK (email IS NOT NULL OR phone IS NOT NULL)`
* `CONSTRAINT chk_users_role CHECK (role IN ('USER', 'ADMIN'))`
* `CONSTRAINT chk_users_status CHECK (status IN ('UNVERIFIED', 'ACTIVE', 'SUSPENDED', 'BANNED', 'DELETED'))`

#### Indexes
* `CREATE UNIQUE INDEX uq_users_email_active ON users (email) WHERE email IS NOT NULL AND deleted_at IS NULL;`  
  *Supports instant login lookup and ensures email uniqueness across active/non-deleted accounts.*
* `CREATE UNIQUE INDEX uq_users_phone_active ON users (phone) WHERE phone IS NOT NULL AND deleted_at IS NULL;`  
  *Supports instant phone login lookup and ensures phone uniqueness across active/non-deleted accounts.*
* `CREATE INDEX idx_users_status ON users (status) WHERE deleted_at IS NULL;`  
  *Accelerates admin dashboard filtering by account status.*

#### Relationships
* `1:1` with `profiles` (`profiles.user_id` $\rightarrow$ `users.id`)
* `1:1` with `dating_preferences` (`dating_preferences.user_id` $\rightarrow$ `users.id`)
* `1:N` with `profile_photos` (`profile_photos.user_id` $\rightarrow$ `users.id`)
* `1:N` with `auth_refresh_tokens` (`auth_refresh_tokens.user_id` $\rightarrow$ `users.id`)

---

### 5.2 `auth_refresh_tokens`

#### Purpose
Maintains persisted session records for rotating refresh tokens. Enables immediate revocation upon logout, token compromise, password change, or administrative account suspension.

#### Columns
| Column | Type | Nullable | Default | Description |
| :--- | :--- | :--- | :--- | :--- |
| `id` | `UUID` | `NO` | `gen_random_uuid()` | Primary key. |
| `user_id` | `UUID` | `NO` | — | Foreign key referencing `users.id`. |
| `token_hash` | `VARCHAR(255)` | `NO` | — | SHA-256 hash of the issued refresh token JWT. |
| `device_info` | `VARCHAR(255)` | `YES` | `NULL` | Client User-Agent or device descriptor. |
| `ip_address` | `VARCHAR(45)` | `YES` | `NULL` | Client IPv4 or IPv6 address. |
| `expires_at` | `TIMESTAMPTZ` | `NO` | — | Refresh token expiration timestamp. |
| `revoked_at` | `TIMESTAMPTZ` | `YES` | `NULL` | Timestamp when the token was explicitly revoked. |
| `replaced_by_hash`| `VARCHAR(255)` | `YES` | `NULL` | Hash of the successor token issued during rotation. |
| `created_at` | `TIMESTAMPTZ` | `NO` | `CURRENT_TIMESTAMP` | Issuance timestamp. |
| `updated_at` | `TIMESTAMPTZ` | `NO` | `CURRENT_TIMESTAMP` | Last modification timestamp. |

#### Primary Key
* `PRIMARY KEY (id)`

#### Foreign Keys
* `CONSTRAINT fk_auth_refresh_tokens_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE`

#### Indexes
* `CREATE UNIQUE INDEX uq_auth_refresh_tokens_hash ON auth_refresh_tokens (token_hash);`  
  *Ensures fast lookup and prevents token duplication during rotation checks.*
* `CREATE INDEX idx_auth_refresh_tokens_user_active ON auth_refresh_tokens (user_id) WHERE revoked_at IS NULL;`  
  *Supports mass session invalidation upon user password reset or admin ban.*

---

### 5.3 `genders`

#### Purpose
Dynamic, administrator-managed reference table for gender options. Prevents hardcoded enums and accommodates flexible, configurable gender taxonomies.

#### Columns
| Column | Type | Nullable | Default | Description |
| :--- | :--- | :--- | :--- | :--- |
| `id` | `UUID` | `NO` | `gen_random_uuid()` | Primary key. |
| `code` | `VARCHAR(50)` | `NO` | — | Canonical machine-readable code (e.g., `'MAN'`, `'WOMAN'`, `'NON_BINARY'`). |
| `name` | `VARCHAR(100)` | `NO` | — | Localized display label (e.g., `'Man'`, `'Woman'`). |
| `is_active` | `BOOLEAN` | `NO` | `TRUE` | Whether the option is selectable by new/editing users. |
| `display_order` | `SMALLINT` | `NO` | `0` | UI sort order. |
| `created_at` | `TIMESTAMPTZ` | `NO` | `CURRENT_TIMESTAMP` | Creation timestamp. |
| `updated_at` | `TIMESTAMPTZ` | `NO` | `CURRENT_TIMESTAMP` | Modification timestamp. |

#### Primary Key
* `PRIMARY KEY (id)`

#### Constraints
* `CONSTRAINT uq_genders_code UNIQUE (code)`

#### Indexes
* `CREATE INDEX idx_genders_active_order ON genders (is_active, display_order);`  
  *Accelerates onboarding metadata API queries.*

---

### 5.4 `profiles`

#### Purpose
Stores user profile information, bio, demographic details, location coordinates, and profile completion status. Maintains a strict 1:1 relationship with `users`.

#### Columns
| Column | Type | Nullable | Default | Description |
| :--- | :--- | :--- | :--- | :--- |
| `id` | `UUID` | `NO` | `gen_random_uuid()` | Primary key. |
| `user_id` | `UUID` | `NO` | — | Foreign key referencing `users.id`. Enforces 1:1 relationship. |
| `first_name` | `VARCHAR(100)` | `NO` | — | User's displayed first name. |
| `date_of_birth` | `DATE` | `NO` | — | Date of birth. Mandatory age constraint ($\ge 18$) enforced in DB. |
| `gender_id` | `UUID` | `NO` | — | Foreign key referencing `genders.id`. |
| `bio` | `TEXT` | `YES` | `NULL` | Personal introduction text (max 500 chars). |
| `occupation` | `VARCHAR(100)` | `YES` | `NULL` | Occupation / Job title. |
| `education` | `VARCHAR(100)` | `YES` | `NULL` | Highest education level or institution. |
| `city` | `VARCHAR(100)` | `YES` | `NULL` | Display city name. Nullable during onboarding. Profile completion still requires a city. |
| `location` | `geography(Point, 4326)` | `YES` | `NULL` | PostGIS spatial point `(longitude, latitude)` in WGS84 coordinates. Nullable during onboarding. Profile completion still requires a location. |
| `is_profile_complete`| `BOOLEAN` | `NO` | `FALSE` | Server-evaluated flag indicating all onboarding steps are satisfied. A partial profile with null `city` or `location` stays `FALSE`. |
| `created_at` | `TIMESTAMPTZ` | `NO` | `CURRENT_TIMESTAMP` | Creation timestamp. |
| `updated_at` | `TIMESTAMPTZ` | `NO` | `CURRENT_TIMESTAMP` | Modification timestamp. |

#### Primary Key
* `PRIMARY KEY (id)`

#### Foreign Keys
* `CONSTRAINT fk_profiles_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE`
* `CONSTRAINT fk_profiles_gender FOREIGN KEY (gender_id) REFERENCES genders(id) ON DELETE RESTRICT ON UPDATE CASCADE`

#### Constraints
* `CONSTRAINT uq_profiles_user_id UNIQUE (user_id)`
* `CONSTRAINT chk_profiles_age_18_plus CHECK (date_of_birth <= CURRENT_DATE - INTERVAL '18 years')`

#### Indexes
* `CREATE INDEX idx_profiles_location_gist ON profiles USING GIST (location);`  
  *Core spatial index accelerating `ST_DWithin` discovery queries.*
* `CREATE INDEX idx_profiles_discovery_eligibility ON profiles (is_profile_complete, gender_id, date_of_birth);`  
  *Composite index optimizing discovery candidate filtering.*

---

### 5.5 `profile_photos`

#### Purpose
Stores metadata and AWS S3 storage keys for user profile photos. No binary image data is stored in the database.

#### Columns
| Column | Type | Nullable | Default | Description |
| :--- | :--- | :--- | :--- | :--- |
| `id` | `UUID` | `NO` | `gen_random_uuid()` | Primary key. |
| `user_id` | `UUID` | `NO` | — | Foreign key referencing `users.id`. |
| `storage_key` | `VARCHAR(512)` | `NO` | — | S3 object key (e.g., `photos/{user_id}/{photo_id}.webp`). |
| `original_filename`| `VARCHAR(255)` | `YES` | `NULL` | Client-provided original filename. |
| `mime_type` | `VARCHAR(50)` | `NO` | — | MIME type (`'image/jpeg'`, `'image/png'`, `'image/webp'`). |
| `file_size_bytes` | `INTEGER` | `NO` | — | File size in bytes (max 10,485,760 bytes / 10MB). |
| `display_order` | `SMALLINT` | `NO` | `1` | Presentation order (1 to 5). |
| `is_primary` | `BOOLEAN` | `NO` | `FALSE` | Designates primary card image in discovery stack. |
| `created_at` | `TIMESTAMPTZ` | `NO` | `CURRENT_TIMESTAMP` | Upload timestamp. |
| `updated_at` | `TIMESTAMPTZ` | `NO` | `CURRENT_TIMESTAMP` | Modification timestamp. |
| `deleted_at` | `TIMESTAMPTZ` | `YES` | `NULL` | Soft deletion timestamp for S3 cleanup queueing. |

#### Primary Key
* `PRIMARY KEY (id)`

#### Foreign Keys
* `CONSTRAINT fk_profile_photos_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE`

#### Constraints
* `CONSTRAINT chk_profile_photos_display_order CHECK (display_order BETWEEN 1 AND 5)`
* `CONSTRAINT chk_profile_photos_file_size CHECK (file_size_bytes > 0 AND file_size_bytes <= 10485760)`

#### Indexes
* `CREATE UNIQUE INDEX uq_profile_photos_primary_per_user ON profile_photos (user_id) WHERE is_primary = TRUE AND deleted_at IS NULL;`  
  *Enforces the critical business rule that each user has exactly one active primary photo.*
* `CREATE UNIQUE INDEX uq_profile_photos_order_per_user ON profile_photos (user_id, display_order) WHERE deleted_at IS NULL;`  
  *Prevents duplicate display orders among active photos for any user.*
* `CREATE INDEX idx_profile_photos_user_active ON profile_photos (user_id, display_order) WHERE deleted_at IS NULL;`  
  *Accelerates fetching profile photo stacks.*

---

## 6. Profile Configuration & Preferences

### 6.1 `interests`

#### Purpose
Admin-managed catalog of interest tags (e.g., "Photography", "Hiking", "Anime").

#### Columns
| Column | Type | Nullable | Default | Description |
| :--- | :--- | :--- | :--- | :--- |
| `id` | `UUID` | `NO` | `gen_random_uuid()` | Primary key. |
| `code` | `VARCHAR(50)` | `NO` | — | Unique machine identifier (e.g., `'HIKING'`). |
| `name` | `VARCHAR(100)` | `NO` | — | Display label (e.g., `'Hiking & Outdoors'`). |
| `category` | `VARCHAR(50)` | `YES` | `NULL` | Optional grouping category (e.g., `'Sports'`, `'Art'`). |
| `is_active` | `BOOLEAN` | `NO` | `TRUE` | Whether available for new user selection. |
| `display_order` | `SMALLINT` | `NO` | `0` | UI presentation order. |
| `created_at` | `TIMESTAMPTZ` | `NO` | `CURRENT_TIMESTAMP` | Creation timestamp. |
| `updated_at` | `TIMESTAMPTZ` | `NO` | `CURRENT_TIMESTAMP` | Modification timestamp. |

#### Primary Key
* `PRIMARY KEY (id)`

#### Constraints
* `CONSTRAINT uq_interests_code UNIQUE (code)`

#### Indexes
* `CREATE INDEX idx_interests_active_order ON interests (is_active, display_order);`

---

### 6.2 `user_interests`

#### Purpose
Many-to-Many junction table binding users to their selected interests (onboarding requires 3 to 10 interests).

#### Columns
| Column | Type | Nullable | Default | Description |
| :--- | :--- | :--- | :--- | :--- |
| `id` | `UUID` | `NO` | `gen_random_uuid()` | Primary key. |
| `user_id` | `UUID` | `NO` | — | Foreign key referencing `users.id`. |
| `interest_id` | `UUID` | `NO` | — | Foreign key referencing `interests.id`. |
| `created_at` | `TIMESTAMPTZ` | `NO` | `CURRENT_TIMESTAMP` | Selection timestamp. |

#### Primary Key
* `PRIMARY KEY (id)`

#### Foreign Keys
* `CONSTRAINT fk_user_interests_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE`
* `CONSTRAINT fk_user_interests_interest FOREIGN KEY (interest_id) REFERENCES interests(id) ON DELETE RESTRICT ON UPDATE CASCADE`

#### Constraints
* `CONSTRAINT uq_user_interests_pair UNIQUE (user_id, interest_id)`

#### Indexes
* `CREATE INDEX idx_user_interests_interest_lookup ON user_interests (interest_id, user_id);`  
  *Optimizes discovery overlap and interest-based similarity filtering.*

---

### 6.3 `relationship_intentions`

#### Purpose
Admin-managed catalog of dating intentions (e.g., "Long-term relationship", "Something casual").

#### Columns
| Column | Type | Nullable | Default | Description |
| :--- | :--- | :--- | :--- | :--- |
| `id` | `UUID` | `NO` | `gen_random_uuid()` | Primary key. |
| `code` | `VARCHAR(50)` | `NO` | — | Machine code (e.g., `'LONG_TERM_RELATIONSHIP'`). |
| `name` | `VARCHAR(100)` | `NO` | — | Display label. |
| `description` | `VARCHAR(255)` | `YES` | `NULL` | Brief contextual explanation. |
| `is_active` | `BOOLEAN` | `NO` | `TRUE` | Whether available for selection. |
| `display_order` | `SMALLINT` | `NO` | `0` | UI sort order. |
| `created_at` | `TIMESTAMPTZ` | `NO` | `CURRENT_TIMESTAMP` | Creation timestamp. |
| `updated_at` | `TIMESTAMPTZ` | `NO` | `CURRENT_TIMESTAMP` | Modification timestamp. |

#### Primary Key
* `PRIMARY KEY (id)`

#### Constraints
* `CONSTRAINT uq_relationship_intentions_code UNIQUE (code)`

---

### 6.4 `user_relationship_intentions`

#### Purpose
Many-to-Many junction table recording the relationship intentions a user embodies on their own profile.

#### Columns
| Column | Type | Nullable | Default | Description |
| :--- | :--- | :--- | :--- | :--- |
| `id` | `UUID` | `NO` | `gen_random_uuid()` | Primary key. |
| `user_id` | `UUID` | `NO` | — | Foreign key referencing `users.id`. |
| `relationship_intention_id`| `UUID` | `NO` | — | Foreign key referencing `relationship_intentions.id`. |
| `created_at` | `TIMESTAMPTZ` | `NO` | `CURRENT_TIMESTAMP` | Selection timestamp. |

#### Primary Key
* `PRIMARY KEY (id)`

#### Foreign Keys
* `CONSTRAINT fk_user_intentions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE`
* `CONSTRAINT fk_user_intentions_intention FOREIGN KEY (relationship_intention_id) REFERENCES relationship_intentions(id) ON DELETE RESTRICT ON UPDATE CASCADE`

#### Constraints
* `CONSTRAINT uq_user_intentions_pair UNIQUE (user_id, relationship_intention_id)`

---

### 6.5 `dating_preferences`

#### Purpose
Stores discovery filtering parameters configured by the user, including target age range and maximum geographic discovery radius. Maintains a strict 1:1 relationship with `users`.

#### Columns
| Column | Type | Nullable | Default | Description |
| :--- | :--- | :--- | :--- | :--- |
| `id` | `UUID` | `NO` | `gen_random_uuid()` | Primary key. |
| `user_id` | `UUID` | `NO` | — | Foreign key referencing `users.id`. Enforces 1:1 relationship. |
| `min_age` | `SMALLINT` | `NO` | `18` | Minimum candidate age preference (minimum 18). |
| `max_age` | `SMALLINT` | `NO` | `100` | Maximum candidate age preference (maximum 100). |
| `max_distance_km` | `INTEGER` | `NO` | `50` | Maximum discovery distance in kilometers (1–500 km). |
| `created_at` | `TIMESTAMPTZ` | `NO` | `CURRENT_TIMESTAMP` | Creation timestamp. |
| `updated_at` | `TIMESTAMPTZ` | `NO` | `CURRENT_TIMESTAMP` | Modification timestamp. |

#### Primary Key
* `PRIMARY KEY (id)`

#### Foreign Keys
* `CONSTRAINT fk_dating_preferences_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE`

#### Constraints
* `CONSTRAINT uq_dating_preferences_user UNIQUE (user_id)`
* `CONSTRAINT chk_dating_preferences_age_range CHECK (min_age >= 18 AND max_age >= min_age AND max_age <= 100)`
* `CONSTRAINT chk_dating_preferences_distance CHECK (max_distance_km >= 1 AND max_distance_km <= 500)`

---

### 6.6 Interested-In Model

To achieve maximum query performance, referential integrity, and complete configurability, candidate gender preferences and candidate relationship intention preferences are stored in normalized junction tables rather than unindexed PostgreSQL arrays or hardcoded enums.

#### 6.6.1 `user_dating_preference_genders`

##### Purpose
Maps the genders a user is interested in discovering (e.g., Men, Women, Non-Binary, or any combination). Selecting "Everyone" is represented by linking all active gender records.

##### Columns
| Column | Type | Nullable | Default | Description |
| :--- | :--- | :--- | :--- | :--- |
| `id` | `UUID` | `NO` | `gen_random_uuid()` | Primary key. |
| `user_id` | `UUID` | `NO` | — | Foreign key referencing `users.id`. |
| `gender_id` | `UUID` | `NO` | — | Foreign key referencing `genders.id`. |
| `created_at` | `TIMESTAMPTZ` | `NO` | `CURRENT_TIMESTAMP` | Creation timestamp. |

##### Constraints & Indexes
* `PRIMARY KEY (id)`
* `CONSTRAINT fk_pref_genders_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE`
* `CONSTRAINT fk_pref_genders_gender FOREIGN KEY (gender_id) REFERENCES genders(id) ON DELETE RESTRICT ON UPDATE CASCADE`
* `CONSTRAINT uq_pref_genders_pair UNIQUE (user_id, gender_id)`
* `CREATE INDEX idx_pref_genders_lookup ON user_dating_preference_genders (gender_id, user_id);`

#### 6.6.2 `user_dating_preference_intentions`

##### Purpose
Maps the relationship intentions a user seeks in potential matches.

##### Columns
| Column | Type | Nullable | Default | Description |
| :--- | :--- | :--- | :--- | :--- |
| `id` | `UUID` | `NO` | `gen_random_uuid()` | Primary key. |
| `user_id` | `UUID` | `NO` | — | Foreign key referencing `users.id`. |
| `relationship_intention_id`| `UUID` | `NO` | — | Foreign key referencing `relationship_intentions.id`. |
| `created_at` | `TIMESTAMPTZ` | `NO` | `CURRENT_TIMESTAMP` | Creation timestamp. |

##### Constraints & Indexes
* `PRIMARY KEY (id)`
* `CONSTRAINT fk_pref_intentions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE`
* `CONSTRAINT fk_pref_intentions_intention FOREIGN KEY (relationship_intention_id) REFERENCES relationship_intentions(id) ON DELETE RESTRICT ON UPDATE CASCADE`
* `CONSTRAINT uq_pref_intentions_pair UNIQUE (user_id, relationship_intention_id)`

---

## 7. Location & PostGIS

### 7.1 Coordinate Storage & Spatial Types
* Profile geographical locations are stored in `profiles.location` using the native PostGIS spatial type:  
  **`geography(Point, 4326)`**
* **SRID 4326 (WGS84):** Represents standard Earth ellipsoidal latitude and longitude coordinates. Points are formatted canonically as `ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)`.
* Spatial queries use a **GiST (Generalized Search Tree)** index: `idx_profiles_location_gist`.

### 7.2 PostGIS vs. Application Calculations
Computing geodesic distance on application nodes requires executing high-volume table scans, pulling thousands of coordinates into application memory, and executing CPU-intensive Haversine equations in Node.js. PostGIS shifts distance evaluations directly to PostgreSQL C-extensions, executing bounding-box pruning via GiST trees before calculating exact geodesic distances on candidate subsets.

### 7.3 Spatial Discovery Query Pattern
```sql
-- Evaluates mutual distance in a single spatial index-accelerated query
SELECT 
  p.user_id,
  p.first_name,
  p.city,
  ROUND((ST_Distance(p.location, u_prof.location) / 1000.0)::numeric, 1) AS distance_km
FROM profiles p
JOIN dating_preferences dp_candidate ON dp_candidate.user_id = p.user_id
CROSS JOIN (
  SELECT location, user_id FROM profiles WHERE user_id = :currentUserId
) u_prof
JOIN dating_preferences dp_viewer ON dp_viewer.user_id = u_prof.user_id
WHERE p.user_id != :currentUserId
  -- Candidate is within viewer's configured radius
  AND ST_DWithin(p.location, u_prof.location, dp_viewer.max_distance_km * 1000)
  -- Viewer is within candidate's configured radius (Mutual Radius Rule)
  AND ST_DWithin(u_prof.location, p.location, dp_candidate.max_distance_km * 1000);
```

### 7.4 Location Privacy Mandate
* **The API layer must NEVER return `profiles.location` coordinates (latitude/longitude) in any client response payload.**
* Client responses include `profiles.city` and numeric `distanceKm`, rounded to one decimal place (for example, `4.2`). Latitude and longitude are not returned.

---

## 8. Discovery Engine Database Logic

The Discovery Engine returns candidate profile cards one at a time. The database query applies strict eligibility criteria, safety exclusions, and mutual preference matching in a single execution plan without N+1 queries.

### 8.1 Candidate Eligibility Rules
A candidate user $B$ is eligible for viewer user $A$ if and only if all of the following database criteria evaluate to `TRUE`:

1. **Self Exclusion:** `B.id != A.id`
2. **Account Status:** `B.status = 'ACTIVE' AND B.deleted_at IS NULL`
3. **Profile Completeness:** `B_profile.is_profile_complete = TRUE`
4. **Primary Photo Requirement:** Exists at least one active primary photo for $B$ (`EXISTS(SELECT 1 FROM profile_photos WHERE user_id = B.id AND is_primary = TRUE AND deleted_at IS NULL)`).
5. **No Existing Interactions:**
   * $A$ has not passed or liked $B$: `NOT EXISTS(SELECT 1 FROM likes WHERE from_user_id = A.id AND to_user_id = B.id AND is_undone = FALSE)`
6. **No Active Matches:**
   * $A$ and $B$ are not currently in an active match: `NOT EXISTS(SELECT 1 FROM matches WHERE ((user_one_id = LEAST(A.id, B.id) AND user_two_id = GREATEST(A.id, B.id))) AND status = 'ACTIVE')`
7. **No Safety Blocks (Bidirectional):**
   * $A$ has not blocked $B$, and $B$ has not blocked $A$: `NOT EXISTS(SELECT 1 FROM blocks WHERE (blocker_id = A.id AND blocked_id = B.id) OR (blocker_id = B.id AND blocked_id = A.id))`
8. **Mutual Age Preferences:**
   * $B$'s age is between $A$'s `min_age` and `max_age`.
   * $A$'s age is between $B$'s `min_age` and `max_age`.
9. **Mutual Gender Preferences:**
   * $B$'s `gender_id` is in $A$'s `user_dating_preference_genders`.
   * $A$'s `gender_id` is in $B$'s `user_dating_preference_genders`.
10. **Mutual Relationship Intentions:**
    * Exists an overlap between $B$'s `user_relationship_intentions` and $A$'s `user_dating_preference_intentions`.
    * Exists an overlap between $A$'s `user_relationship_intentions` and $B$'s `user_dating_preference_intentions`.
11. **Mutual Distance:**
    * `ST_DWithin(A.location, B.location, A_pref.max_distance_km * 1000)`
    * `ST_DWithin(B.location, A.location, B_pref.max_distance_km * 1000)`

---

## 9. Likes & Passes

### 9.1 `likes`

#### Purpose
Stores all swipe interactions (`LIKE`, `PASS`, `SUPER_LIKE`) between users. A `PASS` action is permanent in Phase 1. When a user activates Premium Undo, the interaction's `is_undone` flag is updated to preserve audit history while removing the candidate from exclusion rules.

#### Columns
| Column | Type | Nullable | Default | Description |
| :--- | :--- | :--- | :--- | :--- |
| `id` | `UUID` | `NO` | `gen_random_uuid()` | Primary key. |
| `from_user_id` | `UUID` | `NO` | — | Foreign key of actor user referencing `users.id`. |
| `to_user_id` | `UUID` | `NO` | — | Foreign key of target user referencing `users.id`. |
| `action` | `VARCHAR(20)` | `NO` | — | Swipe action: `'LIKE'`, `'PASS'`, `'SUPER_LIKE'`. |
| `is_undone` | `BOOLEAN` | `NO` | `FALSE` | Set to `TRUE` if reverted via Premium Undo. |
| `created_at` | `TIMESTAMPTZ` | `NO` | `CURRENT_TIMESTAMP` | Action timestamp. |
| `updated_at` | `TIMESTAMPTZ` | `NO` | `CURRENT_TIMESTAMP` | Last update timestamp. |

#### Primary Key
* `PRIMARY KEY (id)`

#### Foreign Keys
* `CONSTRAINT fk_likes_from_user FOREIGN KEY (from_user_id) REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE`
* `CONSTRAINT fk_likes_to_user FOREIGN KEY (to_user_id) REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE`

#### Constraints
* `CONSTRAINT chk_likes_no_self_like CHECK (from_user_id != to_user_id)`
* `CONSTRAINT chk_likes_action_type CHECK (action IN ('LIKE', 'PASS', 'SUPER_LIKE'))`

#### Indexes
* `CREATE UNIQUE INDEX uq_likes_active_pair ON likes (from_user_id, to_user_id) WHERE is_undone = FALSE;`  
  *Prevents duplicate active swipes toward the same target while permitting re-swipes if a previous action was undone.*
* `CREATE INDEX idx_likes_to_user_likers ON likes (to_user_id, action, created_at) WHERE is_undone = FALSE;`  
  *Optimizes "Who Liked You" counting for Free users and full admirer profile retrieval for Premium users.*
* `CREATE INDEX idx_likes_reciprocal_check ON likes (to_user_id, from_user_id, action) WHERE is_undone = FALSE;`  
  *Accelerates mutual like detection during swipe submission.*

---

## 10. Matches

### 10.1 `matches`

#### Purpose
Records established mutual matches between pairs of users. To eliminate duplicate records and prevent database locking deadlocks during concurrent mutual swipes, the two user IDs are ordered canonically such that `user_one_id < user_two_id`.

#### Columns
| Column | Type | Nullable | Default | Description |
| :--- | :--- | :--- | :--- | :--- |
| `id` | `UUID` | `NO` | `gen_random_uuid()` | Primary key. |
| `user_one_id` | `UUID` | `NO` | — | Canonical lower user UUID (`user_one_id < user_two_id`). |
| `user_two_id` | `UUID` | `NO` | — | Canonical higher user UUID. |
| `status` | `VARCHAR(20)` | `NO` | `'ACTIVE'` | Match lifecycle state: `'ACTIVE'`, `'UNMATCHED'`, `'UNDONE'`. |
| `matched_at` | `TIMESTAMPTZ` | `NO` | `CURRENT_TIMESTAMP` | Timestamp when mutual match occurred. |
| `unmatched_at` | `TIMESTAMPTZ` | `YES` | `NULL` | Timestamp when unmatch occurred. |
| `unmatched_by_user_id`| `UUID` | `YES` | `NULL` | User ID who initiated the unmatch. |
| `created_at` | `TIMESTAMPTZ` | `NO` | `CURRENT_TIMESTAMP` | Creation timestamp. |
| `updated_at` | `TIMESTAMPTZ` | `NO` | `CURRENT_TIMESTAMP` | Modification timestamp. |

#### Primary Key
* `PRIMARY KEY (id)`

#### Foreign Keys
* `CONSTRAINT fk_matches_user_one FOREIGN KEY (user_one_id) REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE`
* `CONSTRAINT fk_matches_user_two FOREIGN KEY (user_two_id) REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE`
* `CONSTRAINT fk_matches_unmatched_by FOREIGN KEY (unmatched_by_user_id) REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE`

#### Constraints
* `CONSTRAINT chk_matches_canonical_order CHECK (user_one_id < user_two_id)`
* `CONSTRAINT chk_matches_status CHECK (status IN ('ACTIVE', 'UNMATCHED', 'UNDONE'))`

#### Indexes
* `CREATE UNIQUE INDEX uq_matches_single_active_pair ON matches (user_one_id, user_two_id) WHERE status = 'ACTIVE';`  
  *Crucial Index:* Enforces that at most **one ACTIVE match** exists between a pair, while allowing multiple historical rows (`UNMATCHED`) to support legitimate future re-matching without constraint violations.
* `CREATE INDEX idx_matches_user_one ON matches (user_one_id, status);`
* `CREATE INDEX idx_matches_user_two ON matches (user_two_id, status);`

---

## 11. Conversations

### 11.1 `conversations`

#### Purpose
Represents the chat channel established for a specific match. Maintains a strict 1:1 relationship with `matches`. When users unmatch, the conversation status transitions to `CLOSED`.

#### Columns
| Column | Type | Nullable | Default | Description |
| :--- | :--- | :--- | :--- | :--- |
| `id` | `UUID` | `NO` | `gen_random_uuid()` | Primary key. |
| `match_id` | `UUID` | `NO` | — | Foreign key referencing `matches.id`. Enforces 1:1 relationship. |
| `status` | `VARCHAR(20)` | `NO` | `'ACTIVE'` | State: `'ACTIVE'` or `'CLOSED'`. |
| `last_message_at`| `TIMESTAMPTZ` | `YES` | `NULL` | Cached timestamp of most recent message for inbox sorting. |
| `closed_at` | `TIMESTAMPTZ` | `YES` | `NULL` | Timestamp when conversation was closed due to unmatch/block. |
| `created_at` | `TIMESTAMPTZ` | `NO` | `CURRENT_TIMESTAMP` | Creation timestamp. |
| `updated_at` | `TIMESTAMPTZ` | `NO` | `CURRENT_TIMESTAMP` | Modification timestamp. |

#### Primary Key
* `PRIMARY KEY (id)`

#### Foreign Keys
* `CONSTRAINT fk_conversations_match FOREIGN KEY (match_id) REFERENCES matches(id) ON DELETE CASCADE ON UPDATE CASCADE`

#### Constraints
* `CONSTRAINT uq_conversations_match UNIQUE (match_id)`
* `CONSTRAINT chk_conversations_status CHECK (status IN ('ACTIVE', 'CLOSED'))`

#### Indexes
* `CREATE INDEX idx_conversations_inbox_sort ON conversations (status, last_message_at DESC);`

---

## 12. Messages

### 12.1 `messages`

#### Purpose
Stores chat messages exchanged within an active conversation. Supports text messages for Free users and rich media messages (images, audio, video, GIFs) for Premium subscribers. Large media binaries are stored in AWS S3; PostgreSQL stores only verified object keys and metadata.

#### Columns
| Column | Type | Nullable | Default | Description |
| :--- | :--- | :--- | :--- | :--- |
| `id` | `UUID` | `NO` | `gen_random_uuid()` | Primary key. |
| `conversation_id`| `UUID` | `NO` | — | Foreign key referencing `conversations.id`. |
| `sender_id` | `UUID` | `NO` | — | Foreign key of message author referencing `users.id`. |
| `message_type` | `VARCHAR(20)` | `NO` | `'TEXT'` | Type: `'TEXT'`, `'IMAGE'`, `'GIF'`, `'VIDEO'`, `'VOICE'`. |
| `content` | `TEXT` | `YES` | `NULL` | Text message body or optional media caption. |
| `media_storage_key`| `VARCHAR(512)` | `YES` | `NULL` | S3 object key for private media attachments. |
| `media_mime_type`| `VARCHAR(50)` | `YES` | `NULL` | Attachment MIME type (e.g., `'image/jpeg'`, `'audio/aac'`). |
| `media_file_size`| `INTEGER` | `YES` | `NULL` | Attachment size in bytes. |
| `read_at` | `TIMESTAMPTZ` | `YES` | `NULL` | Timestamp when recipient read the message. |
| `created_at` | `TIMESTAMPTZ` | `NO` | `CURRENT_TIMESTAMP` | Message creation timestamp. |
| `updated_at` | `TIMESTAMPTZ` | `NO` | `CURRENT_TIMESTAMP` | Modification timestamp. |
| `deleted_at` | `TIMESTAMPTZ` | `YES` | `NULL` | Soft deletion timestamp for message deletion. |

#### Primary Key
* `PRIMARY KEY (id)`

#### Foreign Keys
* `CONSTRAINT fk_messages_conversation FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE ON UPDATE CASCADE`
* `CONSTRAINT fk_messages_sender FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE`

#### Constraints
* `CONSTRAINT chk_messages_type CHECK (message_type IN ('TEXT', 'IMAGE', 'GIF', 'VIDEO', 'VOICE'))`
* `CONSTRAINT chk_messages_payload_integrity CHECK ((message_type = 'TEXT' AND content IS NOT NULL) OR (message_type IN ('IMAGE', 'GIF', 'VIDEO', 'VOICE') AND media_storage_key IS NOT NULL))`

#### Indexes
* `CREATE INDEX idx_messages_conversation_history ON messages (conversation_id, created_at DESC) WHERE deleted_at IS NULL;`  
  *Optimizes cursor-based pagination of chat conversation threads.*
* `CREATE INDEX idx_messages_unread_count ON messages (conversation_id, sender_id, read_at) WHERE read_at IS NULL AND deleted_at IS NULL;`  
  *Accelerates unread badge calculation across user dialogs.*

---

## 13. Blocks

### 13.1 `blocks`

#### Purpose
Stores bidirectional safety blocking records. When user $A$ blocks user $B$, neither user can discover, match, message, or view the other.

#### Columns
| Column | Type | Nullable | Default | Description |
| :--- | :--- | :--- | :--- | :--- |
| `id` | `UUID` | `NO` | `gen_random_uuid()` | Primary key. |
| `blocker_id` | `UUID` | `NO` | — | Foreign key of user initiating the block. |
| `blocked_id` | `UUID` | `NO` | — | Foreign key of user being blocked. |
| `reason` | `VARCHAR(255)` | `YES` | `NULL` | Optional user-supplied reason. |
| `created_at` | `TIMESTAMPTZ` | `NO` | `CURRENT_TIMESTAMP` | Timestamp of block. |

#### Primary Key
* `PRIMARY KEY (id)`

#### Foreign Keys
* `CONSTRAINT fk_blocks_blocker FOREIGN KEY (blocker_id) REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE`
* `CONSTRAINT fk_blocks_blocked FOREIGN KEY (blocked_id) REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE`

#### Constraints
* `CONSTRAINT chk_blocks_no_self_block CHECK (blocker_id != blocked_id)`
* `CONSTRAINT uq_blocks_pair UNIQUE (blocker_id, blocked_id)`

#### Indexes
* `CREATE INDEX idx_blocks_lookup ON blocks (blocker_id, blocked_id);`
* `CREATE INDEX idx_blocks_reverse_lookup ON blocks (blocked_id, blocker_id);`  
  *Ensures instantaneous $O(1)$ bidirectional exclusion checks during discovery and chat execution.*

---

## 14. Reports

### 14.1 `reports`

#### Purpose
Records user moderation reports submitted against violating profiles for administrative review.

#### Columns
| Column | Type | Nullable | Default | Description |
| :--- | :--- | :--- | :--- | :--- |
| `id` | `UUID` | `NO` | `gen_random_uuid()` | Primary key. |
| `reporter_id` | `UUID` | `YES` | `NULL` | User submitting the report (`ON DELETE SET NULL`). |
| `reported_user_id`| `UUID` | `NO` | — | User being reported (`ON DELETE CASCADE`). |
| `reason` | `VARCHAR(50)` | `NO` | — | Reason: `'FAKE_PROFILE'`, `'HARASSMENT'`, `'SPAM'`, `'INAPPROPRIATE_CONTENT'`, `'SCAM'`, `'OTHER'`. |
| `description` | `TEXT` | `YES` | `NULL` | Detailed context provided by reporter. |
| `status` | `VARCHAR(30)` | `NO` | `'PENDING'` | Moderation state: `'PENDING'`, `'REVIEWING'`, `'RESOLVED'`, `'DISMISSED'`. |
| `admin_notes` | `TEXT` | `YES` | `NULL` | Internal investigation notes. |
| `resolved_by` | `UUID` | `YES` | `NULL` | Admin user who resolved the ticket (`ON DELETE SET NULL`). |
| `resolved_at` | `TIMESTAMPTZ` | `YES` | `NULL` | Resolution timestamp. |
| `created_at` | `TIMESTAMPTZ` | `NO` | `CURRENT_TIMESTAMP` | Report submission timestamp. |
| `updated_at` | `TIMESTAMPTZ` | `NO` | `CURRENT_TIMESTAMP` | Last status update timestamp. |

#### Primary Key
* `PRIMARY KEY (id)`

#### Foreign Keys
* `CONSTRAINT fk_reports_reporter FOREIGN KEY (reporter_id) REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE`
* `CONSTRAINT fk_reports_reported FOREIGN KEY (reported_user_id) REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE`
* `CONSTRAINT fk_reports_resolved_by FOREIGN KEY (resolved_by) REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE`

#### Constraints
* `CONSTRAINT chk_reports_reason CHECK (reason IN ('FAKE_PROFILE', 'HARASSMENT', 'SPAM', 'INAPPROPRIATE_CONTENT', 'SCAM', 'OTHER'))`
* `CONSTRAINT chk_reports_status CHECK (status IN ('PENDING', 'REVIEWING', 'RESOLVED', 'DISMISSED'))`

#### Indexes
* `CREATE INDEX idx_reports_status_created ON reports (status, created_at ASC);`  
  *Optimizes admin moderation queue triaging.*
* `CREATE INDEX idx_reports_reported_user ON reports (reported_user_id, status);`  
  *Supports admin profile inspection to see total reports against a user.*

---

## 15. Notifications

### 15.1 `notifications`

#### Purpose
Stores transactional in-app notifications generated by system events (`NEW_MATCH`, `'NEW_MESSAGE'`, `'NEW_LIKE'`).

#### Columns
| Column | Type | Nullable | Default | Description |
| :--- | :--- | :--- | :--- | :--- |
| `id` | `UUID` | `NO` | `gen_random_uuid()` | Primary key. |
| `user_id` | `UUID` | `NO` | — | Recipient user referencing `users.id`. |
| `type` | `VARCHAR(50)` | `NO` | — | Notification type: `'NEW_MATCH'`, `'NEW_MESSAGE'`, `'NEW_LIKE'`. |
| `title` | `VARCHAR(255)` | `NO` | — | Notification headline. |
| `message` | `TEXT` | `NO` | — | Notification body. |
| `data` | `JSONB` | `NO` | `'{}'::jsonb` | Contextual payload (e.g., `{"matchId": "...", "conversationId": "..."}`). |
| `read_at` | `TIMESTAMPTZ` | `YES` | `NULL` | Timestamp when viewed by user. |
| `created_at` | `TIMESTAMPTZ` | `NO` | `CURRENT_TIMESTAMP` | Dispatch timestamp. |

#### Primary Key
* `PRIMARY KEY (id)`

#### Foreign Keys
* `CONSTRAINT fk_notifications_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE`

#### Constraints
* `CONSTRAINT chk_notifications_type CHECK (type IN ('NEW_MATCH', 'NEW_MESSAGE', 'NEW_LIKE'))`

#### Indexes
* `CREATE INDEX idx_notifications_user_unread ON notifications (user_id, created_at DESC) WHERE read_at IS NULL;`  
  *Accelerates unread notification badge calculation.*
* `CREATE INDEX idx_notifications_user_feed ON notifications (user_id, created_at DESC);`  
  *Supports paginated notification list rendering.*

---

## 16. Subscription & Monetization

Monetization is decoupled from user credentials. Premium status is never a role or a boolean flag on the `users` table; it is evaluated dynamically through the active subscription and entitlement records.

### 16.1 `plans`

#### Purpose
Defines billing tiers (`FREE`, `PREMIUM_MONTHLY`, `PREMIUM_YEARLY`) and base configuration.

#### Columns
| Column | Type | Nullable | Default | Description |
| :--- | :--- | :--- | :--- | :--- |
| `id` | `UUID` | `NO` | `gen_random_uuid()` | Primary key. |
| `code` | `VARCHAR(50)` | `NO` | — | Unique code: `'FREE'`, `'PREMIUM_MONTHLY'`, `'PREMIUM_YEARLY'`. |
| `name` | `VARCHAR(100)` | `NO` | — | Display title (e.g., `'Love Bite Premium (Monthly)'`). |
| `billing_interval`| `VARCHAR(20)` | `NO` | `'NONE'` | Interval: `'NONE'`, `'MONTH'`, `'YEAR'`. |
| `price_in_cents` | `INTEGER` | `NO` | `0` | Base price in smallest currency unit (e.g., paise/cents). |
| `currency` | `VARCHAR(3)` | `NO` | `'INR'` | ISO 4217 currency code. |
| `is_active` | `BOOLEAN` | `NO` | `TRUE` | Whether available for new subscription purchases. |
| `display_order` | `SMALLINT` | `NO` | `0` | Pricing UI order. |
| `created_at` | `TIMESTAMPTZ` | `NO` | `CURRENT_TIMESTAMP` | Creation timestamp. |
| `updated_at` | `TIMESTAMPTZ` | `NO` | `CURRENT_TIMESTAMP` | Modification timestamp. |

#### Primary Key
* `PRIMARY KEY (id)`

#### Constraints
* `CONSTRAINT uq_plans_code UNIQUE (code)`
* `CONSTRAINT chk_plans_interval CHECK (billing_interval IN ('NONE', 'MONTH', 'YEAR'))`
* `CONSTRAINT chk_plans_price CHECK (price_in_cents >= 0)`

---

### 16.2 `features`

#### Purpose
Catalog of gated platform capabilities (e.g., `SEE_WHO_LIKED_YOU`, `UNDO_ACTION`, `CHAT_MEDIA`, `UNLIMITED_SWIPES`).

#### Columns
| Column | Type | Nullable | Default | Description |
| :--- | :--- | :--- | :--- | :--- |
| `id` | `UUID` | `NO` | `gen_random_uuid()` | Primary key. |
| `code` | `VARCHAR(50)` | `NO` | — | Unique code (e.g., `'SEE_WHO_LIKED_YOU'`). |
| `name` | `VARCHAR(100)` | `NO` | — | Display name. |
| `description` | `TEXT` | `YES` | `NULL` | Explanation of entitlement. |
| `is_active` | `BOOLEAN` | `NO` | `TRUE` | Whether feature is active globally. |
| `created_at` | `TIMESTAMPTZ` | `NO` | `CURRENT_TIMESTAMP` | Creation timestamp. |
| `updated_at` | `TIMESTAMPTZ` | `NO` | `CURRENT_TIMESTAMP` | Modification timestamp. |

#### Primary Key
* `PRIMARY KEY (id)`

#### Constraints
* `CONSTRAINT uq_features_code UNIQUE (code)`

---

### 16.3 `plan_features`

#### Purpose
Junction table mapping features enabled for each subscription plan tier.

#### Columns
| Column | Type | Nullable | Default | Description |
| :--- | :--- | :--- | :--- | :--- |
| `id` | `UUID` | `NO` | `gen_random_uuid()` | Primary key. |
| `plan_id` | `UUID` | `NO` | — | Foreign key referencing `plans.id`. |
| `feature_id` | `UUID` | `NO` | — | Foreign key referencing `features.id`. |
| `created_at` | `TIMESTAMPTZ` | `NO` | `CURRENT_TIMESTAMP` | Mapping timestamp. |

#### Primary Key
* `PRIMARY KEY (id)`

#### Foreign Keys
* `CONSTRAINT fk_plan_features_plan FOREIGN KEY (plan_id) REFERENCES plans(id) ON DELETE CASCADE ON UPDATE CASCADE`
* `CONSTRAINT fk_plan_features_feature FOREIGN KEY (feature_id) REFERENCES features(id) ON DELETE CASCADE ON UPDATE CASCADE`

#### Constraints
* `CONSTRAINT uq_plan_features_pair UNIQUE (plan_id, feature_id)`

---

### 16.4 `subscriptions`

#### Purpose
Stores user subscription instances, auto-renewal settings, billing period dates, grace period markers, and gateway subscription identifiers.

#### Columns
| Column | Type | Nullable | Default | Description |
| :--- | :--- | :--- | :--- | :--- |
| `id` | `UUID` | `NO` | `gen_random_uuid()` | Primary key. |
| `user_id` | `UUID` | `NO` | — | Foreign key referencing `users.id`. |
| `plan_id` | `UUID` | `NO` | — | Foreign key referencing `plans.id`. |
| `provider` | `VARCHAR(50)` | `NO` | `'RAZORPAY'` | Gateway provider (`'RAZORPAY'`, `'MANUAL'`). |
| `provider_subscription_id`| `VARCHAR(255)` | `YES` | `NULL` | Gateway subscription identifier (e.g., `sub_xxx`). |
| `provider_customer_id` | `VARCHAR(255)` | `YES` | `NULL` | Gateway customer identifier (e.g., `cust_xxx`). |
| `status` | `VARCHAR(30)` | `NO` | `'ACTIVE'` | State: `'ACTIVE'`, `'PAST_DUE'`, `'GRACE_PERIOD'`, `'CANCELED'`, `'EXPIRED'`. |
| `auto_renew` | `BOOLEAN` | `NO` | `TRUE` | Whether recurring billing is active. |
| `current_period_start` | `TIMESTAMPTZ` | `NO` | — | Start timestamp of current billing cycle. |
| `current_period_end` | `TIMESTAMPTZ` | `NO` | — | End timestamp of current billing cycle. |
| `grace_period_end` | `TIMESTAMPTZ` | `YES` | `NULL` | Timestamp when 24-hour grace period expires. |
| `canceled_at` | `TIMESTAMPTZ` | `YES` | `NULL` | Timestamp when user disabled auto-renew. |
| `ended_at` | `TIMESTAMPTZ` | `YES` | `NULL` | Timestamp when subscription fully terminated. |
| `created_at` | `TIMESTAMPTZ` | `NO` | `CURRENT_TIMESTAMP` | Creation timestamp. |
| `updated_at` | `TIMESTAMPTZ` | `NO` | `CURRENT_TIMESTAMP` | Modification timestamp. |

#### Primary Key
* `PRIMARY KEY (id)`

#### Foreign Keys
* `CONSTRAINT fk_subscriptions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE`
* `CONSTRAINT fk_subscriptions_plan FOREIGN KEY (plan_id) REFERENCES plans(id) ON DELETE RESTRICT ON UPDATE CASCADE`

#### Constraints
* `CONSTRAINT chk_subscriptions_status CHECK (status IN ('ACTIVE', 'PAST_DUE', 'GRACE_PERIOD', 'CANCELED', 'EXPIRED'))`

#### Indexes
* `CREATE UNIQUE INDEX uq_subscriptions_single_active_per_user ON subscriptions (user_id) WHERE status IN ('ACTIVE', 'PAST_DUE', 'GRACE_PERIOD');`  
  *Enforces that a user has at most one active/in-grace subscription at any given time.*
* `CREATE INDEX idx_subscriptions_provider_sub_id ON subscriptions (provider, provider_subscription_id);`  
  *Accelerates webhook subscription resolution.*
* `CREATE INDEX idx_subscriptions_expiration_reconcile ON subscriptions (status, current_period_end, grace_period_end);`  
  *Optimizes daily background cron jobs checking for expired subscriptions and grace period transitions.*

---

## 17. Entitlements & Usage Tracking

### 17.1 `usage_limits`

#### Purpose
Configures quantitative operational limits per plan tier (e.g., Free users get 10 Likes/Passes combined per day and 20 text messages per day; Premium gets unlimited).

#### Columns
| Column | Type | Nullable | Default | Description |
| :--- | :--- | :--- | :--- | :--- |
| `id` | `UUID` | `NO` | `gen_random_uuid()` | Primary key. |
| `plan_id` | `UUID` | `NO` | — | Foreign key referencing `plans.id`. |
| `metric_key` | `VARCHAR(50)` | `NO` | — | Metric identifier: `'DAILY_LIKE_PASS'`, `'DAILY_TEXT_MESSAGES'`, `'MONTHLY_SUPER_LIKES'`, `'MONTHLY_BOOST_CREDITS'`. |
| `limit_value` | `INTEGER` | `NO` | — | Threshold value. `-1` denotes unlimited access. |
| `period_type` | `VARCHAR(20)` | `NO` | `'DAILY'` | Period boundary: `'DAILY'`, `'MONTHLY'`, `'LIFETIME'`. |
| `created_at` | `TIMESTAMPTZ` | `NO` | `CURRENT_TIMESTAMP` | Creation timestamp. |
| `updated_at` | `TIMESTAMPTZ` | `NO` | `CURRENT_TIMESTAMP` | Modification timestamp. |

#### Primary Key
* `PRIMARY KEY (id)`

#### Foreign Keys
* `CONSTRAINT fk_usage_limits_plan FOREIGN KEY (plan_id) REFERENCES plans(id) ON DELETE CASCADE ON UPDATE CASCADE`

#### Constraints
* `CONSTRAINT uq_usage_limits_metric UNIQUE (plan_id, metric_key)`
* `CONSTRAINT chk_usage_limits_period CHECK (period_type IN ('DAILY', 'MONTHLY', 'LIFETIME'))`

---

### 17.2 `usage_records`

#### Purpose
Persistent ledger recording usage consumption per user and metric across rolling time windows.

#### Columns
| Column | Type | Nullable | Default | Description |
| :--- | :--- | :--- | :--- | :--- |
| `id` | `UUID` | `NO` | `gen_random_uuid()` | Primary key. |
| `user_id` | `UUID` | `NO` | — | Foreign key referencing `users.id`. |
| `metric_key` | `VARCHAR(50)` | `NO` | — | Tracked metric key (e.g., `'DAILY_LIKE_PASS'`, `'DAILY_TEXT_MESSAGES'`). |
| `period_start` | `TIMESTAMPTZ` | `NO` | — | Start of tracked window (e.g., `2026-09-15 00:00:00+00`). |
| `period_end` | `TIMESTAMPTZ` | `NO` | — | End of tracked window. |
| `usage_count` | `INTEGER` | `NO` | `0` | Number of units consumed in the period. |
| `created_at` | `TIMESTAMPTZ` | `NO` | `CURRENT_TIMESTAMP` | Creation timestamp. |
| `updated_at` | `TIMESTAMPTZ` | `NO` | `CURRENT_TIMESTAMP` | Modification timestamp. |

#### Primary Key
* `PRIMARY KEY (id)`

#### Foreign Keys
* `CONSTRAINT fk_usage_records_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE`

#### Constraints
* `CONSTRAINT uq_usage_records_window UNIQUE (user_id, metric_key, period_start)`
* `CONSTRAINT chk_usage_records_count CHECK (usage_count >= 0)`

#### Indexes
* `CREATE INDEX idx_usage_records_lookup ON usage_records (user_id, metric_key, period_start, period_end);`

---

### 17.3 `user_credit_balances`

#### Purpose
Tracks consumable à la carte or subscription-granted balances for Boost and Super Like capabilities.

#### Columns
| Column | Type | Nullable | Default | Description |
| :--- | :--- | :--- | :--- | :--- |
| `id` | `UUID` | `NO` | `gen_random_uuid()` | Primary key. |
| `user_id` | `UUID` | `NO` | — | Foreign key referencing `users.id`. |
| `credit_type` | `VARCHAR(50)` | `NO` | — | Credit type: `'BOOST'`, `'SUPER_LIKE'`. |
| `balance` | `INTEGER` | `NO` | `0` | Available balance. Cannot drop below 0. |
| `created_at` | `TIMESTAMPTZ` | `NO` | `CURRENT_TIMESTAMP` | Creation timestamp. |
| `updated_at` | `TIMESTAMPTZ` | `NO` | `CURRENT_TIMESTAMP` | Modification timestamp. |

#### Primary Key
* `PRIMARY KEY (id)`

#### Foreign Keys
* `CONSTRAINT fk_user_credit_balances_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE`

#### Constraints
* `CONSTRAINT uq_user_credit_balances_pair UNIQUE (user_id, credit_type)`
* `CONSTRAINT chk_user_credit_balances_non_negative CHECK (balance >= 0)`

---

### 17.4 `credit_transactions`

#### Purpose
Auditable ledger tracking every credit increment, grant, purchase, and consumption event.

#### Columns
| Column | Type | Nullable | Default | Description |
| :--- | :--- | :--- | :--- | :--- |
| `id` | `UUID` | `NO` | `gen_random_uuid()` | Primary key. |
| `user_id` | `UUID` | `NO` | — | Foreign key referencing `users.id`. |
| `credit_type` | `VARCHAR(50)` | `NO` | — | Credit type: `'BOOST'`, `'SUPER_LIKE'`. |
| `delta` | `INTEGER` | `NO` | — | Signed balance change (e.g., `+5` for grant/purchase, `-1` for use). |
| `reason` | `VARCHAR(50)` | `NO` | — | Reason: `'MONTHLY_GRANT'`, `'PURCHASE'`, `'CONSUMPTION'`, `'ADMIN_ADJUSTMENT'`, `'REFUND'`. |
| `reference_id` | `VARCHAR(255)` | `YES` | `NULL` | Optional reference (e.g., `payment_id`, `boost_session_id`). |
| `created_at` | `TIMESTAMPTZ` | `NO` | `CURRENT_TIMESTAMP` | Transaction timestamp. |

#### Primary Key
* `PRIMARY KEY (id)`

#### Foreign Keys
* `CONSTRAINT fk_credit_transactions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE`

#### Constraints
* `CONSTRAINT chk_credit_transactions_delta_nonzero CHECK (delta != 0)`
* `CONSTRAINT chk_credit_transactions_reason CHECK (reason IN ('MONTHLY_GRANT', 'PURCHASE', 'CONSUMPTION', 'ADMIN_ADJUSTMENT', 'REFUND'))`

#### Indexes
* `CREATE INDEX idx_credit_transactions_audit ON credit_transactions (user_id, credit_type, created_at DESC);`

---

### 17.5 `boost_sessions`

#### Purpose
Tracks actively running profile Boost sessions. Discovery ranking applies the boost multiplier while `expires_at > CURRENT_TIMESTAMP`.

#### Columns
| Column | Type | Nullable | Default | Description |
| :--- | :--- | :--- | :--- | :--- |
| `id` | `UUID` | `NO` | `gen_random_uuid()` | Primary key. |
| `user_id` | `UUID` | `NO` | — | Foreign key referencing `users.id`. |
| `multiplier` | `NUMERIC(4,2)` | `NO` | `2.00` | Discovery ranking weight multiplier. |
| `started_at` | `TIMESTAMPTZ` | `NO` | `CURRENT_TIMESTAMP` | Session start time. |
| `expires_at` | `TIMESTAMPTZ` | `NO` | — | Session expiration time (e.g., 30 mins after start). |
| `is_active` | `BOOLEAN` | `NO` | `TRUE` | Whether session is active. |
| `created_at` | `TIMESTAMPTZ` | `NO` | `CURRENT_TIMESTAMP` | Creation timestamp. |

#### Primary Key
* `PRIMARY KEY (id)`

#### Foreign Keys
* `CONSTRAINT fk_boost_sessions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE`

#### Indexes
* `CREATE INDEX idx_boost_sessions_active ON boost_sessions (user_id, expires_at) WHERE is_active = TRUE;`

---

## 18. Payments & Razorpay Integration

### 18.1 `payments`

#### Purpose
Stores transactional payment records, invoices, amounts, currency, and provider identifiers. Decoupled via provider fields to support multiple payment gateways while using Razorpay initially.

#### Columns
| Column | Type | Nullable | Default | Description |
| :--- | :--- | :--- | :--- | :--- |
| `id` | `UUID` | `NO` | `gen_random_uuid()` | Primary key. |
| `user_id` | `UUID` | `YES` | `NULL` | User who made the payment (`ON DELETE SET NULL`). |
| `subscription_id`| `UUID` | `YES` | `NULL` | Associated subscription if applicable (`ON DELETE SET NULL`). |
| `provider` | `VARCHAR(50)` | `NO` | `'RAZORPAY'` | Gateway: `'RAZORPAY'`, `'MANUAL'`. |
| `provider_payment_id`| `VARCHAR(255)` | `YES` | `NULL` | Gateway payment ID (e.g., `pay_xxx`). |
| `provider_order_id`| `VARCHAR(255)` | `YES` | `NULL` | Gateway order ID (e.g., `order_xxx`). |
| `amount_in_cents`| `INTEGER` | `NO` | — | Payment amount in smallest currency unit. |
| `currency` | `VARCHAR(3)` | `NO` | `'INR'` | ISO 4217 currency code. |
| `status` | `VARCHAR(30)` | `NO` | `'INITIATED'` | Status: `'INITIATED'`, `'AUTHORIZED'`, `'CAPTURED'`, `'FAILED'`, `'REFUNDED'`. |
| `payment_type` | `VARCHAR(30)` | `NO` | — | Type: `'SUBSCRIPTION_INITIAL'`, `'SUBSCRIPTION_RECURRING'`, `'CREDIT_PURCHASE'`. |
| `raw_payload` | `JSONB` | `YES` | `NULL` | Raw provider payload for dispute auditing. |
| `failure_reason` | `TEXT` | `YES` | `NULL` | Error details if transaction failed. |
| `paid_at` | `TIMESTAMPTZ` | `YES` | `NULL` | Gateway confirmation timestamp. |
| `created_at` | `TIMESTAMPTZ` | `NO` | `CURRENT_TIMESTAMP` | Creation timestamp. |
| `updated_at` | `TIMESTAMPTZ` | `NO` | `CURRENT_TIMESTAMP` | Modification timestamp. |

#### Primary Key
* `PRIMARY KEY (id)`

#### Foreign Keys
* `CONSTRAINT fk_payments_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE`
* `CONSTRAINT fk_payments_subscription FOREIGN KEY (subscription_id) REFERENCES subscriptions(id) ON DELETE SET NULL ON UPDATE CASCADE`

#### Constraints
* `CONSTRAINT chk_payments_status CHECK (status IN ('INITIATED', 'AUTHORIZED', 'CAPTURED', 'FAILED', 'REFUNDED'))`
* `CONSTRAINT chk_payments_type CHECK (payment_type IN ('SUBSCRIPTION_INITIAL', 'SUBSCRIPTION_RECURRING', 'CREDIT_PURCHASE'))`
* `CONSTRAINT chk_payments_amount CHECK (amount_in_cents > 0)`

#### Indexes
* `CREATE UNIQUE INDEX uq_payments_provider_payment_id ON payments (provider, provider_payment_id) WHERE provider_payment_id IS NOT NULL;`  
  *Prevents duplicate payment records for identical gateway transaction IDs.*
* `CREATE INDEX idx_payments_user_history ON payments (user_id, created_at DESC);`
* `CREATE INDEX idx_payments_order_lookup ON payments (provider_order_id);`

---

### 18.2 `processed_webhooks`

#### Purpose
Enforces webhook idempotency across asynchronous payment notifications. Duplicate deliveries are identified and safely ignored without duplicate processing.

#### Columns
| Column | Type | Nullable | Default | Description |
| :--- | :--- | :--- | :--- | :--- |
| `event_id` | `VARCHAR(255)` | `NO` | — | Primary key. Unique webhook event ID from payment gateway. |
| `provider` | `VARCHAR(50)` | `NO` | `'RAZORPAY'` | Gateway provider. |
| `event_type` | `VARCHAR(100)` | `NO` | — | Event type (e.g., `'subscription.charged'`, `'payment.failed'`). |
| `payload` | `JSONB` | `NO` | — | Full raw webhook request payload. |
| `processed_at` | `TIMESTAMPTZ` | `NO` | `CURRENT_TIMESTAMP` | Execution completion timestamp. |

#### Primary Key
* `PRIMARY KEY (event_id)`

#### Indexes
* `CREATE INDEX idx_processed_webhooks_provider_type ON processed_webhooks (provider, event_type, processed_at DESC);`

---

## 19. Subscription Lifecycle State Machine

```
                              ┌───────────────────────────┐
                              │    New Purchase Request   │
                              └─────────────┬─────────────┘
                                            │ (Webhook: subscription.activated)
                                            ▼
                              ┌───────────────────────────┐
                  ┌──────────►│          ACTIVE           │◄────────────────────────┐
                  │           └──────┬─────────────┬──────┘                         │
                  │                  │             │                                │
                  │  (User Cancels)  │             │ (Renewal Fails)                │
                  │                  ▼             ▼                                │
                  │           ┌────────────┐┌──────────────┐                        │
                  │           │  CANCELED  ││   PAST_DUE   │                        │
                  │           └──────┬─────┘└──────┬───────┘                        │
                  │                  │             │ (Period Ends)                  │
                  │                  │             ▼                                │
                  │                  │      ┌──────────────┐ (Payment Recovered)    │
                  │                  │      │ GRACE_PERIOD ├────────────────────────┘
                  │                  │      │  (24 Hours)  │
                  │                  │      └──────┬───────┘
                  │                  │             │ (24h Expires Without Recovery)
                  │                  ▼             ▼
                  │           ┌────────────────────────────┐
                  │           │          EXPIRED           │
                  │           │   (Downgraded to Free)     │
                  │           └─────────────┬──────────────┘
                  │                         │
                  └─────────────────────────┘
                       (New Plan Purchase)
```

### State Definitions:
1. **`ACTIVE`:** Paid billing period is current. All Premium entitlements are active.
2. **`CANCELED`:** User disabled auto-renew. Premium entitlements **remain active** until `current_period_end`.
3. **`PAST_DUE`:** Payment provider reported an initial recurring payment failure. Retry attempts are in progress.
4. **`GRACE_PERIOD`:** Billing cycle reached `current_period_end` after failed renewal. User receives a **24-hour grace window** with full Premium entitlements.
5. **`EXPIRED`:** Grace period concluded without payment recovery. User is downgraded to Free plan limits. Historical subscription record remains preserved.

### Plan Switching Mechanics (Monthly $\leftrightarrow$ Yearly):
* When switching plans, the previous subscription record transitions to `EXPIRED` (or `CANCELED` with `ended_at = CURRENT_TIMESTAMP`), and a new subscription record is inserted immediately inside a managed transaction.
* No prorated refunds are calculated. Historical records are preserved for auditing.

---

## 20. Database Constraints Summary

| Table | Constraint Name | Type | Rule / Condition |
| :--- | :--- | :--- | :--- |
| `users` | `chk_users_identifier_present` | CHECK | `email IS NOT NULL OR phone IS NOT NULL` |
| `users` | `chk_users_role` | CHECK | `role IN ('USER', 'ADMIN')` |
| `users` | `chk_users_status` | CHECK | `status IN ('UNVERIFIED', 'ACTIVE', 'SUSPENDED', 'BANNED', 'DELETED')` |
| `profiles` | `chk_profiles_age_18_plus` | CHECK | `date_of_birth <= CURRENT_DATE - INTERVAL '18 years'` |
| `profile_photos` | `chk_profile_photos_display_order` | CHECK | `display_order BETWEEN 1 AND 5` |
| `profile_photos` | `chk_profile_photos_file_size` | CHECK | `file_size_bytes > 0 AND file_size_bytes <= 10485760` |
| `dating_preferences`| `chk_dating_preferences_age_range` | CHECK | `min_age >= 18 AND max_age >= min_age AND max_age <= 100` |
| `dating_preferences`| `chk_dating_preferences_distance` | CHECK | `max_distance_km >= 1 AND max_distance_km <= 500` |
| `likes` | `chk_likes_no_self_like` | CHECK | `from_user_id != to_user_id` |
| `likes` | `chk_likes_action_type` | CHECK | `action IN ('LIKE', 'PASS', 'SUPER_LIKE')` |
| `matches` | `chk_matches_canonical_order` | CHECK | `user_one_id < user_two_id` |
| `matches` | `chk_matches_status` | CHECK | `status IN ('ACTIVE', 'UNMATCHED', 'UNDONE')` |
| `messages` | `chk_messages_payload_integrity` | CHECK | `(message_type = 'TEXT' AND content IS NOT NULL) OR (message_type IN ('IMAGE', 'GIF', 'VIDEO', 'VOICE') AND media_storage_key IS NOT NULL)` |
| `blocks` | `chk_blocks_no_self_block` | CHECK | `blocker_id != blocked_id` |
| `user_credit_balances`| `chk_user_credit_balances_non_negative`| CHECK | `balance >= 0` |
| `credit_transactions`| `chk_credit_transactions_delta_nonzero`| CHECK | `delta != 0` |
| `payments` | `chk_payments_amount` | CHECK | `amount_in_cents > 0` |

---

## 21. Foreign Keys & Delete Behavior

| Child Table | Column | Parent Table | Column | ON DELETE | ON UPDATE | Rationale |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `auth_refresh_tokens` | `user_id` | `users` | `id` | `CASCADE` | `CASCADE` | Session tokens have no value after user deletion. |
| `profiles` | `user_id` | `users` | `id` | `CASCADE` | `CASCADE` | 1:1 profile belongs to user identity. |
| `profiles` | `gender_id` | `genders` | `id` | `RESTRICT` | `CASCADE` | Cannot delete gender option if referenced by active profile. |
| `profile_photos` | `user_id` | `users` | `id` | `CASCADE` | `CASCADE` | Photos belong to user account. |
| `user_interests` | `user_id` | `users` | `id` | `CASCADE` | `CASCADE` | Junction table cascade. |
| `user_interests` | `interest_id` | `interests` | `id` | `RESTRICT` | `CASCADE` | Active user selections prevent hard interest deletion. |
| `dating_preferences` | `user_id` | `users` | `id` | `CASCADE` | `CASCADE` | Preferences belong directly to user. |
| `likes` | `from_user_id` | `users` | `id` | `CASCADE` | `CASCADE` | Interaction cleanup upon user hard purge. |
| `likes` | `to_user_id` | `users` | `id` | `CASCADE` | `CASCADE` | Interaction cleanup upon user hard purge. |
| `matches` | `user_one_id` | `users` | `id` | `CASCADE` | `CASCADE` | Match participant cleanup. |
| `matches` | `user_two_id` | `users` | `id` | `CASCADE` | `CASCADE` | Match participant cleanup. |
| `conversations` | `match_id` | `matches` | `id` | `CASCADE` | `CASCADE` | Conversation belongs strictly to match lifecycle. |
| `messages` | `conversation_id` | `conversations`| `id` | `CASCADE` | `CASCADE` | Messages belong to conversation thread. |
| `messages` | `sender_id` | `users` | `id` | `CASCADE` | `CASCADE` | Message author reference. |
| `blocks` | `blocker_id` | `users` | `id` | `CASCADE` | `CASCADE` | Safety block actor cleanup. |
| `blocks` | `blocked_id` | `users` | `id` | `CASCADE` | `CASCADE` | Safety block target cleanup. |
| `reports` | `reporter_id` | `users` | `id` | `SET NULL` | `CASCADE` | Report history preserved even if reporter deletes account. |
| `reports` | `reported_user_id`| `users`| `id` | `CASCADE` | `CASCADE` | Moderation ticket for reported account. |
| `reports` | `resolved_by` | `users` | `id` | `SET NULL` | `CASCADE` | Admin resolver record preserved. |
| `subscriptions` | `user_id` | `users` | `id` | `CASCADE` | `CASCADE` | Subscription owner. |
| `subscriptions` | `plan_id` | `plans` | `id` | `RESTRICT` | `CASCADE` | Cannot delete plan if subscribed users exist. |
| `payments` | `user_id` | `users` | `id` | `SET NULL` | `CASCADE` | Financial ledger must NEVER be deleted upon account removal. |
| `payments` | `subscription_id`| `subscriptions`| `id` | `SET NULL` | `CASCADE` | Payment invoice preserved for tax/auditing. |

---

## 22. Index Strategy

```sql
-- 1. Identity & Auth
CREATE UNIQUE INDEX uq_users_email_active ON users (email) WHERE email IS NOT NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX uq_users_phone_active ON users (phone) WHERE phone IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX idx_users_status ON users (status) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX uq_auth_refresh_tokens_hash ON auth_refresh_tokens (token_hash);
CREATE INDEX idx_auth_refresh_tokens_user_active ON auth_refresh_tokens (user_id) WHERE revoked_at IS NULL;

-- 2. Spatial & Discovery
CREATE INDEX idx_profiles_location_gist ON profiles USING GIST (location);
CREATE INDEX idx_profiles_discovery_eligibility ON profiles (is_profile_complete, gender_id, date_of_birth);
CREATE UNIQUE INDEX uq_profile_photos_primary_per_user ON profile_photos (user_id) WHERE is_primary = TRUE AND deleted_at IS NULL;
CREATE UNIQUE INDEX uq_profile_photos_order_per_user ON profile_photos (user_id, display_order) WHERE deleted_at IS NULL;
CREATE INDEX idx_profile_photos_user_active ON profile_photos (user_id, display_order) WHERE deleted_at IS NULL;

-- 3. Preferences Junctions
CREATE INDEX idx_user_interests_interest_lookup ON user_interests (interest_id, user_id);
CREATE INDEX idx_pref_genders_lookup ON user_dating_preference_genders (gender_id, user_id);

-- 4. Interactions & Safety
CREATE UNIQUE INDEX uq_likes_active_pair ON likes (from_user_id, to_user_id) WHERE is_undone = FALSE;
CREATE INDEX idx_likes_to_user_likers ON likes (to_user_id, action, created_at) WHERE is_undone = FALSE;
CREATE INDEX idx_likes_reciprocal_check ON likes (to_user_id, from_user_id, action) WHERE is_undone = FALSE;
CREATE UNIQUE INDEX uq_matches_single_active_pair ON matches (user_one_id, user_two_id) WHERE status = 'ACTIVE';
CREATE INDEX idx_matches_user_one ON matches (user_one_id, status);
CREATE INDEX idx_matches_user_two ON matches (user_two_id, status);
CREATE INDEX idx_blocks_lookup ON blocks (blocker_id, blocked_id);
CREATE INDEX idx_blocks_reverse_lookup ON blocks (blocked_id, blocker_id);

-- 5. Chat & Notifications
CREATE INDEX idx_conversations_inbox_sort ON conversations (status, last_message_at DESC);
CREATE INDEX idx_messages_conversation_history ON messages (conversation_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_messages_unread_count ON messages (conversation_id, sender_id, read_at) WHERE read_at IS NULL AND deleted_at IS NULL;
CREATE INDEX idx_notifications_user_unread ON notifications (user_id, created_at DESC) WHERE read_at IS NULL;

-- 6. Monetization & Usage
CREATE UNIQUE INDEX uq_subscriptions_single_active_per_user ON subscriptions (user_id) WHERE status IN ('ACTIVE', 'PAST_DUE', 'GRACE_PERIOD');
CREATE INDEX idx_subscriptions_provider_sub_id ON subscriptions (provider, provider_subscription_id);
CREATE INDEX idx_usage_records_lookup ON usage_records (user_id, metric_key, period_start, period_end);
CREATE INDEX idx_credit_transactions_audit ON credit_transactions (user_id, credit_type, created_at DESC);
CREATE UNIQUE INDEX uq_payments_provider_payment_id ON payments (provider, provider_payment_id) WHERE provider_payment_id IS NOT NULL;
CREATE INDEX idx_processed_webhooks_provider_type ON processed_webhooks (provider, event_type, processed_at DESC);
```

---

## 23. Transactions & Concurrency Architecture

### 23.1 Concurrency Challenges & Mitigations

| Interaction Scenario | Race Condition Risk | Database Defense Mechanism |
| :--- | :--- | :--- |
| **Simultaneous Mutual Likes** | Both users swipe Right at the same millisecond; two parallel transactions try to create duplicate match rows. | **Canonical user ordering + `SELECT FOR UPDATE` + Partial Unique Index (`uq_matches_single_active_pair`).** The transaction sorting user IDs ensures lock acquisition order is consistent, preventing deadlocks. |
| **Simultaneous Swipe & Undo** | User rapidly submits Like and Undo across parallel HTTP requests. | Serialized row-level transaction with optimistic locking on `likes.is_undone`. |
| **Simultaneous Unmatch & Message Send** | User A unmatches User B while User B's pending message is in flight. | Transaction verifies `conversations.status = 'ACTIVE'` inside transaction before inserting message. |
| **Daily Quota Limit Bypassing** | Free user fires 10 parallel Like requests to bypass the daily 10-swipe limit. | **Atomic database increment:** `INSERT ... ON CONFLICT DO UPDATE SET usage_count = usage_count + 1 WHERE usage_count < limit RETURNING usage_count`. If 0 rows updated, request fails immediately. |
| **Duplicate Payment Webhooks** | Razorpay delivers the same webhook event multiple times within seconds. | **Atomic Webhook Deduplication:** Insert into `processed_webhooks (event_id)` inside transaction. Duplicate insert throws primary key violation `23505` and returns `200 OK` instantly. |

### 23.2 Like $\rightarrow$ Match Concurrency-Safe Transaction Flow
```
User A Likes User B
        │
        ▼
[BEGIN TRANSACTION]
        │
        ├─► Acquire Row Lock on Reciprocal Like:
        │   SELECT * FROM likes 
        │   WHERE from_user_id = B AND to_user_id = A AND is_undone = FALSE 
        │   FOR UPDATE;
        │
        ├─► INSERT INTO likes (from_user_id, to_user_id, action = 'LIKE');
        │
        ├─► IF Reciprocal Like EXISTS ('LIKE' or 'SUPER_LIKE'):
        │     │
        │     ├─► Let user_low = LEAST(A, B), user_high = GREATEST(A, B)
        │     ├─► INSERT INTO matches (user_one_id, user_two_id, status = 'ACTIVE');
        │     ├─► INSERT INTO conversations (match_id, status = 'ACTIVE');
        │     └─► Enqueue "NEW_MATCH" notifications for A and B.
        │
        ├─► ELSE:
        │     └─► Enqueue "NEW_LIKE" notification for B (Censored payload if B is Free).
        │
        ▼
[COMMIT TRANSACTION]
```

---

## 24. Idempotency & Webhook Architecture

1. **Webhook Idempotency Key:** Primary key on `processed_webhooks.event_id`.
2. **Execution Protocol:**
   ```typescript
   // Conceptual Webhook Pipeline
   await sequelize.transaction(async (t) => {
     // 1. Attempt to register event
     const [webhookRecord, created] = await ProcessedWebhook.findOrCreate({
       where: { event_id: rawEvent.id },
       defaults: { provider: 'RAZORPAY', event_type: rawEvent.event, payload: rawEvent },
       transaction: t,
     });
     if (!created) {
       // Duplicate delivery: terminate cleanly
       return { status: 'ALREADY_PROCESSED' };
     }

     // 2. Process business state transition (e.g., extend subscription, activate grace period)
     await SubscriptionService.handleWebhookEvent(rawEvent, t);
   });
   ```

---

## 25. Soft Delete & Data Retention Policy

### 25.1 Soft Deletion Strategy
* When an account is deleted by a user or an admin, `users.deleted_at` is populated with `CURRENT_TIMESTAMP`, and `users.status` transitions to `'DELETED'`.
* Refresh tokens are immediately revoked (`revoked_at = CURRENT_TIMESTAMP`).
* Profile photos are soft-deleted (`profile_photos.deleted_at = CURRENT_TIMESTAMP`) and queued for S3 purge.
* Active matches transition to `UNMATCHED`, and active conversations transition to `CLOSED`.

### 25.2 Data Retention & Cascade Guardrails
* **Financial Data (`payments`):** `ON DELETE SET NULL` ensures invoices and payment transaction histories are preserved indefinitely for accounting, tax, and audit compliance.
* **Safety & Moderation (`reports`, `blocks`):** Reports submitted by the deleted account are preserved (`reporter_id` set to `NULL`), ensuring historical safety evidence is not destroyed.
* **Hard Purge Lifecycle:** A scheduled background job purges soft-deleted account records and clears S3 binaries after a **30-day compliance retention window**.

---

## 26. Sequelize Compatibility & ORM Mapping Rules

1. **Table & Column Naming:** Use `underscored: true` across all Sequelize models to map camelCase JavaScript properties to standard `snake_case` PostgreSQL columns.
2. **Primary Key Declarations:**
   ```typescript
   id: {
     type: DataTypes.UUID,
     defaultValue: DataTypes.UUIDV4,
     primaryKey: true,
     allowNull: false,
   }
   ```
3. **PostGIS Geography Representation:**
   ```typescript
   location: {
     type: DataTypes.GEOMETRY('POINT', 4326),
     allowNull: false,
   }
   ```
4. **Timestamps & Paranoid Mode:**
   * Tables supporting soft delete (`users`, `profile_photos`, `messages`) declare `paranoid: true` with `deletedAt: 'deleted_at'`.
   * Standard timestamps declare `timestamps: true`, `createdAt: 'created_at'`, `updatedAt: 'updated_at'`.
5. **Partial Indexes in Sequelize:**
   * Partial indexes (with `WHERE` clauses) are defined inside the `indexes` array of model options or applied via raw SQL within migration scripts.

---

## 27. Migration Strategy

1. **Migration File Naming:** Sequential timestamp prefix with descriptive kebab-case name:  
   `YYYYMMDDHHMMSS-create-users-table.js`
2. **PostGIS Initialization:** Migration `00000000000001-enable-postgis.js` executes:  
   `CREATE EXTENSION IF NOT EXISTS postgis;`  
   `CREATE EXTENSION IF NOT EXISTS "uuid-ossp";`
3. **Execution Order:**
   * Phase 1: Extensions & Base Reference Tables (`genders`, `interests`, `relationship_intentions`, `plans`, `features`).
   * Phase 2: Core User & Auth (`users`, `auth_refresh_tokens`, `profiles`, `profile_photos`).
   * Phase 3: Preferences & Junctions (`dating_preferences`, `user_interests`, `user_dating_preference_genders`, `user_relationship_intentions`, `user_dating_preference_intentions`).
   * Phase 4: Interactions & Matching (`likes`, `matches`, `conversations`, `messages`, `blocks`, `reports`, `notifications`).
   * Phase 5: Monetization & Usage (`plan_features`, `usage_limits`, `subscriptions`, `payments`, `processed_webhooks`, `usage_records`, `user_credit_balances`, `credit_transactions`, `boost_sessions`).

---

## 28. Seed Data Specifications

### 28.1 Genders Seed (`genders`)
```json
[
  { "code": "MAN", "name": "Man", "is_active": true, "display_order": 1 },
  { "code": "WOMAN", "name": "Woman", "is_active": true, "display_order": 2 },
  { "code": "NON_BINARY", "name": "Non-binary", "is_active": true, "display_order": 3 },
  { "code": "PREFER_NOT_TO_SAY", "name": "Prefer not to say", "is_active": true, "display_order": 4 }
]
```

### 28.2 Relationship Intentions Seed (`relationship_intentions`)
```json
[
  { "code": "LONG_TERM_RELATIONSHIP", "name": "Long-term relationship", "description": "Looking for something serious and lasting", "is_active": true, "display_order": 1 },
  { "code": "SOMETHING_CASUAL", "name": "Something casual", "description": "Open to casual dating and fun dates", "is_active": true, "display_order": 2 },
  { "code": "FRIENDSHIP", "name": "Friendship", "description": "Looking to meet new people and make friends", "is_active": true, "display_order": 3 },
  { "code": "NOT_SURE_YET", "name": "Not sure yet", "description": "Still figuring out what I want", "is_active": true, "display_order": 4 }
]
```

### 28.3 Plans Seed (`plans`)
```json
[
  { "code": "FREE", "name": "Free Tier", "billing_interval": "NONE", "price_in_cents": 0, "currency": "INR", "is_active": true, "display_order": 1 },
  { "code": "PREMIUM_MONTHLY", "name": "Love Bite Premium (Monthly)", "billing_interval": "MONTH", "price_in_cents": 49900, "currency": "INR", "is_active": true, "display_order": 2 },
  { "code": "PREMIUM_YEARLY", "name": "Love Bite Premium (Yearly)", "billing_interval": "YEAR", "price_in_cents": 399900, "currency": "INR", "is_active": true, "display_order": 3 }
]
```

### 28.4 Features Seed (`features`)
```json
[
  { "code": "UNLIMITED_SWIPES", "name": "Unlimited Swipes", "description": "Unlimited daily Likes and Passes" },
  { "code": "SEE_WHO_LIKED_YOU", "name": "See Who Liked You", "description": "Unlock admirer profiles in Who Liked You" },
  { "code": "ADVANCED_FILTERS", "name": "Advanced Filters", "description": "Filter by education, occupation, and lifestyle" },
  { "code": "UNDO_ACTION", "name": "Undo Last Action", "description": "Rewind accidental Left and Right swipes" },
  { "code": "CHAT_MEDIA", "name": "Rich Media Chat", "description": "Send images, audio notes, GIFs, and videos" },
  { "code": "AD_FREE", "name": "Ad-Free Experience", "description": "Zero third-party advertisements in app" },
  { "code": "PRIORITY_VISIBILITY", "name": "Priority Profile Visibility", "description": "Elevated ranking in regional discovery queues" },
  { "code": "MONTHLY_BOOST", "name": "Monthly Boost Credits", "description": "Monthly allocation of profile Boost sessions" },
  { "code": "MONTHLY_SUPER_LIKE", "name": "Monthly Super Likes", "description": "Monthly allocation of Super Likes" }
]
```

### 28.5 Usage Limits Seed (`usage_limits`)
```json
[
  { "plan_code": "FREE", "metric_key": "DAILY_LIKE_PASS", "limit_value": 10, "period_type": "DAILY" },
  { "plan_code": "FREE", "metric_key": "DAILY_TEXT_MESSAGES", "limit_value": 20, "period_type": "DAILY" },
  { "plan_code": "FREE", "metric_key": "MONTHLY_SUPER_LIKES", "limit_value": 0, "period_type": "MONTHLY" },
  { "plan_code": "FREE", "metric_key": "MONTHLY_BOOST_CREDITS", "limit_value": 0, "period_type": "MONTHLY" },
  { "plan_code": "PREMIUM_MONTHLY", "metric_key": "DAILY_LIKE_PASS", "limit_value": -1, "period_type": "DAILY" },
  { "plan_code": "PREMIUM_MONTHLY", "metric_key": "DAILY_TEXT_MESSAGES", "limit_value": -1, "period_type": "DAILY" },
  { "plan_code": "PREMIUM_MONTHLY", "metric_key": "MONTHLY_SUPER_LIKES", "limit_value": 5, "period_type": "MONTHLY" },
  { "plan_code": "PREMIUM_MONTHLY", "metric_key": "MONTHLY_BOOST_CREDITS", "limit_value": 1, "period_type": "MONTHLY" },
  { "plan_code": "PREMIUM_YEARLY", "metric_key": "DAILY_LIKE_PASS", "limit_value": -1, "period_type": "DAILY" },
  { "plan_code": "PREMIUM_YEARLY", "metric_key": "DAILY_TEXT_MESSAGES", "limit_value": -1, "period_type": "DAILY" },
  { "plan_code": "PREMIUM_YEARLY", "metric_key": "MONTHLY_SUPER_LIKES", "limit_value": 5, "period_type": "MONTHLY" },
  { "plan_code": "PREMIUM_YEARLY", "metric_key": "MONTHLY_BOOST_CREDITS", "limit_value": 1, "period_type": "MONTHLY" }
]
```

---

## 29. Final Table Inventory

| # | Table Name | Domain Category | Primary Purpose | Key Constraints & Indexes |
| :- | :--- | :--- | :--- | :--- |
| 1 | `users` | Core / Auth | Account credentials, system role, status, verification, soft-delete. | Unique email/phone partial indexes, check constraints. |
| 2 | `auth_refresh_tokens` | Core / Auth | Persisted sessions, token rotation, and remote logout management. | Unique token hash index, user foreign key cascade. |
| 3 | `genders` | Core / Taxonomy | Dynamic, administrator-managed gender reference catalog. | Unique gender code, display order index. |
| 4 | `profiles` | Core / Profile | User demographic attributes, bio, city, and PostGIS spatial point. | PostGIS GiST spatial index, age $\ge 18$ check. |
| 5 | `profile_photos` | Core / Media | Photo metadata, display order, and S3 object keys. | Max 5 photos check, partial unique primary photo index. |
| 6 | `interests` | Preferences | Admin-managed catalog of interest tags. | Unique code index. |
| 7 | `user_interests` | Preferences | Junction table linking users to selected interests (3–10 required). | Unique `(user_id, interest_id)` pair. |
| 8 | `relationship_intentions`| Preferences | Admin-managed catalog of relationship intention options. | Unique code index. |
| 9 | `user_relationship_intentions`| Preferences | Junction table linking users to self-described relationship intentions. | Unique `(user_id, relationship_intention_id)` pair. |
| 10 | `dating_preferences` | Preferences | Target age range (18–100) and discovery radius (1–500 km). | Check constraints on age range and radius boundaries. |
| 11 | `user_dating_preference_genders`| Preferences | Normalized junction mapping candidate genders user is interested in discovering. | Unique `(user_id, gender_id)` pair. |
| 12 | `user_dating_preference_intentions`| Preferences | Normalized junction mapping candidate relationship intentions user seeks. | Unique `(user_id, relationship_intention_id)` pair. |
| 13 | `likes` | Discovery / Actions | Swipe actions (`LIKE`, `PASS`, `SUPER_LIKE`) and Premium Undo tracking. | Partial unique active pair index, no self-swiping. |
| 14 | `matches` | Matching | Canonical mutual match pairs (`user_one_id < user_two_id`). | Partial unique active match index (`status = 'ACTIVE'`). |
| 15 | `conversations` | Messaging | 1:1 chat channel tied to active match. | Unique match foreign key, status constraint. |
| 16 | `messages` | Messaging | Text and media messages with S3 references. | Conversation history index, payload validation check. |
| 17 | `blocks` | Safety | Bidirectional interaction blocking. | Unique `(blocker_id, blocked_id)` pair index. |
| 18 | `reports` | Moderation | User report tickets submitted for administrative moderation queue. | Status + creation timestamp index. |
| 19 | `notifications` | Engagement | In-app notification queue with contextual JSONB payload. | Unread user notification index. |
| 20 | `plans` | Monetization | Billing tier definitions (`FREE`, `PREMIUM_MONTHLY`, `PREMIUM_YEARLY`). | Unique plan code. |
| 21 | `features` | Monetization | Catalog of protectable platform capabilities. | Unique feature code. |
| 22 | `plan_features` | Monetization | Junction table mapping features granted per plan tier. | Unique `(plan_id, feature_id)` pair. |
| 23 | `usage_limits` | Monetization | Configurable metric limits per plan tier. | Unique `(plan_id, metric_key)` pair. |
| 24 | `subscriptions` | Monetization | User subscription instances, auto-renewal, and grace periods. | Partial unique active subscription index per user. |
| 25 | `user_credit_balances` | Monetization | Consumable credit balances for Boost and Super Likes. | Non-negative balance check. |
| 26 | `credit_transactions` | Monetization | Auditable ledger tracking all credit grants, purchases, and spends. | User credit transaction index. |
| 27 | `boost_sessions` | Monetization | Actively running profile visibility boost sessions. | Active expiration index. |
| 28 | `payments` | Payments | Gateway payment invoices, statuses, amounts, and metadata. | Unique provider payment ID index, `SET NULL` on user deletion. |
| 29 | `processed_webhooks` | Payments | Webhook idempotency ledger preventing duplicate event executions. | Primary key on provider `event_id`. |
| 30 | `usage_records` | Usage Tracking | Aggregated usage consumption tracking across daily/monthly windows. | Unique window index `(user_id, metric_key, period_start)`. |

---

## 30. Open Database Decisions

| Item ID | Topic | Description & Analysis | Current Stance / Recommendation | Status |
| :--- | :--- | :--- | :--- | :--- |
| **ODB-01** | Multi-City / Roaming Profile Coordinates | When a user travels to another city, should historical interactions (Likes/Passes) remain bound globally or re-evaluated per geographic locality? | In Phase 1, interactions are stored globally (`from_user_id, to_user_id`). Moving cities updates `profiles.location` and `profiles.city`, but previous permanent passes remain active to avoid re-swiping previously rejected profiles. | Approved Phase 1 Behavior |
| **ODB-02** | Ephemeral Undo Stack Depth | Product specifications currently support single-level Undo (reversing the immediately preceding action). | Schema uses `likes.is_undone` and ordered `created_at` timestamps. This cleanly supports single-action rewinds and is forward-compatible if multi-step undo history is introduced in Phase 2. | Ready for Implementation |
| **ODB-03** | Chat Message Soft-Delete Sync | If a user deletes a message for themselves vs. deleting for both conversation participants. | The `messages.deleted_at` field implements standard soft delete (hidden from the conversation thread). Granular per-user "delete for me" state can be added via a message status junction if requested in Phase 1.5. | Default Standard Soft Delete |
| **ODB-04** | Discovery Feed Shuffling & Randomization | Ensuring candidate pagination does not return identical ordering on rapid pagination requests while respecting Boost multipliers. | Handled at the service/query layer by combining Boost ranking weights with deterministic seed hashing (e.g., `ORDER BY boost_multiplier DESC, MD5(p.id::text || :sessionSeed)`). | Database Compatible |
