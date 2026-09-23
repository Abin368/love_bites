# Backend Chat Handoff

> **Document Path:** `backend/docs/CHAT_HANDOFF.md`  
> **Status:** Active Backend Handoff Document  
> **Last Updated:** 2026-09-23  
> **Target Audience:** AI Coding Sessions & Backend Engineers  

---

## 1. Current Project Status

* **Overall Backend Implementation Status:** **Phase 0 complete. Phase 1 database foundation complete.** Step 1 and Step 2 migrations are applied to `love_bites_dev`. No domain APIs, services, seeders, or payment providers are implemented.
* **Current Development Phase:** **Phase 1 database foundation complete. Next work is Phase 2 (authentication), not more schema.**
* **What is Working:**
  * Base project setup (`package.json`, `tsconfig.json`, `.env.example`, `.sequelizerc`, `jest.config.ts`).
  * Express application (`src/app.ts`) with security headers (Helmet), CORS, JSON parser, cookie parser, HPP, and request ID tracking.
  * Zod environment parser & validator (`src/config/env.ts`).
  * Sequelize connection pool (`src/config/database.ts`).
  * Redis connection client (`src/config/redis.ts`).
  * AppError hierarchy and centralized error handler (`src/middleware/error.middleware.ts`).
  * Structured logger with sensitive parameter redaction (`src/utils/logger.ts`).
  * Health check endpoints (`GET /health` and `GET /api/v1/health`).
  * Automated unit and integration test suite passing with 100% success (12/12 tests).
  * Clean TypeScript compilation (`npm run build`).
  * Phase 1 Step 1 and Step 2 models, associations, and reversible migrations. Step 2 adds the remaining 24 foundation tables (catalogs, junctions, likes, matches, chat, safety, notifications, monetization ledger). `backend/.env` has working local PostgreSQL credentials. No seeders were created.
* **What is Not Yet Implemented:**
  * Catalog seed data (genders, interests, relationship intentions, plans, features, usage limits).
  * All domain feature modules (Auth, Users, Profiles, Photos, Genders, Interests, Relationship Intentions, Dating Preferences, Location, Discovery, Likes, Passes, Matches, Chat, Realtime Socket.IO, Safety, Notifications, Subscriptions, Entitlements, Payments, Admin).
  * Payment providers, webhook handlers, and notification generation.

---

## 2. Source of Truth

The following documents represent the authoritative source of truth for all backend implementation decisions. Consult them in order of precedence before proposing or writing code:

| Document Path | Document Title | Purpose & Authority |
| :--- | :--- | :--- |
| `backend/docs/docs_01-product-requirements.md` *(ref: `docs/01-product-requirements.md`)* | **Product Requirements Document (PRD)** | Authoritative source for functional scope, user lifecycle, MVP boundaries, feature rules, and business limits (e.g., 10 daily swipes, 20 messages for Free tier). |
| `backend/docs/backend_docs_01-backend-architecture.md` *(ref: `backend/docs/01-backend-architecture.md`)* | **Backend Architecture Specification** | Authoritative source for technical patterns, 3-layer modular monolith structure, module layouts, layer responsibilities, and request processing pipelines. |
| `backend/docs/02-database-design.md` | **Database Design Specification** | Authoritative source for PostgreSQL/PostGIS schema, Sequelize model attributes, constraints, GiST spatial indexing, unique partial indexes, and table relationships. |
| `backend/docs/03-api-specification.md` | **API Specification & Contract** | Authoritative source for REST API v1 endpoint paths, HTTP verbs, Zod validation schemas, status codes, standard JSON payloads, and Socket.IO realtime contracts. |
| `backend/docs/04-security.md` | **Backend Security Specification** | Authoritative source for Argon2id parameters, dual-token JWT lifecycle, rate limits, coordinate obfuscation, server-side Free-tier liker identity masking, and S3 hardening. |
| `backend/docs/05-development-plan.md` | **Backend Development Plan** | Authoritative execution roadmap detailing the 14 implementation phases, dependency graph, sequential 34-step task list, Definition of Done, and test strategies. |

---

## 3. Current Backend Architecture

### Codebase Reality
As verified by inspecting the repository filesystem:
* Phase 0 application scaffolding exists in `src/` (`app.ts`, `server.ts`, `config/`, `middleware/`, `routes/`, `utils/`).
* Phase 1 Step 1 models exist in `src/database/models/` and associations in `src/database/associations.ts`.
* Phase 1 Step 1 migrations exist in `src/database/migrations/`.
* Domain feature modules (`src/modules/`), controllers, services, and data-access files are **not** implemented.

### Established Architectural Standard (Mandatory for Implementation)
When code is implemented, it **must** strictly conform to the 3-Layer Modular Architecture specified in `backend_docs_01-backend-architecture.md`:

