# Love Bite - Backend Development Plan

> **Document Path:** `backend/docs/05-development-plan.md`  
> **Target Version:** Backend Phase 1 (MVP)  
> **Status:** Approved Implementation Roadmap & Execution Plan  
> **Source Documents:** `docs/01-product-requirements.md`, `backend/docs/01-backend-architecture.md`, `backend/docs/02-database-design.md`, `backend/docs/03-api-specification.md`, `backend/docs/04-security.md`

---

## 1. Development Strategy

The backend implementation for **Love Bite** follows a disciplined, incremental engineering strategy. To guarantee data integrity, strict privacy enforcement, and scalable real-time interaction, development must progress strictly from foundational infrastructure and data persistence up to public-facing APIs, monetization workflows, and administrative controls.

```text
Requirements (PRD)
       │
       ▼
Architecture Specification (3-Layer Modular Monolith)
       │
       ▼
Database Schema & Migrations (PostgreSQL 16 + PostGIS 3.4)
       │
       ▼
API Contract & Validation (Zod + REST v1 + Socket.IO)
       │
       ▼
Security Guardrails & Entitlements (Argon2id + JWT + Centralized Entitlements)
       │
       ▼
Feature-by-Feature Implementation (Incremental Modules)
       │
       ▼
Automated Testing (Unit + Supertest Integration + E2E)
       │
       ▼
Peer & Architectural Review
       │
       ▼
Production Readiness Hardening
```

### Core Execution Tenets:
* **Incremental, Working Increments:** Never implement all modules simultaneously. Each development phase must produce a fully functioning, testable slice of the system that can be verified independently against its API and database contracts.
* **Database-First Schema Migrations:** All tables, foreign key constraints, partial indexes, and PostGIS spatial structures must be created exclusively through version-controlled Sequelize migrations prior to building service logic.
* **No Speculative Architecture:** Stick precisely to the approved 3-layer architecture (`Routes` $\rightarrow$ `Controllers` $\rightarrow$ `Services` $\rightarrow$ `Data Access` $\rightarrow$ `Sequelize Models`).
* **Test Alongside Development:** Tests are not deferred to the end of the project. Every feature phase must deliver unit and integration tests before transitioning to subsequent dependent modules.

---

## 2. Implementation Principles

Every software engineer and contributor to the Love Bite backend must adhere to the following non-negotiable implementation principles:

1. **Strict 3-Layer Architecture:**
   * **Controllers (`*.controller.ts`):** Handle HTTP transport only. Extract parameters, validate input payloads via Zod, invoke the appropriate Service method with a typed DTO, and format standardized JSON HTTP responses. Controllers must contain zero business logic and zero database queries.
   * **Services (`*.service.ts`):** Contain all core business logic, dynamic authorization checks, entitlement evaluations, quota tracking, external service orchestration, and database transaction boundaries (`sequelize.transaction`). Services must never access Express `req` or `res` objects or return HTTP status codes.
   * **Data Access Layer (`*.data-access.ts`):** Encapsulate all database interaction logic using Sequelize ORM and PostGIS spatial expressions. Return plain JavaScript objects or typed domain entities.
2. **Repository Pattern is Strictly Forbidden:** Do not introduce generic repository abstractions or generic DAO patterns. Use feature-specific Data Access modules.
3. **Sequelize Models & Schema Integrity:** Sequelize models (`src/database/models/*.ts`) define TypeScript types, associations, and runtime validation. Schema alterations must be executed exclusively through Sequelize migration scripts.
4. **Mandatory Input Validation:** Every incoming HTTP request (body, query parameters, URL path parameters) must be parsed and sanitized using Zod schemas before hitting controller logic. Unrecognized fields must be automatically stripped.
5. **Zero Trust in Frontend Logic:** Never rely on client-side validation, client-reported timestamps, client-supplied prices, or client-side entitlement flags (e.g., `isPremium: true`). All constraints and business rules must be enforced server-side.
6. **Managed Database Transactions:** Multi-entity state mutations (e.g., Like $\rightarrow$ Match $\rightarrow$ Conversation, Unmatch $\rightarrow$ Close Conversation, Payment Webhook $\rightarrow$ Subscription Activation) must execute within atomic database transactions (`sequelize.transaction`).
7. **Centralized Entitlements (No Boolean Gating):** Never write ad-hoc boolean checks like `if (user.isPremium)` across controllers or services. All capability checks and quota evaluations must route through `entitlements.service.ts`.
8. **Strict Location & Admirer Privacy:**
   * Exact spatial coordinates (`latitude`, `longitude`) must **never** be serialized in API responses.
   * Free users must **never** receive unmasked liker profiles or photo URLs from the "Who Liked You" API.
9. **Redis Usage Boundaries:** Redis is used exclusively for ephemeral session caches, rate-limiting counters, Socket.IO clustering adapters, and OTP caching. **Redis must never be used as a primary persistent store** for Users, Matches, Messages, Payments, or Subscriptions.
10. **Code Modification Discipline:** Do not reformat existing unrelated code, do not make arbitrary lint adjustments, and do not introduce unapproved architectural patterns during feature development.

---

## 3. Dependency Overview

The system architecture is structured so that upstream modules provide stable dependencies for downstream business domains:

```text
┌────────────────────────────────────────────────────────────────────────┐
│                        Infrastructure & Config                         │
│             (Node.js, TypeScript, Express, PostgreSQL, PostGIS, Redis)  │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                          Database Foundation                           │
│        (Extensions, Reference Catalogs, Core Schemas, Indexes)         │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                      Authentication & Accounts                         │
│               (Argon2id, Dual-Token JWT, Verification)                 │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                         Profile & Onboarding                           │
│     (Profiles, S3 Presigned Photos, Interests, Dating Preferences)     │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                         Location & Discovery                           │
│               (PostGIS GiST Engine, Candidate Filtering)               │
└───────────────────┬────────────────────────────────┬───────────────────┘
                    │                                │
                    ▼                                ▼
┌──────────────────────────────────────┐ ┌───────────────────────────────┐
│           Likes & Passes             │ │      Safety & Moderation      │
│      (Quotas, Mutual Likes)          │ │       (Blocks, Reports)       │
└───────────────────┬──────────────────┘ └───────────────┬───────────────┘
                    │                                    │
                    ▼                                    │
┌──────────────────────────────────────┐                 │
│          Matches & Chat              │◄────────────────┘
│   (Canonical Pairs, Socket.IO)       │
└───────────────────┬──────────────────┘
                    │
                    ▼
┌──────────────────────────────────────┐
│            Notifications             │
│   (New Match, Message, Like Feed)    │
└──────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────────┐
│                     Subscriptions & Entitlements                       │
│           (Plans, Features, Usage Limits, Usage Records)               │
└───────────────────┬────────────────────────────────┬───────────────────┘
                    │                                │
                    ▼                                ▼
┌──────────────────────────────────────┐ ┌───────────────────────────────┐
│         Payments & Razorpay          │ │          Admin APIs           │
│   (Provider Interface, Webhooks)     │ │   (User Mgmt, Moderation)     │
└──────────────────────────────────────┘ └───────────────────────────────┘
```

### Key Domain Dependency Rules:
1. **Chat depends on Matches:** Conversations can only exist when backed by an active mutual match.
2. **Discovery depends on Profiles, Preferences, Location, Blocks, and Passes:** A candidate cannot be discovered without completing onboarding, satisfying mutual spatial and demographic preferences, and clearing historical pass/block exclusions.
3. **Premium Features depend on Centralized Entitlements:** Capabilities like Undo, Who Liked You, Chat Media, and Unlimited Swipes depend directly on the subscription and entitlement engine.
4. **Payments depend on Subscription & Plan Taxonomy:** Razorpay checkout and webhook handlers mutate subscription states and refresh user entitlements.
5. **Admin Moderation depends on Users and Reports:** Administrative user actions (suspend, ban) cascade to active sessions, socket connections, and discovery indexing.

---

## 4. Phase 0 — Project Setup

### 4.1 Objectives
Establish a robust, standardized TypeScript backend project structure with complete development tooling, database drivers, spatial extensions, environment validation, logging, and automated test runners.

### 4.2 Implementation Tasks
1. **Initialize Node.js & TypeScript Project:**
   * Configure `package.json` with Node.js 20+ LTS engine constraints.
   * Configure `tsconfig.json` with strict mode enabled (`"strict": true`, `"noImplicitAny": true`, `"target": "ES2022"`, `"moduleResolution": "node"`).
