# Backend Chat Handoff

> **Document Path:** `backend/docs/CHAT_HANDOFF.md`  
> **Status:** Active Backend Handoff Document  
> **Last Updated:** 2026-09-18  
> **Target Audience:** AI Coding Sessions & Backend Engineers  

---

## 1. Current Project Status

* **Overall Backend Implementation Status:** **Phase 0 Complete**. Base scaffolding, TypeScript tooling, Express middleware pipeline, Zod environment validation, Sequelize connection pool, Redis client, Winston structured logging with redaction, AppError hierarchy, centralized error middleware, health checks, and automated Jest test harness are implemented and passing.
* **Current Development Phase:** **Phase 1 — Database Foundation (Pending Execution)**.
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
* **What is Not Yet Implemented:**
  * Database migrations (01 through 09) and Sequelize models (Phase 1).
  * All domain feature modules (Auth, Users, Profiles, Photos, Genders, Interests, Relationship Intentions, Dating Preferences, Location, Discovery, Likes, Passes, Matches, Chat, Realtime Socket.IO, Safety, Notifications, Subscriptions, Entitlements, Payments, Admin).

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
* **No code exists in `src/`.**
* **No route files, controller files, service files, or data access files exist.**

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
| **Project Setup & Base Tooling** | **Not Implemented** | `package.json`, `tsconfig.json`, `src/app.ts`, `src/server.ts` | Node.js 20+ LTS, TypeScript 5+, Express app, Zod env validation, Winston/Pino logger. |
| **Authentication** | **Not Implemented** | `src/modules/auth/` | Dual registration (Email/Phone), Argon2id hashing, 15-min JWT access token, 7-day rotating refresh cookie (`SameSite=Strict`, `HttpOnly`), single-use token rotation, theft detection. |
| **Users** | **Not Implemented** | `src/modules/users/` | Root identity, age verification ($\ge 18$), soft-delete lifecycle, status transitions (`UNVERIFIED`, `ACTIVE`, `SUSPENDED`, `BANNED`, `DELETED`). |
| **Profiles** | **Not Implemented** | `src/modules/profiles/` | 1:1 with users, display name, locked DOB, bio ($\le 500$ chars), occupation, education, city, onboarding completion evaluator (`is_profile_complete`). |
| **Photos** | **Not Implemented** | `src/modules/photos/`, `src/integrations/storage/` | 1 to 5 photos, AWS S3 private storage, client direct upload via short-lived presigned `PutObject` URLs, 1 mandatory primary photo, display order 1..5. |
| **Interests** | **Not Implemented** | `src/modules/interests/` | Dynamic admin catalog; user profile binds 3 to 10 active interests in `user_interests`. |
| **Relationship Intentions** | **Not Implemented** | `src/modules/relationship-intentions/` | Dynamic admin catalog; user profile binds $\ge 1$ intention in `user_relationship_intentions`. |
| **Dating Preferences** | **Not Implemented** | `src/modules/dating-preferences/` | Age range (18–100), max distance (1–500 km), target genders, preferred relationship intentions. |
| **Location & PostGIS** | **Not Implemented** | `src/modules/location/` | PostGIS `geography(Point, 4326)` in `profiles.location`, GiST indexing, strict server-side coordinate privacy (coordinates never exposed; rounded km distance returned). |
| **Discovery Engine** | **Not Implemented** | `src/modules/discovery/` | Single-card candidate delivery, unlimited card browsing, PostGIS `ST_DWithin` spatial query, mutual preference filtering, Boost multipliers, exclusion of self/blocks/passes/matches. |
| **Likes** | **Not Implemented** | `src/modules/likes/` | Like action, Free quota enforcement (combined 10 swipes/day), reciprocal like check triggering mutual match inside database transaction. |
| **Passes** | **Not Implemented** | `src/modules/likes/` | Pass action, permanent exclusion in Phase 1, consumes 1 swipe from Free daily quota. |
| **Matches** | **Not Implemented** | `src/modules/matches/` | Canonical pair sorting (`user_one_id < user_two_id`), unique partial index on active matches, unmatch transitions match to `UNMATCHED`, closes conversations, allows rematching. |
| **Chat & Realtime Messaging** | **Not Implemented** | `src/modules/chat/`, `src/socket/` | Socket.IO + Redis adapter, 6-step message authorization, PostgreSQL persistence, Free tier limit (20 text msgs/day, media prohibited), Premium tier unlimited rich media. |
| **Notifications** | **Not Implemented** | `src/modules/notifications/` | Events: `NEW_MATCH`, `NEW_MESSAGE`, `NEW_LIKE`. Realtime dispatch via Socket.IO, server-side redaction of liker identity on `NEW_LIKE` for Free tier. |
| **Safety & Moderation** | **Not Implemented** | `src/modules/safety/` | Bidirectional blocking (instantly closes matches and chat), misconduct reporting with mandatory reason codes, admin report queue. |
| **Subscriptions & Entitlements** | **Not Implemented** | `src/modules/subscriptions/`, `src/modules/entitlements/` | Centralized entitlement checks, plans (`FREE`, `PREMIUM_MONTHLY`, `PREMIUM_YEARLY`), usage tracking in `usage_records`, credit balances, 24-hr grace period on renewal failure. |
| **Payments** | **Not Implemented** | `src/modules/payments/`, `src/integrations/payment/` | Provider interface (`IPaymentProvider`), Razorpay provider, server-side price lookup, HMAC-SHA256 signature verification, idempotent webhook ledger (`processed_webhooks`). |
| **Admin** | **Not Implemented** | `src/modules/admin/` | Role guard (`role = 'ADMIN'`), user management (suspend, ban, unsuspend), moderation triage, taxonomy CRUD, dashboard KPIs, structured audit logs. |