```text
HTTP Request
     │
     ▼
[Security & Validation Middleware] (Helmet, CORS, Rate Limit, Auth, Zod Schema)
     │
     ▼
[Route Layer] (`*.routes.ts`) ──► URL routing & middleware pipeline binding only
     │
     ▼
[Controller Layer] (`*.controller.ts`) ──► DTO parsing, service delegation, JSON serialization
     │
     ▼
[Service Layer] (`*.service.ts`) ──► Business rules, entitlements, limits, DB transactions
     │
     ▼
[Data Access Layer] (`*.data-access.ts`) ──► Sequelize queries, PostGIS spatial functions
     │
     ▼
[Sequelize Models] (`database/models/*.ts`) ──► Schema mapping & table associations
     │
     ▼
[PostgreSQL 16+ & PostGIS 3.4+ Database]
```

### Architectural Guardrails:
* **No Repository Pattern:** Generic repositories or DAOs are strictly forbidden. Use domain-specific Data Access modules (e.g., `likes.data-access.ts`).
* **Controllers do not query databases or contain business rules.**
* **Services do not touch Express `req`/`res` objects or HTTP status codes.**
* **All cross-entity mutations must use managed Sequelize database transactions.**

---

## 4. Implemented Features

| Feature Name | Status | Relevant Module / Files | Important Behavior & Business Rules |
| :--- | :--- | :--- | :--- |
| **Project Setup & Base Tooling** | **Implemented** | `package.json`, `tsconfig.json`, `src/app.ts`, `src/server.ts` | Node.js 20+ LTS, TypeScript 5+, Express app, Zod env validation, Winston logger. |
| **Authentication** | **Not Implemented** | `src/modules/auth/` | Dual registration (Email/Phone), Argon2id hashing, 15-min JWT access token, 7-day rotating refresh cookie (`SameSite=Strict`, `HttpOnly`), single-use token rotation, theft detection. Schema for `auth_refresh_tokens` exists (Phase 1 Step 1). |
| **Users** | **Schema Implemented (Phase 1 Step 1)** | `src/database/models/user.model.ts` | Root identity table, UUID PK, identifier/role/status CHECKs, partial unique email/phone indexes, paranoid `deleted_at`. No user APIs yet. |
| **Profiles** | **Schema Implemented (Phase 1 Step 1)** | `src/database/models/profile.model.ts` | 1:1 with users, DOB with `chk_profiles_age_18_plus`, `gender_id` FK, city, `geography(Point, 4326)` location. No profile APIs yet. |
| **Photos** | **Schema Implemented (Phase 1 Step 1)** | `src/database/models/profile-photo.model.ts` | `user_id` → `users.id`, storage key, display order 1..5, primary-photo partial unique index. No S3/upload APIs yet. |
| **Interests** | **Schema Implemented (Phase 1 Step 2)** | `interest.model.ts`, `user-interest.model.ts` | Catalog and `user_interests` junction exist. No interest APIs. Tables are unseeded. |
| **Relationship Intentions** | **Schema Implemented (Phase 1 Step 2)** | `relationship-intention.model.ts`, junction models | Catalog plus profile and preference junction tables exist. No APIs. Tables are unseeded. |
| **Dating Preferences** | **Schema Implemented (Phase 1)** | `dating-preference.model.ts` plus Step 2 junctions | Core 1:1 table plus `user_dating_preference_genders` and `user_dating_preference_intentions`. No preference APIs. |
| **Location & PostGIS** | **Schema Implemented (Phase 1 Step 1)** | `profiles.location` migration + `Profile` model | `geography(Point, 4326)` and GiST index `idx_profiles_location_gist` verified on `love_bites_dev` after Step 2. Discovery queries not implemented. |
| **Discovery Engine** | **Not Implemented** | `src/modules/discovery/` | Single-card candidate delivery, unlimited card browsing, PostGIS `ST_DWithin` spatial query, mutual preference filtering, Boost multipliers, exclusion of self/blocks/passes/matches. |
| **Likes** | **Schema Implemented (Phase 1 Step 2)** | `like.model.ts` | `likes.action` stores `LIKE`, `PASS`, and `SUPER_LIKE`. Partial unique `uq_likes_active_pair` where `is_undone = FALSE`. No like API or quota enforcement. |
| **Passes** | **Schema only, via `likes`** | `like.model.ts` | No separate passes table. Pass behavior is a `likes` row. No pass API. |
| **Matches** | **Schema Implemented (Phase 1 Step 2)** | `match.model.ts` | `chk_matches_canonical_order` enforces `user_one_id < user_two_id`. Partial unique active pair allows later re-match after `UNMATCHED` or `UNDONE`. No match API. |
| **Chat & Realtime Messaging** | **Schema Implemented (Phase 1 Step 2)** | `conversation.model.ts`, `message.model.ts` | `conversations` and `messages` only. `messages` is paranoid. No Socket.IO, chat API, or read-receipt service. |
| **Notifications** | **Schema Implemented (Phase 1 Step 2)** | `notification.model.ts` | In-app row store with JSONB `data` default `'{}'`. No generation, push, email, or socket dispatch. |
| **Safety & Moderation** | **Schema Implemented (Phase 1 Step 2)** | `block.model.ts`, `report.model.ts` | `blocks` and `reports` with documented CHECKs and `SET NULL` reporter/resolver FKs. No moderation workflow. |
| **Subscriptions & Entitlements** | **Schema Implemented (Phase 1 Step 2)** | plan, feature, subscription, usage, credit, boost models | Tables exist and are unseeded. Partial unique active subscription per user. No entitlement service. `limit_value = -1` remains allowed. |
| **Payments** | **Schema Implemented (Phase 1 Step 2)** | `payment.model.ts`, `processed-webhook.model.ts` | Ledger tables only. `processed_webhooks.event_id` is `VARCHAR(255)` PK. No Razorpay, Stripe, PayPal, or webhook handler. |
| **Admin** | **Not Implemented** | `src/modules/admin/` | Role guard (`role = 'ADMIN'`), user management (suspend, ban, unsuspend), moderation triage, taxonomy CRUD, dashboard KPIs, structured audit logs. |

---

## 5. Database / Migrations Status

### Current Database State
* **Database:** `love_bites_dev`. `backend/.env` is present and was not changed. Step 1 credential failure is closed.
* **Step 1 models (unchanged):** `Gender`, `User`, `AuthRefreshToken`, `Profile`, `ProfilePhoto`, `DatingPreference`.
* **Step 2 models:** `Interest`, `RelationshipIntention`, `UserInterest`, `UserRelationshipIntention`, `UserDatingPreferenceGender`, `UserDatingPreferenceIntention`, `Like`, `Match`, `Conversation`, `Message`, `Block`, `Report`, `Notification`, `Plan`, `Feature`, `PlanFeature`, `UsageLimit`, `Subscription`, `Payment`, `ProcessedWebhook`, `UsageRecord`, `UserCreditBalance`, `CreditTransaction`, `BoostSession`.
* **Associations:** Step 1 aliases unchanged. Step 2 aliases added in `src/database/associations.ts` and exported from that file. `server.ts` was not modified.
* **Migrations:** `20260920120001`–`20260920120031` are all `up` on `love_bites_dev` (status checked 2026-09-23). Step 1 files were not edited or rerun. Step 2 files `08`–`31` migrated successfully.
* **Seeders:** None. Catalog tables may be empty.
* **SQL verification (2026-09-23):** 30 public tables present (6 Step 1 + 24 Step 2). Extensions `postgis` 3.6.2, `uuid-ossp` 1.1, `pgcrypto` 1.4. `profiles.location` is `geography(Point,4326)`. `idx_profiles_location_gist` is a GiST index. Named CHECKs, unique constraints, partial indexes, and `ON DELETE` actions matched `02-database-design.md`. `chk_matches_canonical_order` is `user_one_id < user_two_id`. `processed_webhooks.event_id` is `varchar(255)` PK. `notifications.data` default is `'{}'::jsonb`. `boost_sessions.multiplier` is `numeric(4,2)`.
* **Constraint name note:** `user_relationship_intentions` unique constraint is the documented name `uq_user_intentions_pair`.

### Planned Database Schema (from `02-database-design.md`)

```
Database Engine: PostgreSQL 16+ with PostGIS 3.4+ Extension
Primary Key Strategy: UUIDv4 (gen_random_uuid())
```

#### Planned Migration Sequence:
1. `01_enable_extensions.sql` / Sequelize: `postgis`, `uuid-ossp`
2. `02_create_reference_tables.sql`: `genders`, `interests`, `relationship_intentions`
3. `03_create_monetization_taxonomies.sql`: `plans`, `features`
4. `04_create_core_identity.sql`: `users`, `auth_refresh_tokens`
5. `05_create_profiles_and_photos.sql`: `profiles`, `profile_photos`
6. `06_create_preference_junctions.sql`: `dating_preferences`, `user_interests`, `user_relationship_intentions`, `user_dating_preference_genders`, `user_dating_preference_intentions`
7. `07_create_interactions_chat_safety.sql`: `likes`, `matches`, `conversations`, `messages`, `blocks`, `reports`, `notifications`
8. `08_create_monetization_usage_payments.sql`: `plan_features`, `usage_limits`, `subscriptions`, `payments`, `processed_webhooks`, `usage_records`, `user_credit_balances`, `credit_transactions`, `boost_sessions`
9. `09_seed_reference_data.sql`: Seed default Genders, Intentions, Plans, Features, and Usage Limits.

#### Key Constraints & Indexes to Implement:
* **Spatial Index:** GiST index `idx_profiles_location_gist` on `profiles.location`.
* **Canonical Match Unique Index:** Partial unique index `uq_matches_single_active_pair` on `(user_one_id, user_two_id)` where `status = 'ACTIVE'`.
* **Single Primary Photo Index:** Partial unique index `uq_profile_photos_primary_per_user` on `(user_id)` where `is_primary = TRUE AND deleted_at IS NULL`.
* **Active User Identifier Indexes:** Partial unique indexes on `email` and `phone` where `deleted_at IS NULL`.
* **Active Subscription Index:** Partial unique index `uq_subscriptions_single_active_per_user` on `(user_id)` where `status IN ('ACTIVE', 'PAST_DUE', 'GRACE_PERIOD')`.
* **Check Constraints:** `chk_profiles_age_18_plus`, `chk_matches_canonical_order` (`user_one_id < user_two_id`), `chk_likes_no_self_like`, `chk_blocks_no_self_block`.

---

## 6. API Status

### Status Summary
* **Implemented Endpoints:** `0 / 48` (0%)
* **Partially Implemented Endpoints:** `0 / 48` (0%)
* **Planned Endpoints:** `48` endpoints specified in `03-api-specification.md`.

### Planned API Catalog Overview (Base Path: `/api/v1`)

| Domain | Method & Path | Auth Requirement | Expected Behavior |
| :--- | :--- | :--- | :--- |
| **Auth** | `POST /auth/register` | Public | Register with Email or Phone, DOB ($\ge 18$), legal acceptance. |
| **Auth** | `POST /auth/verify-email` | Public | Verify 6-digit email token; sets `email_verified = true`. |
| **Auth** | `POST /auth/verify-phone` | Public | Verify 6-digit SMS OTP; sets `phone_verified = true`. |
| **Auth** | `POST /auth/resend-verification` | Public | Resend code with 60s cooldown limit. |
| **Auth** | `POST /auth/login` | Public | Argon2id verification, returns JWT + sets HttpOnly refresh cookie. |
| **Auth** | `POST /auth/refresh` | Cookie (`refreshToken`) | Single-use refresh token exchange with reuse detection. |
| **Auth** | `POST /auth/logout` | Authenticated | Revoke refresh token in DB, clear cookie. |
| **Auth** | `POST /auth/forgot-password` | Public | Trigger password reset email/SMS. |
| **Auth** | `POST /auth/reset-password` | Public | Reset password with token, revoke active sessions. |
| **Onboarding**| `GET /onboarding/status` | Authenticated | Return onboarding stage progression and `nextStep`. |
| **Onboarding**| `PATCH /onboarding/profile` | Authenticated | Update basic name, gender, bio, occupation, education. |
| **Onboarding**| `PUT /onboarding/interests` | Authenticated | Select 3 to 10 interests. |
| **Onboarding**| `PUT /onboarding/relationship-intentions`| Authenticated | Select $\ge 1$ relationship intentions. |
| **Onboarding**| `PUT /onboarding/dating-preferences`| Authenticated | Save age range, max distance, target genders & intentions. |
| **Onboarding**| `PUT /onboarding/location` | Authenticated | Save city & coordinates (stores PostGIS point). |
| **Onboarding**| `POST /onboarding/complete` | Authenticated | Validate all criteria, set `is_profile_complete = true`. |
| **Profiles** | `GET /profiles/me` | Authenticated | Return private user profile and preferences. |
| **Profiles** | `PATCH /profiles/me` | Authenticated | Update editable profile attributes. |
| **Profiles** | `GET /profiles/:userId` | Authenticated | Public candidate profile with rounded `distanceKm`. |
| **Photos** | `POST /profile-photos/upload-url` | Authenticated | Validate MIME/size, generate S3 PutObject presigned URL. |
| **Photos** | `POST /profile-photos/confirm` | Authenticated | Save photo record in database. |
| **Photos** | `PATCH /profile-photos/:photoId` | Authenticated | Update display order or primary status. |
| **Photos** | `DELETE /profile-photos/:photoId` | Authenticated | Soft-delete photo (enforce min 1 photo rule). |
| **Config** | `GET /genders`, `/interests`, `/relationship-intentions` | Public | Return active dynamic reference lists. |
| **Preferences**| `GET /dating-preferences`, `PUT /dating-preferences` | Authenticated | Fetch and update matching preferences. |
| **Discovery** | `GET /discovery` | Authenticated | Get next candidate card (PostGIS spatial filter, Boost weighted). |
| **Likes** | `POST /discovery/:userId/like` | Authenticated | Free quota check (10/day), record like, trigger mutual match. |
| **Passes** | `POST /discovery/:userId/pass` | Authenticated | Free quota check (10/day), record permanent pass. |
| **Undo** | `POST /discovery/undo` | Premium (`UNDO_ACTION`)| Rollback immediately preceding action within 5 minutes. |
| **Who Liked Me**| `GET /likes/who-liked-me` | Authenticated | Free: `{ count: N, admirers: [] }`; Premium: full admirer list. |
| **Matches** | `GET /matches` | Authenticated | Cursor-paginated active matches list. |
| **Matches** | `DELETE /matches/:matchId` | Authenticated | Unmatch; close conversation; allow rematch. |
| **Chat** | `GET /conversations` | Authenticated | Inbox list with last message snippet. |
| **Chat** | `GET /conversations/:conversationId/messages` | Authenticated | Cursor-paginated message history. |
| **Chat** | `POST /conversations/:conversationId/messages` | Authenticated | 6-step auth check, daily quota check (20/day Free), send message. |
| **Chat** | `POST /conversations/:conversationId/media-upload-url`| Premium (`CHAT_MEDIA`)| Generate S3 presigned URL for chat media. |
| **Chat** | `PATCH /conversations/:conversationId/read` | Authenticated | Mark conversation messages as read. |
| **Safety** | `POST /blocks/:userId`, `GET /blocks`, `DELETE /blocks/:userId` | Authenticated | Manage bidirectional user blocking. |
| **Safety** | `POST /reports` | Authenticated | Submit misconduct report with category & description. |
| **Notifications**| `GET /notifications`, `PATCH /notifications/:id/read` | Authenticated | Manage notification feed. |
| **Subscriptions**| `GET /subscriptions/plans` | Public | List available subscription tiers and pricing. |
| **Subscriptions**| `GET /subscriptions/me` | Authenticated | Current subscription status and renewal info. |
| **Subscriptions**| `POST /subscriptions/cancel` | Authenticated | Disable auto-renew; keep access until period end. |
| **Entitlements**| `GET /me/entitlements`, `GET /me/usage` | Authenticated | Return active feature entitlements and daily usage quotas. |
| **Payments** | `POST /payments/checkout` | Authenticated | Create Razorpay order from PostgreSQL plan price. |
| **Payments** | `POST /payments/verify` | Authenticated | Verify client payment signature. |
| **Webhooks** | `POST /webhooks/razorpay` | Public (HMAC Verified) | Webhook source of truth; updates subscription state idempotently. |
| **Admin** | `/admin/*` (Users, Reports, Config, Dashboard) | Admin (`role=ADMIN`) | Admin management, moderation, taxonomy config, KPIs. |

---

## 7. Authentication and Authorization Status

| Component | Status | Planned Specification | Notes |
| :--- | :--- | :--- | :--- |
| **Registration** | **Not Implemented** | Email OR Phone, DOB ($\ge 18$), legal terms confirmation. | Public endpoint `/auth/register`. |
| **Verification** | **Not Implemented** | Email token / SMS OTP cached in Redis (TTL: 300s, max 3 attempts). | Enforced before discovery access. |
| **Password Hashing** | **Not Implemented** | Argon2id (`timeCost: 3, memoryCost: 65536, parallelism: 4`). | No plaintext storage; excluded in default model scope. |
| **JWT Access Tokens** | **Not Implemented** | 15-minute lifespan; payload: `sub`, `role`, `isVerified`, `isProfileComplete`. | Sent in `Authorization: Bearer <token>`. |
| **Refresh Tokens** | **Not Implemented** | 7-day lifespan; stored as SHA-256 in `auth_refresh_tokens`. | Sent in `SameSite=Strict; HttpOnly; Secure` cookie. |
| **Token Rotation & Replay Defense**| **Not Implemented** | Single-use rotation; reuse of revoked token cascades to revoke ALL user sessions. | Specified in `04-security.md`. |
| **Auth Middleware** | **Not Implemented** | `auth.middleware.ts` validates JWT, verifies user active state, attaches `req.user`. | Blocks `UNVERIFIED`, `SUSPENDED`, `BANNED`. |
| **Role Authorization** | **Not Implemented** | `role.middleware.ts` checks `req.user.role === 'ADMIN'`. | Premium is NOT a role. |
| **Account Status Handling**| **Not Implemented** | `UNVERIFIED`, `ACTIVE`, `SUSPENDED`, `BANNED`, `DELETED`. | Banned/suspended revoke all tokens and disconnect sockets. |

---

## 8. Business Rules Already Implemented

> **Current Status:** **Zero business rules are enforced in executable code** because the application codebase is in a pre-implementation state.

### Mandatory Rules Defined in Specifications (To Be Implemented):
1. **Age Threshold:** Users must be at least 18 years old at registration (`dateOfBirth <= CURRENT_DATE - INTERVAL '18 years'`).
2. **Onboarding Completeness:** Incomplete profiles (`is_profile_complete = FALSE`) or unverified users are excluded from the discovery pool and cannot swipe or chat.
3. **Photo Invariants:** 1 to 5 photos per user; exactly 1 active photo must be marked `is_primary = TRUE`.
4. **Interests & Intentions Bounds:** Exactly 3 to 10 interests; at least 1 relationship intention.
5. **Combined Daily Swipe Quota:** Free users have a shared daily quota of **10 actions** covering both Likes and Passes combined.
6. **Pass Permanence:** A Pass action permanently excludes the candidate from future discovery in Phase 1.
7. **Canonical Match Storage:** In `matches`, `user_one_id < user_two_id` is strictly enforced to prevent duplicate pair rows.
8. **Chat Access Invariant:** Chat is unlocked only after a mutual match is established. Free users are limited to 20 text messages/day and cannot send media.
9. **Coordinate Privacy:** Exact latitude and longitude coordinates are never serialized in API responses; responses return only the city name and rounded kilometer distance.
10. **Server-Side Liker Masking:** Free users calling `GET /likes/who-liked-me` receive only aggregate count (`{ count: N, admirers: [] }`) with zero admirer metadata or photo URLs in the response.
11. **Payment Webhook Authority:** Subscriptions are activated/renewed exclusively via verified Razorpay webhook events, never client success callbacks.
12. **Renewal Grace Period:** Failed subscription renewals enter a 24-hour grace period with full Premium access before downgrade to Free.

---

## 9. Security Status

| Security Area | Implementation Status | Planned Implementation Standard |
| :--- | :--- | :--- |
| **Input Validation** | **Not Implemented** | Zod schemas with `.strip()` mode to prevent mass-assignment. |
| **Authentication Security** | **Not Implemented** | Argon2id hashing + dual-token JWT + single-use refresh token rotation. |
| **Authorization / IDOR** | **Not Implemented** | Strict resource ownership validation (`resource.user_id === req.user.id`) + UUIDv4 non-enumerable IDs. |
| **Rate Limiting** | **Not Implemented** | Redis sliding-window limiters (Auth: 5 req/min; Swipes: 60 req/min; Chat: 30 req/min). |
| **CORS** | **Implemented (Phase 0)** | Whitelisted frontend origins with `credentials: true`. |
| **HTTP Security Headers** | **Implemented (Phase 0)** | Helmet middleware in `createApp()`. CSP/HSTS hardening still planned for Phase 12. |
| **Payload Size Bounds** | **Implemented (Phase 0)** | `express.json({ limit: '100kb' })`. |
| **File Upload & S3 Security** | **Not Implemented** | Direct client-to-S3 presigned URLs, private bucket, MIME whitelisting, 10MB max size. |
| **Payment & Webhook Security** | **Not Implemented** | HMAC-SHA256 signature verification + idempotency ledger table `processed_webhooks`. |
| **Error Handling & Sanitization**| **Implemented (Phase 0)** | Centralized `error.middleware.ts`; internal traces stripped in production. |
| **Logging & Redaction** | **Implemented (Phase 0)** | Winston JSON logger with automatic filtering of passwords, tokens, secrets, and coordinates. |
| **Environment Configuration** | **Implemented (Phase 0)** | Zod schema validation of all required environment variables on boot. |

---

## 10. Testing Status

* **Existing Tests:** 12 tests across `tests/unit/app-error.test.ts`, `tests/unit/logger.test.ts`, `tests/integration/health.test.ts`.
* **Test Framework:** **Jest + ts-jest** (Unit), **Supertest** (Integration). Playwright E2E is still planned.
* **Covered Functionality:** AppError hierarchy, logger surface, health endpoints (`/health`, `/api/v1/health`) with mocked DB/Redis, 404 envelope.
* **Phase 1 Step 2 verification (2026-09-23):** `npm run build` succeeded. `npm test` **12/12 passing**. Existing tests were not modified and no Step 2 Jest suite was added. Schema proof is the SQL verification above.
* **Missing Tests:**
  * Unit tests: Crypto utility, Zod schemas, Entitlement evaluator, Quota calculations, DTO serializers.
  * Integration tests: Auth lifecycle, Onboarding pipeline, PostGIS spatial queries, Likes/Passes quota, Concurrency-safe matching, Undo rollback, Chat 6-step auth, Razorpay webhook idempotency, Admin role security.
* **Current Test Commands:** `npm test`, `npm run test:unit`, `npm run test:integration`.
* **Migration Commands:** `npm run db:migrate`, `npm run db:migrate:status`, `npm run db:migrate:undo` (or `npx sequelize-cli ...`). `.sequelizerc` loads `src/config/sequelize.cli.js`.

---

## 11. Known Issues / Technical Debt

| Problem | Impact | Current Workaround | Recommended Next Action |
| :--- | :--- | :--- | :--- |
| **1. Local PostgreSQL credentials** | Closed. `backend/.env` authenticates and `love_bites_dev` has Step 1 and Step 2 applied. | None. | Do not change connection configuration. |
| **2. Documentation Filename Discrepancies** | Two files in `backend/docs/` use prefixed names (`docs_01-product-requirements.md` and `backend_docs_01-backend-architecture.md`) while cross-references mention unprefixed names. | Both documents are located in `backend/docs/`. | Keep existing filenames; treat `backend/docs/` as the documentation container. |
| **3. Sequelize GEOMETRY vs geography** | `02-database-design.md` §26 shows `DataTypes.GEOMETRY`, while SQL SoT is `geography(Point, 4326)`. | Step 1 migration uses raw SQL `geography(Point, 4326)`. Model uses `DataTypes.GEOGRAPHY('POINT', 4326)`. | Keep geography; do not switch the column to geometry. |
| **4. Onboarding vs NOT NULL location/city** | Product onboarding saves location after basic profile, but `profiles.city` and `profiles.location` are `NOT NULL`. | Follow the database design as schema SoT. | Phase 3 must either insert profile only after location exists or revisit nullability with an explicit decision. |
| **5. External Gateway Provider Selections (OAD-01 / OQ-01)** | Specific SMS vendor (Twilio vs MSG91 vs SNS) not finalized. | Architecture decouples SMS behind `ISmsProvider` and payments behind `IPaymentProvider`. | Implement mock/interface for SMS OTP during Phase 2 development. |
| **6. `pgcrypto` added in extensions migration** | Documented PK default is `gen_random_uuid()`, which requires `pgcrypto` on PostgreSQL 16/18. User-requested extensions were `postgis` and `uuid-ossp`. | Extensions migration enables all three with `IF NOT EXISTS`. | Leave as-is unless a later environment forbids `pgcrypto`. |

---

## 12. Work Currently In Progress

* **Status:** **Phase 1 Step 2 complete and migrated.** Stop here. Do not start APIs or later phases in the same change.
* **Context:** Step 1 remains applied and was not redesigned. Application behavior (auth, discovery, likes, matches, chat, notifications, moderation, subscriptions, payments) is still unimplemented.

---

## 13. Pending Implementation

The implementation should follow the phased sequence established in `05-development-plan.md`:

1. **Phase 0 — Project Setup & Base Infrastructure:** Initialize Node.js, TypeScript, Express, Zod env validation, Sequelize connection pool, Redis client, centralized error middleware, Winston/Pino logger, and Jest test harness.
2. **Phase 1 — Database Foundation & Base Migrations:** Setup migrations 01–09 (PostGIS extensions, reference catalogs, core schemas, indexes, constraints, seed data).
3. **Phase 2 — Authentication & Accounts:** User data access, Argon2id crypto, registration, OTP verification, login, dual-token JWT, refresh token rotation cookie, auth/role middleware.
4. **Phase 3 — Profile & Onboarding:** Linear onboarding steps, S3 presigned photo upload pipeline, interests, dating preferences, location PostGIS setup, profile completion evaluator.
5. **Phase 4 — Location & Discovery:** Single-card PostGIS `ST_DWithin` spatial query, mutual preference filtering, Boost multipliers, coordinate privacy.
6. **Phase 5 — Likes, Passes & Matches:** Swiping service, Free daily quota (10 swipes), reciprocal like check, canonical pair match creation transaction, Premium Undo rollback, unmatching.
7. **Phase 6 — Chat & Realtime Messaging:** Socket.IO server + Redis adapter, 6-step message authorization, PostgreSQL message persistence, cursor-paginated history, Free/Premium media limits.
8. **Phase 7 — Safety & Moderation:** Bidirectional blocking, misconduct reports submission, admin moderation triage queue.
9. **Phase 8 — Subscriptions & Centralized Entitlements:** Entitlement engine (`hasEntitlement`, `checkAndIncrementUsage`), plans, usage limits, usage records, credit balances, boost sessions.
10. **Phase 9 — Payments & Razorpay Integration:** `IPaymentProvider` abstraction, Razorpay provider, checkout order creation, client signature verification, HMAC webhook handler with idempotency ledger, 24-hr grace period.
11. **Phase 10 — Notifications:** In-app notification queue (`NEW_MATCH`, `NEW_MESSAGE`, `NEW_LIKE`), Socket.IO dispatch, server-side liker identity redaction for Free tier on `GET /likes/who-liked-me`.
12. **Phase 11 — Admin APIs:** Admin user management, suspension/ban enforcement, dynamic taxonomy configuration, system KPI dashboard, audit logs.
13. **Phase 12 — Security Hardening & Penetration Verification:** Validate all checklists from `04-security.md`.
14. **Phase 13 — Multi-Tier Automated Testing:** Complete unit, Supertest integration, and E2E test suites.
15. **Phase 14 — Production Readiness:** Health check, graceful shutdown, logging integrations, S3 bucket hardening, deployment configurations.

---

## 14. Important Decisions — DO NOT CHANGE

The following architectural and business decisions are established and must **not** be modified:

* **Runtime & Framework:** Node.js (v20+ LTS) + TypeScript (v5+) + Express.js.
* **Database & ORM:** PostgreSQL (v16+) with PostGIS (v3.4+) extension + Sequelize ORM.
* **Architectural Style:** 3-layer architecture (`Route` $\rightarrow$ `Controller` $\rightarrow$ `Service` $\rightarrow$ `Data Access` $\rightarrow$ `Sequelize Model`).
* **No Repository Pattern:** Generic repositories or DAOs are strictly forbidden. Use dedicated feature Data Access modules.
* **Authentication:** Argon2id password hashing + Dual-Token JWT (15-minute access token + 7-day rotating refresh token in `HttpOnly`, `SameSite=Strict`, `Secure` cookie).
* **Storage:** AWS S3 private bucket with direct client uploads via short-lived presigned URLs.
* **Location Privacy:** PostGIS spherical geometry (`geography(Point, 4326)`); exact coordinates are **never** returned in API responses; distances $< 1\text{ km}$ return `"Less than 1 km away"`.
* **Payment Gateway:** Razorpay integrated behind `IPaymentProvider` interface; subscription activation driven **strictly by webhook events** verified via HMAC-SHA256 signatures; duplicate events deduplicated via `processed_webhooks`.
* **Centralized Entitlements:** Feature access and daily usage quotas managed centrally via `entitlements.service.ts`. No hardcoded boolean `user.isPremium` checks scattered across controllers.
* **Product Quotas (Free Tier):**
  * Combined **10 Swipes (Likes + Passes) per day**.
  * Maximum **20 sent text messages per day**.
  * Chat media attachments (images, video, voice, GIFs) prohibited for Free tier.
* **Server-Side Liker Identity Protection:** Free users calling `GET /likes/who-liked-me` receive only aggregate counts (`{ count: N, admirers: [] }`). Client-side CSS blurring is prohibited.
* **Canonical Match Identification:** Matches store `user_one_id = LEAST(A, B)` and `user_two_id = GREATEST(A, B)` with partial unique index on `status = 'ACTIVE'`.
* **Database Transactions:** Multi-entity state mutations (matching, unmatching, payments, undo) must execute inside managed Sequelize transactions (`sequelize.transaction`).
* **Redis Boundaries:** Redis is used exclusively for ephemeral caches, sliding-window rate limiters, OTPs, and Socket.IO cluster adapters. It is **never** used as a primary persistent store.

---

## 15. Rules for the Next AI Coding Session

1. **Read this file (`backend/docs/CHAT_HANDOFF.md`) before starting work.**
2. **Read the relevant project specification documents before changing behavior.**
3. **Inspect the existing implementation before creating new files.**
4. **Do not rewrite working code unnecessarily.**
5. **Do not change established architecture without a clear technical reason.**
6. **Do not change established business rules without explicit approval.**
7. **Do not mark a feature as completed unless it is actually implemented and tested.**
8. **Keep changes scoped to the requested feature.**
9. **Preserve backward compatibility where applicable.**
10. **Run relevant tests after changes.**
11. **Update this `CHAT_HANDOFF.md` after completing a meaningful feature.**
12. **Clearly record what changed, what remains, and any new known issues.**

---

## 16. Recommended Next Task

### Task: **Phase 2 — Authentication & Accounts**
Phase 1 schema is applied. Do not add more foundation tables unless a later spec requires them. Do not seed catalogs unless that task explicitly asks for seeders.

Next implementation is authentication (registration, verification, login, refresh rotation), not likes, chat, or payments.

---

## 17. Handoff Update Log

| Date | Feature / Change | Status | Notes |
| :--- | :--- | :--- | :--- |
| **2026-09-18** | Initial Backend Audit & Handoff Creation | **Completed** | Full repository audit completed. Confirmed greenfield status. Created authoritative handoff document. |
| **2026-09-18** | Phase 0 — Backend Project Setup & Infrastructure | **Completed** | Initialized TypeScript, Express, Zod env, Sequelize pool, Redis client, AppError hierarchy, Winston logger with redaction, middleware pipeline, health check endpoints, and Jest test suite (12/12 passing). |
| **2026-09-20** | Phase 1 Step 1 — Users / Profile / Location schema | **Applied and verified** | Migrations `20260920120001`–`20260920120007` and models for extensions, `genders`, `users`, `auth_refresh_tokens`, `profiles` (`geography(Point, 4326)` + GiST), `profile_photos`, `dating_preferences`. Earlier handoff text that said migrate failed and `.env` was absent is obsolete. |
| **2026-09-23** | Phase 1 Step 2 — Remaining database foundation | **Complete** | Migrations `20260920120008`–`20260920120031` applied to `love_bites_dev`. 24 tables, models, and associations added. No seeders, APIs, services, or payment providers. Build passed. Tests 12/12. SQL verification passed, including Step 1 PostGIS preservation. |