2. **Configure Express & Core Middleware:**
   * Setup `src/app.ts` and `src/server.ts` with graceful startup and shutdown listeners.
   * Bind `helmet` for HTTP security headers (HSTS, CSP, X-Frame-Options).
   * Bind `cors` with explicit domain whitelisting and `credentials: true`.
   * Bind `express.json({ limit: '100kb' })` and parameter pollution prevention.
3. **Configure Environment Validation:**
   * Create `src/config/env.ts` using Zod to parse and validate all environment variables on boot (`PORT`, `DATABASE_URL`, `REDIS_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `AWS_*`, `RAZORPAY_*`).
   * Application must terminate immediately on startup if any required environment variable is invalid or missing.
4. **Configure Database & PostGIS Drivers:**
   * Setup Sequelize ORM instance (`src/config/database.ts`) with PostgreSQL connection pooling (`max: 20`, `min: 5`, `idle: 10000`).
   * Configure `sequelize-cli` and `.sequelizerc` pointing to `src/database/migrations` and `src/database/models`.
5. **Configure Redis Client:**
   * Initialize `src/config/redis.ts` using `ioredis` with automatic reconnection, health checking, and structured error handling.
6. **Configure Centralized Error Handling:**
   * Create base `AppError` class and standard operational subclasses (`ValidationError`, `UnauthorizedError`, `ForbiddenError`, `NotFoundError`, `ConflictError`, `RateLimitError`, `PaymentError`, `InternalServerError`).
   * Create `src/middleware/error.middleware.ts` to serialize errors into the standard JSON envelope, stripping internal traces in production.
7. **Configure Structured Logging:**
   * Implement `src/utils/logger.ts` (Winston or Pino) with JSON formatting, ISO timestamps, Correlation ID (`X-Request-ID`) binding, and automated redaction of sensitive keys (`password`, `token`, `secret`, `location`, `otp`).
8. **Configure Testing Harness:**
   * Setup `jest`, `ts-jest`, and `supertest` with dedicated test database configuration (`tests/setup.ts`).

### 4.3 Completion Criteria
* `npm run build` compiles TypeScript with zero errors.
* `GET /health` returns `{ "status": "UP", "database": "CONNECTED", "redis": "CONNECTED" }`.
* Centralized error middleware formats errors according to Section 8 of the API specification.
* Test runner executes sample test suite against isolated test environment.

---

## 5. Phase 1 — Database Foundation

### 5.1 Objectives
Construct all relational, spatial, and junction tables using sequential Sequelize migrations, define declarative TypeScript models with associations, and apply database-level check constraints, foreign keys, and indexes.

### 5.2 Migration Execution Sequence

```text
Migration 01: Extensions (postgis, uuid-ossp)
Migration 02: Dynamic Reference Tables (genders, interests, relationship_intentions)
Migration 03: Monetization Taxonomies (plans, features)
Migration 04: Core User Accounts (users, auth_refresh_tokens)
Migration 05: User Profile & Media (profiles, profile_photos)
Migration 06: Preference Junctions (dating_preferences, user_interests, user_relationship_intentions, user_dating_preference_genders, user_dating_preference_intentions)
Migration 07: Interactions & Safety (likes, matches, conversations, messages, blocks, reports, notifications)
Migration 08: Monetization & Usage (plan_features, usage_limits, subscriptions, payments, processed_webhooks, usage_records, user_credit_balances, credit_transactions, boost_sessions)
Migration 09: Reference Catalogs Seed Data (genders, intentions, plans, features, usage_limits)
```

### 5.3 Detailed Table Specifications & Models

#### 1. Reference & Identity Tables
* **`genders`:**
  * Model: `Gender` (`id`, `code`, `name`, `is_active`, `display_order`).
  * Constraints: `UQ(code)`.
  * Indexes: `idx_genders_active_order (is_active, display_order)`.
* **`interests`:**
  * Model: `Interest` (`id`, `code`, `name`, `category`, `is_active`, `display_order`).
  * Constraints: `UQ(code)`.
  * Indexes: `idx_interests_active_order (is_active, display_order)`.
* **`relationship_intentions`:**
  * Model: `RelationshipIntention` (`id`, `code`, `name`, `description`, `is_active`, `display_order`).
  * Constraints: `UQ(code)`.
* **`users`:**
  * Model: `User` (`id`, `email`, `phone`, `password_hash`, `role`, `status`, `email_verified`, `phone_verified`, `last_active_at`, `created_at`, `updated_at`, `deleted_at`).
  * Constraints: `chk_users_identifier_present` (`email IS NOT NULL OR phone IS NOT NULL`), `chk_users_role` (`USER`, `ADMIN`), `chk_users_status` (`UNVERIFIED`, `ACTIVE`, `SUSPENDED`, `BANNED`, `DELETED`).
  * Indexes: Partial unique `uq_users_email_active` on `(email)` where `deleted_at IS NULL`, partial unique `uq_users_phone_active` on `(phone)` where `deleted_at IS NULL`, `idx_users_status` on `(status)`.
* **`auth_refresh_tokens`:**
  * Model: `AuthRefreshToken` (`id`, `user_id`, `token_hash`, `device_info`, `ip_address`, `expires_at`, `revoked_at`, `replaced_by_hash`).
  * Foreign Keys: `user_id` $\rightarrow$ `users.id` (`ON DELETE CASCADE`).
  * Indexes: Unique `uq_auth_refresh_tokens_hash` on `(token_hash)`, `idx_auth_refresh_tokens_user_active` on `(user_id)` where `revoked_at IS NULL`.

#### 2. Profile & Spatial Tables
* **`profiles`:**
  * Model: `Profile` (`id`, `user_id`, `first_name`, `date_of_birth`, `gender_id`, `bio`, `occupation`, `education`, `city`, `location`, `is_profile_complete`).
  * Spatial Type: `location` as `geography(Point, 4326)`.
  * Constraints: `UQ(user_id)`, `chk_profiles_age_18_plus` (`date_of_birth <= CURRENT_DATE - INTERVAL '18 years'`).
  * Foreign Keys: `user_id` $\rightarrow$ `users.id` (`ON DELETE CASCADE`), `gender_id` $\rightarrow$ `genders.id` (`ON DELETE RESTRICT`).
  * Indexes: Spatial GiST index `idx_profiles_location_gist` on `(location)`, composite index `idx_profiles_discovery_eligibility` on `(is_profile_complete, gender_id, date_of_birth)`.
* **`profile_photos`:**
  * Model: `ProfilePhoto` (`id`, `user_id`, `storage_key`, `original_filename`, `mime_type`, `file_size_bytes`, `display_order`, `is_primary`, `deleted_at`).
  * Constraints: `chk_profile_photos_display_order` (`1..5`), `chk_profile_photos_file_size` (`<= 10485760`).
  * Indexes: Partial unique `uq_profile_photos_primary_per_user` on `(user_id)` where `is_primary = TRUE AND deleted_at IS NULL`, partial unique `uq_profile_photos_order_per_user` on `(user_id, display_order)` where `deleted_at IS NULL`.

#### 3. Preference Junctions
* **`dating_preferences`:** Model `DatingPreference` (`user_id`, `min_age`, `max_age`, `max_distance_km`). Constraints: `min_age >= 18`, `max_age <= 100`, `max_distance_km 1..500`.
* **`user_interests`:** Junction `UserInterest` (`user_id`, `interest_id`). Unique `(user_id, interest_id)`.
* **`user_relationship_intentions`:** Junction `UserRelationshipIntention` (`user_id`, `relationship_intention_id`). Unique `(user_id, relationship_intention_id)`.
* **`user_dating_preference_genders`:** Junction `UserDatingPreferenceGender` (`user_id`, `gender_id`). Unique `(user_id, gender_id)`.
* **`user_dating_preference_intentions`:** Junction `UserDatingPreferenceIntention` (`user_id`, `relationship_intention_id`). Unique `(user_id, relationship_intention_id)`.

#### 4. Interactions, Chat, Safety & Engagement
* **`likes`:** Model `Like` (`id`, `from_user_id`, `to_user_id`, `action`, `is_undone`). Constraints: `chk_likes_no_self_like`, `action IN ('LIKE', 'PASS', 'SUPER_LIKE')`. Indexes: Partial unique `uq_likes_active_pair` on `(from_user_id, to_user_id)` where `is_undone = FALSE`, `idx_likes_to_user_likers`, `idx_likes_reciprocal_check`.
* **`matches`:** Model `Match` (`id`, `user_one_id`, `user_two_id`, `status`, `matched_at`, `unmatched_at`, `unmatched_by_user_id`). Constraints: `chk_matches_canonical_order` (`user_one_id < user_two_id`), `status IN ('ACTIVE', 'UNMATCHED', 'UNDONE')`. Indexes: Partial unique `uq_matches_single_active_pair` on `(user_one_id, user_two_id)` where `status = 'ACTIVE'`.
* **`conversations`:** Model `Conversation` (`id`, `match_id`, `status`, `last_message_at`, `closed_at`). Unique `(match_id)`.
* **`messages`:** Model `Message` (`id`, `conversation_id`, `sender_id`, `message_type`, `content`, `media_storage_key`, `media_mime_type`, `media_file_size`, `read_at`, `deleted_at`). Constraints: `chk_messages_type`, `chk_messages_payload_integrity`. Indexes: `idx_messages_conversation_history` on `(conversation_id, created_at DESC)`.
* **`blocks`:** Model `Block` (`id`, `blocker_id`, `blocked_id`, `reason`). Constraints: `chk_blocks_no_self_block`, unique `(blocker_id, blocked_id)`. Indexes: Bidirectional lookup indexes `idx_blocks_lookup` and `idx_blocks_reverse_lookup`.
* **`reports`:** Model `Report` (`id`, `reporter_id`, `reported_user_id`, `reason`, `description`, `status`, `admin_notes`, `resolved_by`, `resolved_at`). Constraints: `chk_reports_reason`, `chk_reports_status`.
* **`notifications`:** Model `Notification` (`id`, `user_id`, `type`, `title`, `message`, `data`, `read_at`). Constraints: `chk_notifications_type`.

#### 5. Monetization, Subscriptions, Usage & Payments
* **`plans`**, **`features`**, **`plan_features`**: Monetization catalogs and junction mappings.
* **`subscriptions`**: Model `Subscription` (`id`, `user_id`, `plan_id`, `provider`, `provider_subscription_id`, `status`, `auto_renew`, `current_period_start`, `current_period_end`, `grace_period_end`, `canceled_at`, `ended_at`). Index: Partial unique `uq_subscriptions_single_active_per_user` on `(user_id)` where `status IN ('ACTIVE', 'PAST_DUE', 'GRACE_PERIOD')`.
* **`usage_limits`**: Model `UsageLimit` (`plan_id`, `metric_key`, `limit_value`, `period_type`).
* **`usage_records`**: Model `UsageRecord` (`user_id`, `metric_key`, `period_start`, `period_end`, `usage_count`).
* **`user_credit_balances`**, **`credit_transactions`**, **`boost_sessions`**: À la carte credits and visibility boost sessions.
* **`payments`**: Model `Payment` (`id`, `user_id`, `subscription_id`, `provider`, `provider_payment_id`, `provider_order_id`, `amount_in_cents`, `currency`, `status`, `payment_type`, `raw_payload`).
* **`processed_webhooks`**: Model `ProcessedWebhook` (`event_id`, `provider`, `event_type`, `payload`, `processed_at`). Primary key on `event_id`.

### 5.4 Completion Criteria
* All migrations execute forward (`sequelize db:migrate`) and revert cleanly (`sequelize db:migrate:undo:all`).
* Database seeds populate default genders, intentions, plans, features, and usage limits.
* All model associations and constraints pass automated schema validation tests.

---

## 6. Phase 2 — Authentication and Account Management

### 6.1 Objectives
Implement secure, dual-identifier registration (Email OR Phone), cryptographic password hashing, verification flows, dual-token JWT authentication with rotating refresh cookies, and administrative session revocation.

### 6.2 Implementation Steps
1. **User Data Access & Service:**
   * Create `src/modules/auth/auth.data-access.ts` and `src/modules/users/users.data-access.ts`.
   * Create `src/utils/crypto.ts` implementing Argon2id hashing and verification (`timeCost: 3`, `memoryCost: 65536`, `parallelism: 4`).
2. **Registration Endpoint (`POST /api/v1/auth/register`):**
   * Validate body with Zod: Email or E.164 Phone, password complexity, Date of Birth ($\ge 18$), explicit legal acceptance.
   * Verify identifier uniqueness; create `User` with `status = 'UNVERIFIED'`.
   * Generate 6-digit OTP / verification token and store in Redis (TTL: 300s).
3. **Verification Endpoints:**
   * `POST /api/v1/auth/verify-email`: Validates email token, sets `email_verified = TRUE`, transitions user status to `'ACTIVE'`.
   * `POST /api/v1/auth/verify-phone`: Validates 6-digit OTP, sets `phone_verified = TRUE`, transitions status to `'ACTIVE'`.
   * `POST /api/v1/auth/resend-verification`: Enforces 60-second cooldown via Redis rate-limiting keys.
4. **Login Endpoint (`POST /api/v1/auth/login`):**
   * Authenticate identifier + password using Argon2id. Mitigate timing attacks with dummy hashes for non-existent users.
   * Issue 15-minute Access Token JWT.
   * Generate cryptographically random 7-day Refresh Token, store SHA-256 hash in `auth_refresh_tokens`, and attach HTTP-Only, Secure, `SameSite=Strict` cookie (`path=/api/v1/auth/refresh`).
5. **Token Refresh & Rotation (`POST /api/v1/auth/refresh`):**
   * Read cookie, compute SHA-256 hash, query `auth_refresh_tokens`.
   * **Replay Attack Detection:** If token is already revoked, immediately invalidate **all** sessions for that `user_id`.
   * Otherwise, mark current token revoked, generate new pair, and return updated tokens.
6. **Logout Endpoint (`POST /api/v1/auth/logout`):**
   * Revoke active refresh token in PostgreSQL and clear client cookie.
7. **Password Recovery:**
   * `POST /api/v1/auth/forgot-password`: Generates generic success response to prevent account enumeration.
   * `POST /api/v1/auth/reset-password`: Validates reset token, updates password hash, revokes all existing refresh tokens.
8. **Authentication & Role Middleware:**
   * Implement `src/middleware/auth.middleware.ts`: Validates JWT signature and expiration, checks user status (`ACTIVE` vs `SUSPENDED`/`BANNED`), attaches `req.user`.
   * Implement `src/middleware/role.middleware.ts`: Enforces system role (`USER` vs `ADMIN`).

### 6.3 Security Enforcements
* Unverified users are blocked from dating, matching, and discovery APIs (`403 EMAIL_NOT_VERIFIED` / `403 PHONE_NOT_VERIFIED`).
* Banned or suspended accounts receive `403 ACCOUNT_BANNED` / `403 ACCOUNT_SUSPENDED`.

---

## 7. Phase 3 — Profile and Onboarding

**Phase 3 status (2026-10-05): complete.** Catalogs, basic profile HTTP, interests, relationship intentions, profile photos, dating preferences, location, onboarding status, and onboarding completion are implemented. **Phase 4 — Discovery is complete.** `GET /api/v1/discovery` is implemented. **Phase 5 — Likes, Passes and Matches is next and is not implemented.** Production interests are not seeded. `PATCH /api/v1/onboarding/profile`, `PUT /api/v1/location`, `PUT /api/v1/me/interests`, `PUT /api/v1/me/relationship-intentions`, `GET /api/v1/dating-preferences`, and `PUT /api/v1/dating-preferences` are not mounted.

Implemented in Step 1:

* Public `GET /api/v1/genders`, `GET /api/v1/interests`, and `GET /api/v1/relationship-intentions`. No authentication. Shared public rate limit of 100 requests / 60 seconds / IP (`ratelimit:public:<ip>`). Active rows only, ordered by `display_order`.
* Sequelize seeders for the approved genders (`MAN`, `WOMAN`, `NON_BINARY`, `PREFER_NOT_TO_SAY`) and relationship intentions (`LONG_TERM_RELATIONSHIP`, `SOMETHING_CASUAL`, `FRIENDSHIP`, `NOT_SURE_YET`).
* No production interest seed. The approved interest list is not defined. `GET /api/v1/interests` returns an empty array until rows exist.

Implemented in Step 2:

* `profiles.city` and `profiles.location` are nullable so a basic profile can be stored before location. The column type remains `geography(Point, 4326)`. The GiST index and `chk_profiles_age_18_plus` are unchanged.
* `src/modules/profiles/profiles.data-access.ts` can find a profile by user id (with gender `id`, `code`, and `name`), create a partial profile, and update `firstName`, `dateOfBirth`, `genderId`, `bio`, `occupation`, and `education`.
* Creation does not accept `isProfileComplete`. A partial profile stays `is_profile_complete = FALSE`. Completion still requires both city and location, and is not implemented in this step.

Implemented in Step 3:

* Authenticated `GET`, `POST`, and `PATCH /api/v1/profile` for the signed-in `USER` only. Ownership comes from `req.user.id`.
* Create and update accept `firstName`, `dateOfBirth`, `genderId`, `bio`, `occupation`, and `education`. `genderId` must be an active catalog gender. Age uses the existing UTC 18+ check. `chk_profiles_age_18_plus` remains the database safeguard.
* The client cannot set `userId`, `isProfileComplete`, `city`, `location`, interests, intentions, preferences, or photos. A missing profile is `404 PROFILE_NOT_FOUND`. A second create is `409 PROFILE_ALREADY_EXISTS`. An empty `PATCH` is `400 VALIDATION_ERROR`.
* A basic profile stays `is_profile_complete = false` because city, location, photos, interests, intentions, and dating preferences are still required. This step does not set the flag to true and does not clear a flag that is already true.

Implemented for interest and relationship-intention selection:

* `PUT /api/v1/onboarding/interests` replaces `user_interests` for the authenticated `USER`. `interestIds` is 3 to 10 unique active interest UUIDs.
* `PUT /api/v1/onboarding/relationship-intentions` replaces `user_relationship_intentions` for the authenticated `USER`. `relationshipIntentionIds` is at least 1 unique active intention UUID. There is no maximum.
* Ownership is `req.user.id`. `userId` is rejected. Unknown, inactive, and duplicate ids are rejected. Delete and insert run in one Sequelize transaction.
* `PUT /api/v1/me/interests` and `PUT /api/v1/me/relationship-intentions` are not implemented.
* These routes do not change `profiles.is_profile_complete`.

Implemented for dating preferences:

* `PUT /api/v1/onboarding/dating-preferences` replaces the authenticated `USER`'s `dating_preferences`, `user_dating_preference_genders`, and `user_dating_preference_intentions` in one transaction.
* `minAge` is an integer of at least 18. `maxAge` is an integer of at most 100 and at least `minAge`. `maxDistanceKm` is an integer from 1 to 500.
* `interestedInGenderIds` and `preferredIntentionIds` are UUID arrays with no minimum or maximum count. Empty arrays are valid and clear the matching junction rows. Duplicates, unknown ids, and inactive ids are rejected.
* The response returns the stored age range, distance, and catalog objects `{ "id", "code", "name" }`. This route does not write `user_relationship_intentions` or `profiles.is_profile_complete`.
* `GET /api/v1/dating-preferences` and `PUT /api/v1/dating-preferences` are not implemented.

Not implemented in this phase: public profile views, `PATCH /api/v1/onboarding/profile`, `PUT /api/v1/location`, `GET /api/v1/dating-preferences`, and `PUT /api/v1/dating-preferences`. Discovery, likes, matches, and chat remain later phases. Profile photos, location, onboarding status, and onboarding completion are implemented. Plans, features, and usage limits are still unseeded. Production interests are not seeded.

### 7.1 Objectives
Implement the linear onboarding sequence, demographic metadata management, S3 presigned photo upload pipeline, dating preferences, and profile completion validation.

### 7.2 Linear Onboarding Pipeline

```text
[Step 1: Basic Profile] ──► [Step 2: Photos (1-5)] ──► [Step 3: Interests (3-10)]
                                                               │
[Step 6: Complete] ◄── [Step 5: Location] ◄── [Step 4: Dating Preferences]
```

### 7.3 Implementation Steps
1. **Onboarding Status Tracker (`GET /api/v1/onboarding/status`):** **Implemented.**
   * Returns `isVerified`, the stored `isProfileComplete`, `completedSteps`, and `nextStep`. It does not write `profiles.is_profile_complete`.
   * Step order: `VERIFICATION`, `BASIC_PROFILE`, `PHOTOS`, `INTERESTS`, `RELATIONSHIP_INTENTIONS`, `DATING_PREFERENCES`, `LOCATION`, then `COMPLETE`.
   * When steps 1–7 are satisfied and the stored flag is still false, `nextStep` is `COMPLETE`. When the stored flag is true, `nextStep` is `null`.
2. **Basic Profile Step:** **Implemented** as `GET`, `POST`, and `PATCH /api/v1/profile`. `PATCH /api/v1/onboarding/profile` is not mounted.
   * Writable fields are `firstName`, `dateOfBirth`, `genderId`, `bio`, `occupation`, and `education`. `dateOfBirth` is stored here, not at registration, and can be updated.
   * The client cannot set `isProfileComplete`. These routes do not complete onboarding.
3. **AWS S3 Photo Upload Pipeline:** **Implemented.**
   * `src/integrations/storage/s3.provider.ts` signs private `PutObject` and `GetObject` URLs. It does not delete objects and does not set a public ACL. Credentials come from the AWS SDK default provider chain. `AWS_REGION` and `AWS_S3_BUCKET_NAME` are required in production and optional in development and test.
   * `POST /api/v1/profile-photos/upload-url`: Validates MIME type (`image/jpeg`, `image/png`, `image/webp`), size (1 to 10 MB), and active photo count (`< 5`). Generates a 300-second presigned `PutObject` URL for `photos/{userId}/{uuid}.webp`. Stores a Redis reservation. Does not insert `profile_photos`.
   * `POST /api/v1/profile-photos/confirm`: Inserts the `profile_photos` row from that reservation inside a transaction. The client storage key must match the server key. The reservation is removed only after commit.
   * `GET /api/v1/profile-photos`: Lists the caller's active photos with 3600-second presigned GET URLs.
   * `PATCH /api/v1/profile-photos/:photoId`: Updates `displayOrder` or `isPrimary` for the caller's active photo.
   * `DELETE /api/v1/profile-photos/:photoId`: Soft-deletes the photo. A completed profile cannot drop to zero photos. Deleting the primary promotes the lowest remaining `displayOrder`. The S3 object stays until a later purge job.
   * These routes do not set `profiles.is_profile_complete`.
4. **Interests & Intentions Setup:**
   * **Implemented:** `PUT /api/v1/onboarding/interests` validates an array of active interest UUIDs (**min 3, max 10**, no duplicates) and replaces `user_interests` in one transaction.
   * **Implemented:** `PUT /api/v1/onboarding/relationship-intentions` validates an array of active intention UUIDs (**min 1**, no duplicates, no maximum) and replaces `user_relationship_intentions` in one transaction.
   * **Not implemented:** `PUT /api/v1/me/interests` and `PUT /api/v1/me/relationship-intentions`. These routes do not set `profiles.is_profile_complete`.
5. **Dating Preferences Setup (`PUT /api/v1/onboarding/dating-preferences`):** **Implemented.**
   * Validates `minAge >= 18`, `maxAge <= 100`, `maxAge >= minAge`, `maxDistanceKm` (1–500 km), `interestedInGenderIds`, and `preferredIntentionIds`.
   * Neither id list has a minimum or maximum count. An empty list clears that junction.
   * Creates or updates `dating_preferences`, then replaces `user_dating_preference_genders` and `user_dating_preference_intentions` in one transaction.
   * Does not write `user_relationship_intentions` and does not set `profiles.is_profile_complete`.
   * `GET /api/v1/dating-preferences` and `PUT /api/v1/dating-preferences` are not this step.
6. **Location Setup (`PUT /api/v1/onboarding/location`):** **Implemented.** `PUT /api/v1/location` is not mounted.
   * Captures trimmed `city` (1–100), `latitude` (-90 to 90), and `longitude` (-180 to 180). A profile row must already exist.
   * Stores as PostGIS geography Point: `ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography` in `profiles.location`.
   * API response returns `{ "city": "...", "updated": true }` with zero coordinate reflections. It does not set `profiles.is_profile_complete`.
7. **Onboarding Finalization (`POST /api/v1/onboarding/complete`):** **Implemented.** `requireVerified` is not applied.
   * Requires all seven prerequisites: verification, a profile row, 1–5 active photos with one primary, 3–10 own interests, at least one own relationship intention, a `dating_preferences` row, and a non-blank city plus a non-null point.
   * Incomplete requests return `400 PROFILE_INCOMPLETE` with every missing step in `details`. Nothing is written.
   * Success sets only `profiles.is_profile_complete = TRUE` and returns `{ "isProfileComplete": true, "status": "<users.status>" }`. It does not change `users.status`, does not issue a JWT, and is idempotent.
8. **Profile Views:** **Not implemented.** These are not part of the completed onboarding API.
   * `GET /api/v1/profiles/me`: Returns private profile with signed photo CDN URLs.
   * `GET /api/v1/profiles/:userId`: Returns public candidate profile, verifies bidirectional block state, and computes server-side `distanceKm`.

---

## 8. Phase 4 — Discovery and Location

**Phase 4 status (2026-10-05): complete.** The live route is `GET /api/v1/discovery`. The response contract is section 19 of `03-api-specification.md`. Like, pass, super-like, undo, and match creation are Phase 5 and are not implemented.

### 8.1 Objectives
Deliver one mutually eligible candidate card with PostGIS `ST_DWithin`, strict exclusion, mutual preference filtering, and boost ranking.

### 8.2 Implemented behavior
1. **Single-card endpoint (`GET /api/v1/discovery`):** Returns one candidate, or `{ "candidate": null }` when nobody qualifies. There is no cursor, offset, or seen-state. A repeat call can return the same candidate until eligibility or ranking changes. Browsing does not consume a like or pass quota.
2. **Authentication:** `authenticate` and `requireRole('USER')`. `requireVerified` is not on the route. The service checks the current verification state and returns `403 EMAIL_NOT_VERIFIED` or `403 PHONE_NOT_VERIFIED`. A missing profile, an incomplete profile, missing dating preferences, or a missing location returns `400 PROFILE_INCOMPLETE`.
3. **Eligibility:** The candidate is a different `ACTIVE` user, is not soft-deleted, has a completed profile, a non-null location, and an active primary photo. The viewer's active `LIKE`, `PASS`, or `SUPER_LIKE` excludes the candidate while `is_undone = false`. An undone action does not. An incoming `PASS` does not. An `ACTIVE` match excludes the pair. `UNMATCHED` and `UNDONE` matches do not. A block in either direction excludes the pair. Reports are not part of the query.
4. **Mutual filters:** Both distance radii, both age ranges, both gender lists, and both relationship-intention overlaps. `ST_DWithin` and age `BETWEEN` are inclusive. Age is completed years. An empty preferred-gender list or an empty preferred-intention list produces no candidate.
5. **Ranking:** Highest active boost multiplier, then `profiles.created_at DESC`, limit 1. Active means `is_active = true` and `expires_at > CURRENT_TIMESTAMP`. Several active boosts use the highest multiplier. No active boost uses `1.0`.
6. **Response:** `distanceKm` is a number rounded to one decimal place. Coordinates, `location`, and `storageKey` are omitted. Photo URLs are private signed download URLs. The card includes the candidate's own interests and own relationship intentions.

---

## 9. Phase 5 — Likes, Passes and Matches

**Next phase. Not implemented.** Do not treat the steps below as a built API.

### 9.1 Objectives
Implement swipe action mechanics (`LIKE`, `PASS`, `SUPER_LIKE`), daily action quota tracking for Free users, race-condition-free mutual matching, single-level Premium Undo, and clean Unmatching/Re-matching lifecycles.

### 9.2 Implementation Details

#### 1. Like Action (`POST /api/v1/discovery/:userId/like`)
* **Eligibility & Quota:**
  * Free users: Verifies and atomically increments daily combined Like/Pass quota via `usage_records` (`limit: 10`). Throws `429 DAILY_LIMIT_REACHED` when exhausted.
  * Premium users: Unlimited actions.
* **Concurrency-Safe Mutual Match Transaction:**
  ```text
  [BEGIN TRANSACTION]
    1. Lock reciprocal like:
       SELECT * FROM likes WHERE from_user_id = targetUserId AND to_user_id = currentUserId AND is_undone = FALSE FOR UPDATE;
    2. Insert current like:
       INSERT INTO likes (from_user_id, to_user_id, action = 'LIKE');
    3. IF Reciprocal Like EXISTS ('LIKE' or 'SUPER_LIKE'):
         - Canonical IDs: lowId = LEAST(A, B), highId = GREATEST(A, B)
         - INSERT INTO matches (user_one_id = lowId, user_two_id = highId, status = 'ACTIVE');
         - INSERT INTO conversations (match_id, status = 'ACTIVE');
         - Trigger "NEW_MATCH" notification & Socket.IO event to both users.
       ELSE:
         - Trigger "NEW_LIKE" notification to target user (masked/censored if target is Free).
  [COMMIT TRANSACTION]
  ```

#### 2. Pass Action (`POST /api/v1/discovery/:userId/pass`)
* Consumes 1 from combined 10 daily quota for Free users.
* Records permanent pass in `likes (from_user_id, to_user_id, action = 'PASS')`. Excludes candidate permanently from future discovery.

#### 3. Premium Undo Action (`POST /api/v1/discovery/undo`)
* **Entitlement Check:** Requires active `UNDO_ACTION` entitlement (Free users receive `403 PREMIUM_REQUIRED`).
* **Execution Boundary:** Reverses the **immediately preceding** Like or Pass action performed within a 5-minute window.
* **Transaction Rollback:**
  * Sets `likes.is_undone = TRUE` on the target record.
  * If the action triggered an active match: updates `matches.status = 'UNDONE'`, closes the conversation (`conversations.status = 'CLOSED'`), and invalidates active match notifications.
  * Undo does not consume daily swipe quotas.

#### 4. Unmatch Action (`DELETE /api/v1/matches/:matchId`)
* Transitions `matches.status = 'UNMATCHED'`, records `unmatched_at = CURRENT_TIMESTAMP` and `unmatched_by_user_id = req.user.id`.
* Closes conversation (`conversations.status = 'CLOSED'`).
* Preserves message history in PostgreSQL for safety/audit compliance.
* **Re-matching Support:** The unique index `uq_matches_single_active_pair` permits a pair to match again in the future without database constraint collisions.

---

## 10. Phase 6 — Chat and Realtime Messaging

### 10.1 Objectives
Build real-time messaging using Socket.IO backed by PostgreSQL persistence, enforce 6-step message authorization, manage unread counters, support tiered media attachments, and provide cursor-based history pagination.

### 10.2 Implementation Steps
1. **Socket.IO Server Initialization (`src/socket/socket.server.ts`):**
   * Bind Socket.IO to the Express HTTP server with Redis adapter (`@socket.io/redis-adapter`) for horizontal multi-node scaling.
   * `socket.auth.ts`: Middleware validates JWT access token on handshake; binds `socket.data.user`.
   * Automatically join user private room: `user:{userId}`.
2. **6-Step Message Authorization Verification (`chat.service.ts`):**
   * **Step 1:** Verify sender authentication (`req.user.id`).
   * **Step 2:** Verify conversation exists and sender is a participant of the backing match.
   * **Step 3:** Verify backing match is strictly `status = 'ACTIVE'`.
   * **Step 4:** Verify no active bidirectional safety block exists.
   * **Step 5 (Entitlement Check):** Free tier is restricted strictly to `TEXT` messages. Rich media (`IMAGE`, `GIF`, `VIDEO`, `VOICE`) requires `CHAT_MEDIA` entitlement (throws `403 PREMIUM_REQUIRED` for Free users).
   * **Step 6 (Quota Check):** Free tier enforced at maximum **20 outgoing text messages/day** via `usage_records`. Premium users get unlimited messages.
3. **Message Persistence & Realtime Broadcast:**
   * Persist message in PostgreSQL `messages` table (`conversation_id`, `sender_id`, `message_type`, `content`, `media_storage_key`).
   * Update `conversations.last_message_at = CURRENT_TIMESTAMP`.
   * Broadcast `chat:message:new` event to conversation room `conversation:{conversationId}` and emit push/in-app alert to recipient.
4. **Message History & Read Receipts:**
   * `GET /api/v1/conversations/:conversationId/messages`: Cursor-paginated history sorted by `created_at DESC`.
   * `PATCH /api/v1/conversations/:conversationId/read`: Updates `read_at = CURRENT_TIMESTAMP` for unread messages and emits `chat:message:read` Socket.IO event.

---

## 11. Phase 7 — Safety and Moderation

### 11.1 Objectives
Implement instant bidirectional user blocking and auditable misconduct reporting with administrative queue triaging.

### 11.2 Implementation Steps
1. **Bidirectional Blocking (`POST /api/v1/blocks/:userId`):**
   * Creates record in `blocks` (`blocker_id`, `blocked_id`, `reason`).
   * Inside a managed transaction:
     * Immediately dissolves any active match between the pair (`matches.status = 'UNMATCHED'`).
     * Closes open conversation threads (`conversations.status = 'CLOSED'`).
     * Emits `match:unmatch` Socket.IO event to disconnect active chat sessions.
   * `GET /api/v1/blocks`: Returns list of blocked accounts.
   * `DELETE /api/v1/blocks/:userId`: Removes block record.
2. **Misconduct Reporting (`POST /api/v1/reports`):**
   * Validates mandatory reason code (`FAKE_PROFILE`, `HARASSMENT`, `SPAM`, `INAPPROPRIATE_CONTENT`, `SCAM`, `OTHER`) and optional description.
   * Inserts into `reports` table (`status = 'PENDING'`).
   * **Confidentiality Rule:** The reported account is never notified of the report or the reporter's identity.

---

## 12. Phase 8 — Subscription and Entitlements

### 12.1 Objectives
Construct the centralized Entitlement and Usage engine, defining subscription plans (`FREE`, `PREMIUM_MONTHLY`, `PREMIUM_YEARLY`), feature keys, quota limiters, à la carte credit balances, and grace period lifecycles.

### 12.2 Entitlement Architecture
```text
User ──► Active Subscription ──► Plan ──► PlanFeatures ──► UsageLimits ──► UsageRecords
```

### 12.3 Implementation Steps
1. **Entitlement Service (`src/modules/entitlements/entitlements.service.ts`):**
   * Centralized method: `hasEntitlement(userId, featureCode): Promise<boolean>`.
   * Centralized method: `checkAndIncrementUsage(userId, metricKey, cost = 1): Promise<{ allowed: boolean, remaining: number }>`.
2. **Entitlement Matrix Configuration:**

| Feature / Limit | Free Tier | Premium Monthly / Yearly |
| :--- | :--- | :--- |
| **`DAILY_LIKE_PASS`** | 10 combined actions / day | Unlimited (`-1`) |
| **`DAILY_TEXT_MESSAGES`** | 20 messages / day | Unlimited (`-1`) |
| **`UNDO_ACTION`** | Disabled | Enabled |
| **`SEE_WHO_LIKED_YOU`** | Blurred Count Only | Full Profile Unlocked |
| **`CHAT_MEDIA`** | Disabled | Enabled |
| **`ADVANCED_FILTERS`** | Disabled | Enabled |
| **`AD_FREE`** | Disabled | Enabled |
| **`PRIORITY_VISIBILITY`** | Standard (1.0x) | Enhanced (Configurable Multiplier) |
| **`MONTHLY_SUPER_LIKES`** | 0 | 5 / month |
| **`MONTHLY_BOOST_CREDITS`**| 0 | 1 / month |

3. **Usage Tracking Ledger (`usage_records`):**
   * Atomic PostgreSQL execution:
     ```sql
     INSERT INTO usage_records (id, user_id, metric_key, period_start, period_end, usage_count)
     VALUES (gen_random_uuid(), :userId, :metricKey, :startOfDay, :endOfDay, 1)
     ON CONFLICT (user_id, metric_key, period_start)
     DO UPDATE SET usage_count = usage_records.usage_count + 1, updated_at = CURRENT_TIMESTAMP
     RETURNING usage_count;
     ```
4. **Credit Balances & Boost Sessions:**
   * Manage consumable credits via `user_credit_balances` and `credit_transactions`.
   * `POST /api/v1/boost/start`: Activates 30-minute visibility boost in `boost_sessions`.

---

## 13. Phase 9 — Payments and Razorpay

### 13.1 Objectives
Implement the decoupled payment gateway provider abstraction, server-side Razorpay order generation, HMAC-SHA256 signature verification, and idempotent webhook processing.

### 13.2 Payment Provider Abstraction
* `src/integrations/payment/payment.interface.ts`:
  ```typescript
  export interface IPaymentProvider {
    createOrder(plan: Plan, user: User): Promise<PaymentOrderResult>;
    verifySignature(params: VerifyPaymentParams): boolean;
    cancelSubscription(providerSubscriptionId: string): Promise<boolean>;
    handleWebhook(rawPayload: Buffer, signature: string): Promise<WebhookEventResult>;
  }
  ```
* `src/integrations/payment/razorpay.provider.ts`: Official Razorpay implementation.

### 13.3 Implementation Steps
1. **Checkout Session Creation (`POST /api/v1/payments/checkout`):**
   * Validates `planId`. **Authoritative price is resolved directly from PostgreSQL `plans` table** (client-supplied prices are strictly ignored).
   * Generates Razorpay Order / Subscription entity; returns gateway credentials to client.
2. **Client Verification Handshake (`POST /api/v1/payments/verify`):**
   * Validates HMAC-SHA256 signature using `RAZORPAY_KEY_SECRET`.
3. **Webhook Processing Engine (`POST /api/v1/webhooks/razorpay`):**
   * Validates `X-Razorpay-Signature` against raw request buffer.
   * **Atomic Deduplication:** Inserts `event.id` into `processed_webhooks`. Duplicate events return `200 OK` immediately.
4. **Subscription Lifecycle Event Handlers:**
   * `subscription.activated` $\rightarrow$ Inserts/Updates `subscriptions` (`status = 'ACTIVE'`), refreshes entitlements.
   * `subscription.charged` $\rightarrow$ Inserts invoice in `payments`, updates `current_period_end`.
   * `payment.failed` $\rightarrow$ Sets `subscriptions.status = 'PAST_DUE'`, triggers **24-hour grace window** (`grace_period_end = CURRENT_TIMESTAMP + 24h`).
   * `subscription.cancelled` $\rightarrow$ Sets `auto_renew = FALSE`. Benefits remain active until `current_period_end`.
   * `subscription.completed` / Grace Expiry $\rightarrow$ Sets `status = 'EXPIRED'`, downgrades user to Free tier.
5. **Subscription Background Reconciliation Job:**
   * Scheduled cron job (`src/jobs/subscription-reconciliation.job.ts`) checks for expired grace periods and transitions unrecovered accounts to `EXPIRED`.

---

## 14. Phase 10 — Notifications

### 14.1 Objectives
Implement the transaction-driven in-app notification queue and enforce strict server-side liker identity redaction on the "Who Liked You" API.

### 14.2 Implementation Steps
1. **Notification Dispatch Service (`notifications.service.ts`):**
   * Dispatches events: `NEW_MATCH`, `NEW_MESSAGE`, `NEW_LIKE`.
   * Stores records in PostgreSQL `notifications` table.
   * Emits realtime Socket.IO event `notification:new` to `user:{userId}`.
2. **Notification Feed API (`GET /api/v1/notifications`):**
   * Cursor-paginated user notification feed.
3. **"Who Liked You" Admirers Feed (`GET /api/v1/likes/who-liked-me`):**
   * **Free User Response:**
     ```json
     {
       "success": true,
       "data": { "count": 5, "isUnlocked": false, "admirers": [] },
       "message": "5 people liked your profile! Upgrade to Premium to see who."
     }
     ```
     *Server-Side Privacy Mandate: Zero admirer IDs, names, or photo URLs are serialized for Free users.*
   * **Premium User Response:** Returns full admirer profiles, photos, and calculated distances.

---

## 15. Phase 11 — Admin APIs

### 15.1 Objectives
Build administrative moderation, user management, reference taxonomy configuration, and platform KPI analytics.

### 15.2 Implementation Steps (All routes require `role: ADMIN`)
1. **User Management:**
   * `GET /api/v1/admin/users`: Offset-paginated user directory with search and status filtering.
   * `GET /api/v1/admin/users/:userId`: Full profile inspection, photo review, and moderation history.
   * `PATCH /api/v1/admin/users/:userId/status`: Suspends, bans, or restores accounts.
2. **Moderation Queue:**
   * `GET /api/v1/admin/reports`: Triage queue filtered by `status = 'PENDING'`.
   * `PATCH /api/v1/admin/reports/:reportId`: Resolves report, records administrative notes, and executes disciplinary actions.
3. **Dynamic Taxonomy Management:**
   * CRUD endpoints for `/api/v1/admin/config/genders`, `interests`, `relationship-intentions`, and `plans`.
4. **Platform KPI Dashboard (`GET /api/v1/admin/dashboard/stats`):**
   * Aggregates total registered users, active matches, daily swipe volume, active subscriptions, and pending report counts.
5. **Audit Logging:**
   * Structured audit logging for all administrative state modifications (`adminId`, `targetId`, `action`, `reason`, `timestamp`).

---

## 16. Phase 12 — Security Hardening

### 16.1 Objectives
Verify and enforce all security baselines documented in `backend/docs/04-security.md`.

### 16.2 Security Checklist & Verification Tasks
* [ ] **Argon2id Hashing:** Verify parameters (`timeCost: 3, memoryCost: 65536, parallelism: 4`).
* [ ] **JWT Dual-Token Security:** Verify 15-minute access token lifespan and single-use refresh token rotation with reuse detection.
* [ ] **IDOR & Mass Assignment Defense:** Verify all mutating endpoints enforce resource ownership (`resource.user_id === req.user.id`) and Zod attribute stripping.
* [ ] **Anti-Trilateration Spatial Security:** Verify `profiles.location`, latitude, and longitude are excluded from API outputs. Live Discovery returns numeric `distanceKm` rounded to one decimal place.
* [ ] **S3 Bucket Hardening:** Verify public access is blocked, object keys use server-generated UUIDs, and MIME types/file sizes are strictly validated.
* [ ] **Payment Security:** Verify Razorpay HMAC-SHA256 signature verification and webhook idempotency via `processed_webhooks`.
* [ ] **Rate Limiting:** Verify Redis sliding-window limiters on authentication, OTP generation, swiping, and chat endpoints.
* [ ] **Logging Redaction:** Verify sensitive parameters are automatically filtered from log streams.

---

## 17. Phase 13 — Testing and Quality Assurance

### 17.1 Objectives
Execute a rigorous multi-tier testing strategy covering unit, integration, and critical end-to-end user flows.

Backend CI already runs the current build, Jest suite, and PostgreSQL/PostGIS integration tests on `develop`. The remaining suites in this phase, including end-to-end flows, are not implemented. CI does not include linting, formatting, coverage gates, or a security scanner.

### 17.2 Testing Breakdown

```text
┌─────────────────────────────────────────────────────────────┐
│                 E2E Flows (Critical Paths)                  │
│       Registration ──► Onboarding ──► Swipe ──► Match       │
├─────────────────────────────────────────────────────────────┤
│             Integration Tests (Supertest + DB)              │
│       API Contracts, Spatial Queries, Webhook Idempotency   │
├─────────────────────────────────────────────────────────────┤
│                 Unit Tests (Services & Pure)                │
│       Entitlement Evaluator, Crypto, Quota Math, DTOs       │
└─────────────────────────────────────────────────────────────┘
```

### 17.3 Mandatory Integration Test Suites
1. **Auth & Session Suite:** Registration, dual-identifier verification, login, refresh token rotation, replay attack detection, and remote logout.
2. **Profile & Photos Suite:** Onboarding pipeline progression, S3 presigned URL generation, photo reordering, and profile completion rules.
3. **Discovery & PostGIS Suite:** Spatial proximity calculations (`ST_DWithin`), mutual demographic filtering, Boost ranking weights, and block/pass exclusions.
4. **Interaction & Matching Concurrency Suite:** Concurrent double-like race handling, atomic quota increments, and Premium Undo transaction rollbacks.
5. **Chat & Realtime Suite:** 6-step authorization verification, daily message limit enforcement, and Socket.IO message routing.
6. **Payment & Webhook Suite:** HMAC signature validation, idempotent duplicate event delivery, grace period transitions, and plan switching.
7. **Admin Security Suite:** Role authorization guardrails and moderation queue workflows.

---

## 18. Phase 14 — Production Readiness

Backend CI is implemented and verified. Continuous deployment is not. No deployment target has been selected, and Docker or other deployment infrastructure has not been added. The checklist below remains future work. Do not treat the GitHub Actions workflow as a completed deployment.

### 18.1 Operational Checklist

#### 1. Application & Runtime
* [ ] Set `NODE_ENV=production`.
* [ ] Validate all required environment variables on startup.
* [ ] Verify health check endpoint `GET /health`.
* [ ] Configure graceful shutdown handlers for `SIGTERM` and `SIGINT`.

#### 2. PostgreSQL & PostGIS
* [ ] Execute and verify all production migrations.
* [ ] Confirm GiST spatial indexes and partial unique indexes are active.
* [ ] Configure connection pooling and SSL transport (`sslmode=require`).
* [ ] Setup automated database backup and point-in-time recovery.

#### 3. Redis Cache & PubSub
Redis remains in the application for current authentication and rate-limit behaviour. CI does not start a Redis service. Redis hardening remains deferred.
* [ ] Configure Redis connection clustering / replication and persistent failover.
* [ ] Verify memory eviction policies and key TTLs.

#### 4. AWS S3 Storage
* [ ] Enable `Block Public Access = TRUE` on S3 private photo bucket.
* [ ] Configure AWS KMS server-side encryption.
* [ ] Verify presigned URL expiration windows (Upload: 300s, Download: 1 hour).

#### 5. Payments & Webhooks
* [ ] Configure live Razorpay API keys and webhook secrets.
* [ ] Register public HTTPS webhook endpoint with Razorpay dashboard.

#### 6. Observability & Monitoring
* [ ] Connect structured JSON logs to CloudWatch / Datadog.
* [ ] Configure error tracking (Sentry) with sensitive data redaction.
* [ ] Setup alerting for rate-limit breaches, payment webhook failures, and unhandled 500 errors.

---

## 19. Recommended Implementation Order

To maintain strict adherence to dependency constraints, development should follow this sequential 34-step roadmap:

```text
 1. Project Initialization (Node.js, TypeScript, Express, Config)
 2. Environment Configuration & Zod Validation Engine
 3. Database Infrastructure (Sequelize, PostgreSQL, PostGIS Extensions)
 4. Base Migrations (Extensions, Reference Catalogs, Plans, Features)
 5. Core Identity Schema (Users, Auth Refresh Tokens)
 6. Authentication Module (Argon2id, Registration, OTP Verification, Login, JWT, Refresh Rotation)
 7. Authentication & Role Middleware (auth.middleware, role.middleware)
 8. Profile & Spatial Schema (Profiles, PostGIS Geography, Profile Photos)
 9. S3 Storage Integration & Presigned URL Photo Management
10. Preference Schemas & Junctions (Dating Preferences, Interests, Intentions)
11. Linear Onboarding Engine & Profile Completion Validation
12. Location Services & Coordinate Obfuscation Pipeline
13. Spatial Discovery Engine (PostGIS ST_DWithin Query, Exclusion Filters)
14. Likes & Passes Schema (Likes Table, Check Constraints, Partial Indexes)
15. Swiping Service & Free Daily Quota Tracking (10 Actions/Day)
16. Matches & Canonical Pair Architecture (Matches Table, Canonical ID Sorting)
17. Mutual Matching Transaction Pipeline (Reciprocal Check, Match Creation)
18. Premium Undo Service (Single-Level Stack, Match Reversion)
19. Unmatch & Rematch Lifecycle Management
20. Conversations & Messages Schema (Conversations, Messages Tables)
21. Chat Service & 6-Step Message Authorization Engine
22. Socket.IO Realtime Engine (Redis Adapter, Handshake Auth, Rooms)
23. Safety Module (Blocks Table, Bidirectional Isolation, Reports Table)
24. Notification Engine (Notifications Table, Realtime Dispatch)
25. "Who Liked You" Admirers Feed (Server-Side Masking for Free Tier)
26. Subscription & Entitlements Engine (Plans, Features, Usage Limits, Usage Records)
27. Payment Abstraction Layer & Razorpay Provider Integration
28. Razorpay Checkout & Client Handshake Verification
29. Razorpay Webhook Processing Engine (HMAC Verification, Idempotency Ledger)
30. Subscription Lifecycle State Machine (Auto-Renewal, 24-Hour Grace Period, Downgrade)
31. Admin Management APIs (User Directory, Moderation Queue, Config, Dashboard KPI)
32. Security Hardening & Penetration Testing (Rate Limits, Helmet, CORS, IDOR)
33. Comprehensive Automated Test Suite Execution (Unit, Integration, E2E)
34. Production Readiness Verification (Health Checks, Graceful Shutdown, Monitoring)
```

---

## 20. Feature Dependency Matrix

| Feature | Upstream Dependencies | Database Tables Involved | Primary API Endpoints | Automated Test Scope |
| :--- | :--- | :--- | :--- | :--- |
| **Authentication** | Phase 0 Setup | `users`, `auth_refresh_tokens` | `/auth/register`, `/auth/login`, `/auth/refresh`, `/auth/logout` | Unit + Integration (Auth, Token Rotation) |
| **Verification** | Auth Module | `users`, Redis OTP Cache | `/auth/verify-email`, `/auth/verify-phone`, `/auth/resend-verification` | Integration (OTP TTL, Rate Limits) |
| **Onboarding** | Auth, Verification | `profiles`, `dating_preferences`, `user_interests`, `user_relationship_intentions` | `/onboarding/*`, `/onboarding/complete` | Integration (Linear Stage Validation) |
| **Photos (S3)** | Profile Module, AWS S3 | `profile_photos` | `/profile-photos/upload-url`, `/profile-photos/confirm`, `/profile-photos/:photoId` | Unit (S3 Mock) + Integration (Limits) |
| **Location** | Profile Module, PostGIS | `profiles` (PostGIS `location`) | `/location`, `/onboarding/location` | Integration (PostGIS Point Storage) |
| **Discovery** | Profiles, Preferences, Location, Blocks, Passes | `profiles`, `dating_preferences`, `likes`, `matches`, `blocks`, `boost_sessions` | `GET /discovery` (implemented) | Integration (PostGIS `ST_DWithin`, mutual filters, exclusions, boost ranking) |
| **Likes & Passes** | Discovery, Entitlements | `likes`, `usage_records` | `POST /discovery/:userId/like`, `POST /discovery/:userId/pass` | Integration (Quotas, Duplicate Swipes) |
| **Matches** | Likes Module | `matches`, `conversations`, `notifications` | `GET /matches`, `DELETE /matches/:matchId` | Integration (Concurrency, Rematching) |
| **Premium Undo** | Likes, Matches, Entitlements | `likes`, `matches`, `conversations` | `POST /discovery/undo` | Integration (Match Reversion, Rollback) |
| **Chat & Messaging**| Matches Module, S3, Socket.IO | `conversations`, `messages`, `usage_records` | `/conversations/*`, `/messages/*`, Socket.IO events | Integration + E2E (6-Step Auth, Quotas) |
| **Blocks & Safety** | Users, Matches, Chat | `blocks` | `/blocks`, `/blocks/:userId` | Integration (Bidirectional Isolation) |
| **Reports** | Users, Safety | `reports` | `/reports` | Integration (Report Submission) |
| **Notifications** | Matches, Chat, Likes | `notifications` | `GET /notifications`, Socket.IO events | Integration (Event Delivery) |
| **Who Liked You** | Likes, Entitlements | `likes`, `profiles`, `subscriptions` | `GET /likes/who-liked-me` | Integration (Free Redaction vs Premium) |
| **Entitlements** | Subscriptions Module | `plans`, `features`, `plan_features`, `usage_limits`, `usage_records` | `/me/entitlements`, `/me/usage` | Unit + Integration (Centralized Engine) |
| **Subscriptions** | Plans, Entitlements | `subscriptions`, `plans` | `/subscriptions/plans`, `/subscriptions/me`, `/subscriptions/cancel` | Integration (Lifecycle State Machine) |
| **Payments** | Subscriptions, Razorpay | `payments`, `processed_webhooks`, `subscriptions` | `/payments/checkout`, `/payments/verify`, `/webhooks/razorpay` | Integration (HMAC, Idempotency) |
| **Admin Panel** | Users, Reports, Taxonomies | `users`, `reports`, `genders`, `interests`, `plans` | `/admin/*` | Integration (Role Auth, Actions Audit) |

---

## 21. Testing Strategy

### 21.1 Development Testing Cycle
To ensure high software quality and prevent regressions, development must follow the "Test Alongside Feature" methodology:

```text
Implement Domain Schema & Migrations
       │
       ▼
Implement Data Access & Domain Service
       │
       ▼
Write Unit Tests for Business Logic & Entitlements
       │
       ▼
Implement Controller & Route Bindings
       │
       ▼
Write Supertest Integration Tests (API + DB)
       │
       ▼
Verify Security & Edge Case Handling
       │
       ▼
Proceed to Dependent Module
```

### 21.2 Test Harness & Environment Setup
* **Current backend CI:** Implemented and verified in `.github/workflows/backend-ci.yml`. GitHub Actions runs it on pushes to `develop` and on pull requests targeting `develop`. `develop` is the integration branch. The job uses `ubuntu-latest`, Node.js 20, and `npm ci`, then `npm run build`, `npm test`, and `npm run test:integration:pg`.
* **PostgreSQL integration path:**

```text
GitHub Actions provides temporary PostGIS service (postgis/postgis:16-3.4)
        ↓
existing test-database.js
        ↓
creates love_bites_test
        ↓
runs Sequelize migrations with --env test
        ↓
PostgreSQL integration tests
```

  The existing database guard remains in place. CI does not create `love_bites_dev` and does not run `npm run db:migrate`.
* **Database Cleanup:** The existing PostgreSQL integration setup truncates public test tables between tests. It does not drop `love_bites_test`.
* **Test Factories & Fixtures:** Provide helper factory functions to generate test users, completed profiles, dating preferences, and active subscriptions.
* **Redis in CI:** CI does not require a real Redis service. Current automated tests use the existing in-memory Redis test double where appropriate. Application Redis for authentication and rate limits is unchanged. Redis hardening is deferred.

### 21.3 External Service Mocking Strategy
* **Razorpay Payment Gateway:** Mock Razorpay SDK methods in unit tests; test webhook endpoints by generating valid HMAC-SHA256 test signatures.
* **AWS S3 Client:** Mock AWS SDK S3 client to return simulated presigned URLs; verify generated object keys match `photos/{userId}/{uuid}.webp`.
* **SMS / Email Gateways:** Mock external OTP dispatch providers; verify Redis OTP key generation and TTL expiration.
* **Redis PubSub & Socket.IO:** Future realtime tests may use `ioredis-mock` or a dedicated test Redis instance. That suite is not part of the current CI workflow, which does not start Redis.

---

## 22. Definition of Done

A backend feature, module, or phase is considered **Done** and ready for merging only when all of the following criteria are satisfied:

1. **Requirements Satisfaction:** All product requirements and business logic defined in `docs/01-product-requirements.md` are completely implemented.
2. **Architectural Compliance:** 3-layer architecture (`Controller` $\rightarrow$ `Service` $\rightarrow$ `Data Access`) is strictly respected with zero repository patterns.
3. **Database Migrations:** Schema changes have corresponding, version-controlled Sequelize migrations that execute and revert cleanly.
4. **Request Validation:** Every incoming parameter and body payload is validated using Zod schemas with unknown fields stripped.
5. **Authorization & Security:** Protected routes enforce authentication, role checks, and resource ownership validation.
6. **Centralized Entitlement Gating:** Tiered feature access and quotas route through `entitlements.service.ts` (zero hardcoded `if (isPremium)` checks).
7. **Privacy Compliance:** No raw latitude/longitude coordinates or unmasked Free-tier liker identities are returned in API responses.
8. **Automated Test Coverage:**
   * Unit tests exist for business rules, calculations, and service methods.
   * Integration tests (`supertest`) exist for all HTTP endpoints and database interactions.
   * Negative security scenarios and quota limit boundaries are explicitly tested.
9. **Type Safety & Linting:** TypeScript compilation (`tsc --noEmit`) passes with zero errors.
10. **Documentation Consistency:** API behavior matches `backend/docs/03-api-specification.md` and database structures match `backend/docs/02-database-design.md`.

---

## 23. Open Questions / Blockers

The following items represent confirmed open implementation items identified across the technical documentation:

| Item ID | Topic | Description & Current Stance | Action Required |
| :--- | :--- | :--- | :--- |
| **OQ-01** | SMS Gateway Provider Selection (OAD-01) | Selection between Twilio, MSG91, or AWS SNS for OTP delivery. Decoupled behind `ISmsProvider`. | Finalize SMS vendor credentials for staging/production. |
| **OQ-02** | Boost Credit & Duration Configuration | PRD designates Boost duration (e.g., 30 mins) and monthly allowance (e.g., 1 credit) as TBD. | Populate system configuration table `usage_limits` during seed migration. |
| **OQ-03** | Super Like Monthly Quota Configuration | PRD designates Super Like monthly allowance (e.g., 5 credits) as TBD. | Populate system configuration table `usage_limits` during seed migration. |
| **OQ-04** | Launch Supported Cities / Geofencing | PRD designates the initial launch cities list as TBD. | Define active operational city boundaries in platform configuration. |
| **OQ-05** | Standalone Credit Pricing (A La Carte) | Exact pricing for standalone Boost and Super Like purchases is TBD. | Configure pricing catalog in `plans` / credit checkout tables. |