---

## 5. Database / Migrations Status

### Current Database State
* **Existing Models:** None (0 models created).
* **Existing Migrations:** None (0 migration files created).
* **Existing Seeders:** None (0 seeder files created).

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
| **CORS** | **Not Implemented** | Whitelisted frontend origins with `credentials: true`. |
| **HTTP Security Headers** | **Not Implemented** | Helmet middleware configured with strict CSP, HSTS, X-Frame-Options. |
| **Payload Size Bounds** | **Not Implemented** | `express.json({ limit: '100kb' })`. |
| **File Upload & S3 Security** | **Not Implemented** | Direct client-to-S3 presigned URLs, private bucket, MIME whitelisting, 10MB max size. |
| **Payment & Webhook Security** | **Not Implemented** | HMAC-SHA256 signature verification + idempotency ledger table `processed_webhooks`. |
| **Error Handling & Sanitization**| **Not Implemented** | Centralized `error.middleware.ts`; internal traces stripped in production. |
| **Logging & Redaction** | **Not Implemented** | Winston/Pino JSON logger with automatic filtering of passwords, tokens, secrets, and coordinates. |
| **Environment Configuration** | **Not Implemented** | Zod schema validation of all required environment variables on boot. |

---

## 10. Testing Status

* **Existing Tests:** None (0 test files).
* **Test Framework:** Planned: **Jest + ts-jest** (Unit), **Supertest** (Integration), **Playwright** (E2E).
* **Covered Functionality:** None.
* **Missing Tests:**
  * Unit tests: Crypto utility, Zod schemas, Entitlement evaluator, Quota calculations, DTO serializers.
  * Integration tests: Auth lifecycle, Onboarding pipeline, PostGIS spatial queries, Likes/Passes quota, Concurrency-safe matching, Undo rollback, Chat 6-step auth, Razorpay webhook idempotency, Admin role security.
* **Current Test Commands:** Not yet configured in `package.json` (Planned: `npm test`, `npm run test:unit`, `npm run test:integration`).

---

## 11. Known Issues / Technical Debt

| Problem | Impact | Current Workaround | Recommended Next Action |
| :--- | :--- | :--- | :--- |
| **1. Greenfield Repository** | No executable code or build pipeline exists. | None. | Execute Phase 0 setup (`package.json`, `tsconfig.json`, `app.ts`, `server.ts`, dependencies, test harness). |
| **2. Documentation Filename Discrepancies** | Two files in `backend/docs/` use prefixed names (`docs_01-product-requirements.md` and `backend_docs_01-backend-architecture.md`) while cross-references in docs mention `docs/01-product-requirements.md` and `backend/docs/01-backend-architecture.md`. | Both documents are located in `backend/docs/`. | Maintain existing files without modifying documentation; treat `backend/docs/` as the single documentation container. |
| **3. No Git Repository Initialized** | Version control tracking is not active at the root. | Files reside in local workspace directory. | User/Agent may initialize git repository when starting source code development. |
| **4. External Gateway Provider Selections (OAD-01 / OQ-01)** | Specific SMS vendor (Twilio vs MSG91 vs SNS) not finalized. | Architecture decouples SMS behind `ISmsProvider` and payments behind `IPaymentProvider`. | Implement mock/interface for SMS OTP during Phase 2 development. |

---

## 12. Work Currently In Progress

* **Status:** **Nothing is currently in progress.**
* **Context:** All design, schema, API, security, and planning documentation phases have concluded. The project is ready for Phase 0 implementation.

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

### Task: **Phase 1 — Database Foundation & Base Migrations**
Proceed with Phase 1 from `backend/docs/05-development-plan.md` and `backend/docs/02-database-design.md`:
1. Implement Sequelize migrations 01 through 09:
   * Migration 01: Enable PostgreSQL Extensions (`postgis`, `uuid-ossp`)
   * Migration 02: Dynamic Reference Tables (`genders`, `interests`, `relationship_intentions`)
   * Migration 03: Monetization Taxonomies (`plans`, `features`)
   * Migration 04: Core User Accounts (`users`, `auth_refresh_tokens`)
   * Migration 05: User Profile & Media (`profiles`, `profile_photos`)
   * Migration 06: Preference Junctions (`dating_preferences`, `user_interests`, `user_relationship_intentions`, `user_dating_preference_genders`, `user_dating_preference_intentions`)
   * Migration 07: Interactions, Chat & Safety (`likes`, `matches`, `conversations`, `messages`, `blocks`, `reports`, `notifications`)
   * Migration 08: Monetization, Usage & Payments (`plan_features`, `usage_limits`, `subscriptions`, `payments`, `processed_webhooks`, `usage_records`, `user_credit_balances`, `credit_transactions`, `boost_sessions`)
   * Migration 09: Reference Catalogs Seed Data (Genders, Intentions, Plans, Features, Usage Limits)
2. Define TypeScript Sequelize models and associations in `src/database/models/` and `src/database/associations.ts`.
3. Test migration forward/rollback execution and schema validation.

---

## 17. Handoff Update Log

| Date | Feature / Change | Status | Notes |
| :--- | :--- | :--- | :--- |
| **2026-09-18** | Initial Backend Audit & Handoff Creation | **Completed** | Full repository audit completed. Confirmed greenfield status. Created authoritative handoff document. |
| **2026-09-18** | Phase 0 — Backend Project Setup & Infrastructure | **Completed** | Initialized TypeScript, Express, Zod env, Sequelize pool, Redis client, AppError hierarchy, Winston logger with redaction, middleware pipeline, health check endpoints, and Jest test suite (12/12 passing). |
