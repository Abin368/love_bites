# Love Bite - Backend Security Specification

> **Document Path:** `backend/docs/04-security.md`  
> **Status:** Authoritative Backend Security Specification & Guardrails  
> **Compliance Baseline:** OWASP API Security Top 10, PostGIS Coordinate Privacy, Razorpay Financial Security Standards  
> **Architecture Pattern:** Layered Defense-in-Depth (`Route` $\rightarrow$ `Controller` $\rightarrow$ `Service` $\rightarrow$ `Data Access` $\rightarrow$ `PostgreSQL/PostGIS`)

---

## 1. Security Overview

The **Love Bite** platform handles highly sensitive personal data, real-time messaging, geolocation coordinates, user preferences, and financial billing lifecycles. Security and privacy take precedence over monetization and user engagement.

### 1.1 Actor & Security Classification Model
The platform enforces a strict separation between **Identity (Authentication)**, **Access Control (Authorization)**, and **Product Capabilities (Entitlements)**:

```text
Authentication (AuthN)
  │ "Who are you?"
  ▼ (Validated via JWT / Argon2id / OTP)
Authorization (AuthZ)
  │ "What administrative resources are you allowed to access?"
  ▼ (Enforced via System Role: USER vs. ADMIN)
Entitlement & Usage (Entitlements)
  │ "Which product features and quotas is your current subscription tier allowed to consume?"
  ▼ (Evaluated centrally via Subscription Plan & Usage Records)
```

1. **`USER`:** Standard authenticated dating platform participant. Restricted to viewing public profile cards, managing their own profile/preferences, participating in active mutual matches, and performing authorized swipes.
2. **`ADMIN`:** Platform administrator with elevated privileges. Can view moderation queues, take disciplinary action on accounts (suspend/ban), and configure reference taxonomies and plans.
3. **`PREMIUM` Status:** **Premium is NOT a user role.** It is a dynamic entitlement state derived from an active `subscriptions` record. No administrative or security bypass privileges are granted by Premium status.

---

## 2. Security Principles

1. **Deny by Default:** All routes, endpoints, Socket.IO rooms, and database resources are closed by default unless explicitly granted through middleware.
2. **Least Privilege:** Application database connections, S3 IAM credentials, and system roles operate with the minimum permissions required for execution.
3. **Zero Frontend Trust:** The backend never trusts client-supplied user IDs, timestamps, pricing values, geolocation boundaries, or boolean entitlement flags (e.g., `isPremium: true`).
4. **Privacy by Design:** Precise spatial coordinates (`latitude`, `longitude`) and unmasked liker identities for non-paying users are filtered server-side and never reach client response payloads.
5. **Fail Securely:** When a security check, token validation, or payment signature verification fails, the system immediately rejects the transaction, logs the security event, and returns a sanitized generic error.
6. **Defense in Depth:** Multiple independent security layers are applied sequentially (e.g., Network/CORS $\rightarrow$ Rate Limiting $\rightarrow$ Authentication $\rightarrow$ Role Authorization $\rightarrow$ Ownership Validation $\rightarrow$ Zod Input Schema $\rightarrow$ Service Eligibility $\rightarrow$ Parameterized SQL $\rightarrow$ Response Serialization).
7. **Idempotent State Changes:** All financial operations, payment webhooks, and state-mutating actions support deterministic, duplicate-safe execution.

---

## 3. Threat Model & Mitigation Matrix

| Threat Category | Specific Attack Vector | Severity | Backend Mitigation Strategy |
| :--- | :--- | :--- | :--- |
| **Authentication** | Credential Stuffing & Brute Force | High | Argon2id password hashing, Redis sliding-window IP/Identifier rate limiting (5 req/min), generic error messages. |
| **Authentication** | Refresh Token Theft / Replay | Critical | Single-use token rotation, SHA-256 hash tracking in `auth_refresh_tokens`, automatic revocation of all user sessions upon token reuse detection. |
| **Authentication** | OTP Interception / Brute Force | High | 6-digit cryptographically secure OTP, 5-minute expiration, max 3 verification attempts before invalidation, 60-second cooldown on resends. |
| **Authorization** | IDOR (Insecure Direct Object Reference) | Critical | Strict resource ownership checks (`resource.user_id === req.user.id`) enforced at the service layer; UUIDv4 non-enumerable primary keys. |
| **Authorization** | Privilege Escalation to Admin | Critical | Role checked server-side via `requireRole('ADMIN')`; role attribute is immutable via standard user update endpoints (protected DTOs). |
| **Dating Logic** | Daily Swipe Limit Bypass | Medium | Server-side atomic increment on `usage_records` inside PostgreSQL transactions; client-side counters are ignored. |
| **Dating Logic** | Discovery Scraping & Coordinate Triangulation | High | Server-side PostGIS distance calculations; API returns only approximate distance rounded to nearest km and city name; coordinates never serialized. |
| **Dating Logic** | Permanent Pass Circumvention | Medium | Pass actions stored permanently in `likes (action='PASS')`; discovery queries enforce `NOT EXISTS` across all historical active passes. |
| **Dating Logic** | CSS Blur Bypassing on "Who Liked You" | High | Free user API returns aggregate count only (`{ count: 5, admirers: [] }`); liker profiles and photo URLs are redacted server-side. |
| **Messaging** | Unauthorized Chat Interception | Critical | Message queries verify user is an active participant of the conversation's active match; closed conversations reject writes. |
| **Payment** | Client-Side Price / Plan Tampering | Critical | Client provides only `planId`; backend resolves authoritative pricing from `plans` table; client-supplied amounts are ignored. |
| **Payment** | Webhook Forgery & Replay Attacks | Critical | HMAC-SHA256 signature verification using Razorpay secret; idempotency enforced via primary key on `processed_webhooks.event_id`. |
| **Infrastructure** | Malicious File Uploads / Malware | High | Direct client-to-S3 uploads via presigned URLs; backend enforces strict MIME whitelisting, 10MB size bounds, and isolated random UUID keys. |
| **Infrastructure** | SQL Injection | Critical | 100% parameterized queries via Sequelize ORM; direct string interpolation in SQL queries is strictly prohibited. |

---

## 4. Authentication Security

### 4.1 Dual-Identifier Registration & Verification
* **Supported Identifiers:** Email Address OR E.164 Phone Number.
* **Age Invariant:** Date of Birth must be verified server-side to guarantee $\text{Age} \ge 18$ at the exact time of registration:
  $$\text{Current Date} - \text{Date of Birth} \ge 18\text{ years}$$
* **Verification Mandate:** Unverified accounts (`status = 'UNVERIFIED'`) are strictly blocked from accessing discovery, swipes, matching, or chat endpoints via `auth.middleware.ts`.

### 4.2 OTP & Email Verification Security
1. **Entropy:** OTP codes are 6-digit numerical strings generated using cryptographically secure pseudorandom number generators (`crypto.randomInt(100000, 999999)`).
2. **TTL & Attempts:**
   * OTP expiration: Exactly **300 seconds (5 minutes)** stored in Redis with auto-expiry TTL.
   * Max verification attempts: **3 failed attempts**, after which the OTP key is deleted, requiring a new code request.
   * Resend cooldown: Minimum **60 seconds** enforced via Redis throttle keys.
3. **Single-Use Enforcement:** Successful OTP verification immediately deletes the key from Redis and transitions `users.phone_verified = TRUE` or `users.email_verified = TRUE`.

### 4.3 Login & Account Enumeration Defense
* Login accepts `identifier` (email or phone) and `password`.
* **Generic Error Messaging:** If credentials fail or the user does not exist, the API returns:
  ```json
  {
    "success": false,
    "error": {
      "code": "INVALID_CREDENTIALS",
      "message": "Invalid credentials provided."
    }
  }
  ```
  *Timing attacks are mitigated by executing dummy password hash verifications when users are not found.*

---

## 5. Password Security

### 5.1 Hashing Specification
* **Algorithm:** **Argon2id** (OWASP recommended password hashing algorithm).
* **Configuration Parameters:**
  * Memory Cost (`m`): `65536` KiB (64 MiB)
  * Time Cost (`t`): `3` iterations
  * Parallelism (`p`): `4` threads
* **Storage Invariants:**
  * Plaintext passwords are **NEVER** stored, logged, cached, or transmitted in unencrypted formats.
  * Sequelize models must define `password_hash` with `scope: { defaultScope: { attributes: { exclude: ['password_hash'] } } }` to prevent accidental serialization.

### 5.2 Password Reset & Session Invalidation
1. **Reset Tokens:** Cryptographically random 32-byte hex strings (`crypto.randomBytes(32).toString('hex')`), hashed using SHA-256 before storage in Redis (TTL: 15 minutes).
2. **Session Eviction:** Successful password reset or manual password update immediately:
   * Revokes all active refresh tokens in `auth_refresh_tokens` for the user.
   * Purges active Redis session keys.
   * Terminates active Socket.IO connections.

---

## 6. JWT and Token Security

### 6.1 Token Architecture

```text
┌─────────────────────────────────────────────────────────────────────────┐
│                           ACCESS TOKEN (JWT)                            │
├─────────────────────────────────────────────────────────────────────────┤
│ • Lifespan: 15 minutes (900s)                                            │
│ • Transport: HTTP Header: `Authorization: Bearer <token>`                │
│ • Algorithm: HS256 / RS256 with cryptographically random 512-bit secret  │
│ • Payload Claims: `sub` (userId), `role`, `isVerified`, `isComplete`    │
│ • Prohibited Claims: Passwords, email, phone, billing details           │
└─────────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼ (Expired)
┌─────────────────────────────────────────────────────────────────────────┐
│                          REFRESH TOKEN (Cookie)                         │
├─────────────────────────────────────────────────────────────────────────┤
│ • Lifespan: 7 days (604,800s)                                           │
│ • Transport: `Set-Cookie: refreshToken=...; HttpOnly; Secure;           │
│              SameSite=Strict; Path=/api/v1/auth/refresh`                │
│ • Storage: SHA-256 hash persisted in `auth_refresh_tokens` table        │
│ • Rotation: Single-use; exchanging generates a new token pair            │
│ • Revocation: Explicit DB record invalidation on logout / suspension    │
└─────────────────────────────────────────────────────────────────────────┘
```

### 6.2 Refresh Token Rotation & Reuse Detection
1. **Single-Use Rotation:** Every request to `POST /api/v1/auth/refresh` invalidates the presented refresh token by recording `revoked_at = CURRENT_TIMESTAMP` and `replaced_by_hash = <new_token_hash>`.
2. **Automatic Revocation Cascade (Theft Detection):** If an incoming request presents an already-revoked refresh token, the server assumes token compromise, immediately invalidates **ALL** active refresh tokens belonging to that `user_id`, and requires a full re-authentication.

---

## 7. Authorization and Access Control

### 7.1 Layered Authorization Pipeline

```text
Incoming HTTP Request
         │
         ▼
[1. Authentication Middleware] ──► Validates JWT Signature & Expiry ──► Binds req.user
         │
         ▼
[2. Account Status Guard]     ──► Rejects BANNED, SUSPENDED, DELETED accounts
         │
         ▼
[3. Role Authorization]        ──► Verifies req.user.role satisfies endpoint (USER vs ADMIN)
         │
         ▼
[4. Resource Ownership Guard] ──► Verifies target resource belongs to req.user.id
         │
         ▼
[5. Entitlement & Quota Guard]──► Evaluates Plan Capabilities & Daily Usage Counters
         │
         ▼
[Controller / Domain Service]
```

### 7.2 Insecure Direct Object Reference (IDOR) Defense Rules
* **User Profile & Photos:** Mutating operations (`PATCH /profiles/me`, `DELETE /profile-photos/:photoId`) resolve target records exclusively using `req.user.id`.
* **Conversations & Messages:** Querying messages verifies that `req.user.id` is a verified participant of the active match backing that conversation:
  ```sql
  SELECT 1 FROM conversations c
  JOIN matches m ON m.id = c.match_id
  WHERE c.id = :conversationId 
    AND (m.user_one_id = :userId OR m.user_two_id = :userId)
    AND m.status = 'ACTIVE';
  ```
  *If this query returns empty, the request is rejected with `404 RESOURCE_NOT_FOUND` to prevent ID enumeration.*

---

## 8. User Account Security & Lifecycle

| Account Status | Login Allowed | Discovery Access | Swipe / Match | Chat Access | Session Handling |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **`UNVERIFIED`** | Yes (Returns unverified state) | Blocked | Blocked | Blocked | Restricted JWT issued solely for verification endpoints. |
| **`ACTIVE`** | Yes | Full (If profile complete) | Full (Quota enforced) | Full | Standard token lifecycle. |
| **`SUSPENDED`** | Blocked (`403 ACCOUNT_SUSPENDED`) | Excluded | Blocked | Blocked | All active refresh tokens revoked; Sockets disconnected. |
| **`BANNED`** | Blocked (`403 ACCOUNT_BANNED`) | Excluded | Blocked | Blocked | All active tokens permanently revoked; IP logged. |
| **`DELETED`** | Blocked (`404 USER_NOT_FOUND`) | Excluded | Blocked | Blocked | Soft-deleted (`deleted_at`); sessions terminated. |

---

## 9. Input Validation & Data Handling

### 9.1 Zod Schema Validation Guardrails
* Every route binds a Zod schema middleware (`validate(schema)`) executed before the controller is reached.
* **Strict Attribute Whitelisting (`strip` mode):** Unrecognized body properties submitted by clients are stripped automatically to prevent mass-assignment vulnerabilities.
* **Core Validation Rules:**
  * `UUIDv4`: Strict regex verification on all URL path and body ID parameters.
  * String bounds: Enforce `min` and `max` character lengths (e.g., `bio: z.string().max(500)`).
  * Numeric boundaries: Enforce exact ranges (e.g., `minAge: z.number().int().min(18).max(100)`).
  * Enums: Restricted to predefined string literals (e.g., `messageType: z.enum(['TEXT', 'IMAGE', 'GIF', 'VIDEO', 'VOICE'])`).

---

## 10. API Security

1. **HTTP Method Restrictions:** Endpoints accept only their designated HTTP verb; unrecognized methods return `405 Method Not Allowed`.
2. **Payload Size Limits:**
   * JSON request bodies: Capped at **100 KiB** via Express middleware (`express.json({ limit: '100kb' })`).
   * Media uploads bypass Express server memory entirely by using direct client-to-S3 presigned URLs.
3. **HTTP Parameter Pollution (HPP):** Protected via middleware to ensure query string parameters cannot be submitted as duplicate arrays to confuse SQL filters.

---

## 11. Rate Limiting and Abuse Prevention

Rate limiting uses **Redis sliding-window counters** to isolate burst abuse while accommodating regular usage:

| Rate Limit Category | Window | Limit | Target Key Format | Action on Limit Breach |
| :--- | :--- | :--- | :--- | :--- |
| **Auth Login / Password Reset** | 60s | 5 req | `ratelimit:auth:login:<ip>` | `429 Too Many Requests` + Log Security Alert |
| **OTP Generation / Resend** | 60s | 1 req | `ratelimit:auth:otp:<identifier>` | `429 Too Many Requests` |
| **Discovery Swipe Actions** | 60s | 60 req | `ratelimit:swipes:<userId>` | `429 Too Many Requests` (Anti-automation) |
| **Chat Message Sending** | 60s | 30 req | `ratelimit:chat:<userId>` | `429 Too Many Requests` (Anti-spam) |
| **Public Reference APIs** | 60s | 100 req | `ratelimit:public:<ip>` | `429 Too Many Requests` |
| **Admin Operations** | 60s | 120 req | `ratelimit:admin:<adminId>` | `429 Too Many Requests` |

*Distinction:* The limits above represent **Security Rate Limits** (abuse/bot prevention). They operate independently from **Product Quotas** (e.g., Free 10 Swipes/day, Free 20 messages/day), which are managed by the Entitlements engine.

---

## 12. Discovery & Dating Security

### 12.1 Server-Side Filter Enforcements
The discovery engine filters candidates strictly server-side using PostGIS and SQL constraints. Clients cannot alter discovery criteria by tampering with query strings:
* **Permanent Pass Enforcement:** If user $A$ has an active pass record against candidate $B$ in `likes`, candidate $B$ is excluded via `NOT EXISTS` in the primary SQL query.
* **Mutual Preference Enforcement:** The candidate must satisfy the viewer's preferences, AND the viewer must satisfy the candidate's preferences (Age, Gender, Distance).
* **Self & Match Exclusion:** Viewer ID, active matches, and active bidirectional blocks are excluded at the database level.

### 12.2 Server-Side Liker Identity Protection ("Who Liked You")
* **The Vulnerability:** Returning full admirer profiles with a frontend CSS/UI blur filter allows attackers to inspect HTTP responses and bypass monetization.
* **The Backend Guardrail:**
  * When a Free user calls `GET /api/v1/likes/who-liked-me`, the service layer projects the SQL query to `COUNT(*)` only.
  * The API response strictly returns:
    ```json
    {
      "success": true,
      "data": { "count": 5, "isUnlocked": false, "admirers": [] }
    }
    ```
  * User IDs, display names, avatars, and timestamps are **NEVER** queried or returned for non-Premium accounts.

---

## 13. Privacy and Sensitive Data Protection

### 13.1 Data Classification & Exposure Matrix

| Data Classification | Fields / Entities | Security & Storage Controls | Exposure Rules |
| :--- | :--- | :--- | :--- |
| **Highly Confidential** | Passwords, Refresh Tokens, Razorpay Secrets, Coordinates. | Argon2id, SHA-256, Environment Variables, PostGIS geography. | **NEVER** returned in any API response or log stream. |
| **Confidential** | Email, Phone, Date of Birth, Billing Details, Safety Reports. | Encrypted in transit (TLS 1.3), restricted DB columns. | Returned **ONLY** to the owning user in `/profiles/me` or admins. |
| **Public / Discoverable** | First Name, Age (Derived), Gender, Bio, Photos, Interests. | Standard PostgreSQL columns, signed CDN URLs. | Serialized in discovery and public profile views. |

### 13.2 Serialization Whitelisting
To prevent accidental data leakage, domain services must use explicit **Response Serializer Functions** (DTOs) rather than returning raw Sequelize model instances (`model.toJSON()` directly to `res.json()` is prohibited).

---

## 14. Location Security

1. **Storage Specification:** Stored as PostGIS `geography(Point, 4326)` in `profiles.location`.
2. **Zero Coordinate Leakage Mandate:**
   * Raw `latitude` and `longitude` coordinates are **NEVER** serialized in any API response.
   * Public discovery and profile endpoints return only:
     1. Registered `city` name (e.g., `"Bengaluru"`).
     2. Approximate distance rounded to the nearest integer kilometer:
        $$\text{distanceKm} = \text{ROUND}(\text{ST\_Distance}(\text{userA.location}, \text{userB.location}) / 1000)$$
3. **Anti-Trilateration Defense:** Distances $< 1\text{ km}$ are clamped to return `"Less than 1 km away"` to prevent malicious geometric trilateration of user residences.

---

## 15. Profile Photo & AWS S3 Security

### 15.1 S3 Bucket Hardening
* **Bucket Access:** S3 Bucket policy is set to **`Block Public Access = TRUE`**. Public-read ACLs are strictly disabled.
* **Server-Side Encryption:** Enabled by default using AWS KMS (`aws:kms`) or AES-256 (`AES256`).

### 15.2 Presigned Upload & Download Lifecycle
1. **Presigned Uploads (`PutObject`):**
   * Client requests upload slot via `POST /api/v1/profile-photos/upload-url`.
   * Server validates MIME type (`image/jpeg`, `image/png`, `image/webp`) and size ($\le 10\text{ MB}$).
   * Server generates short-lived presigned URL (valid for **300 seconds**) targeting a secure, isolated object key:
     `photos/{userId}/{uuidv4}.webp`
2. **Presigned Downloads (`GetObject`) / Signed CDN:**
   * Images are delivered through signed CloudFront URLs or short-lived S3 `GetObject` presigned URLs (TTL: 1 hour), cached in Redis.

---

## 16. Chat and Messaging Security

### 16.1 Six-Step Authorization Verification
Before persisting or transmitting any message, `chat.service.ts` executes a mandatory 6-step transactional verification:

```text
Incoming Message Payload
         │
         ▼
[Step 1] Verify sender authentication (req.user.id)
         │
         ▼
[Step 2] Verify conversation exists & matches user's active membership
         │
         ▼
[Step 3] Verify backing Match status is strictly 'ACTIVE' (Not unmatched)
         │
         ▼
[Step 4] Verify no active bidirectional block exists between participants
         │
         ▼
[Step 5] Verify Entitlement & Media Permissions:
         • Free tier: MessageType MUST be 'TEXT' (Media throws 403)
         • Premium tier: Media attachments permitted ('IMAGE', 'GIF', 'VIDEO', 'VOICE')
         │
         ▼
[Step 6] Verify Daily Quota:
         • Free tier: usage_count < 20 messages/day
         • Premium tier: Unlimited
         │
         ▼
[Persist in PostgreSQL] ──► [Publish to Redis / Socket.IO]
```

---

## 17. Socket.IO Realtime Security

1. **Handshake Authentication:** Socket connections must supply a valid JWT in the handshake:
   ```typescript
   io.use((socket, next) => {
     const token = socket.handshake.auth.token;
     const payload = verifyAccessToken(token);
     if (!payload) return next(new Error('AUTH_REQUIRED'));
     socket.data.user = payload;
     next();
   });
   ```
2. **Server-Managed Room Subscriptions:**
   * Clients can only join rooms authorized by the server:
     * User Private Room: `user:{userId}` (where `userId === socket.data.user.id`).
     * Conversation Room: `conversation:{conversationId}` (authorized only after checking match participation in PostgreSQL).
3. **Zero Client Trust in Socket Events:** Sockets cannot spoof sender IDs. The sender identity is extracted strictly from `socket.data.user.id`.

---

## 18. Subscription & Entitlement Security

1. **Centralized Entitlement Service:** Feature access is verified dynamically via `entitlements.service.ts`. Ad-hoc checks such as `if (req.user.isPremium)` are forbidden.
2. **Tamper-Proof Plan Pricing:** 
   * Clients submit only `planId` during checkout.
   * The backend resolves `plans.price_in_cents` and `plans.currency` directly from PostgreSQL.
   * Client-supplied prices or currency overrides are completely ignored.

---

## 19. Payment Security (Razorpay)

1. **No Raw Card Data:** Love Bite servers never touch, process, or store raw credit/debit card numbers or CVVs (PCI-DSS compliance via Razorpay checkout elements).
2. **Server-Side Order Creation:** Orders are created server-side via official Razorpay SDKs with verified amounts before client checkout initialization.
3. **Cryptographic Signature Verification:** Handshake verifications execute HMAC-SHA256 verification:
   $$\text{HMAC-SHA256}(\text{order\_id} + "|" + \text{payment\_id}, \text{RAZORPAY\_KEY\_SECRET}) == \text{signature}$$

---

## 20. Razorpay Webhook Security

1. **Source of Truth Rule:** Subscription activations and renewals are executed **ONLY** upon receiving authenticated webhook events.
2. **Signature Verification:** The raw request body is verified against `X-Razorpay-Signature` using `RAZORPAY_WEBHOOK_SECRET` before JSON parsing.
3. **Idempotent Webhook Processing:**
   * The server inserts `event.id` into `processed_webhooks` inside a serializable database transaction.
   * If `event.id` already exists, the transaction aborts and returns `200 OK` immediately, preventing double crediting or duplicate subscription extensions.

---

## 21. Admin Security

1. **Server-Side Enforcement:** All `/api/v1/admin/*` routes require `role.middleware.ts` verifying `req.user.role === 'ADMIN'`.
2. **Admin Action Audit Trails:** All state-altering administrative actions (e.g., suspending a user, banning an account, resolving reports, modifying plan prices) are logged to structured audit streams with `adminId`, `targetId`, `action`, `reason`, and `timestamp`.

---

## 22. Block and Report Security

1. **Bidirectional Block Isolation:** When User A blocks User B, PostgreSQL constraints and discovery queries immediately prevent both users from discovering, matching, or messaging each other.
2. **Report Confidentiality:** Moderation reports and administrative investigation notes are accessible strictly by authenticated administrators. The reported user is never notified of the reporter's identity.

---

## 23. Database Security

1. **SQL Injection Defense:** All queries use Sequelize parameterized bindings or PostGIS spatial helper expressions. Raw string concatenations in SQL queries are strictly prohibited.
2. **Principle of Least Privilege:** Production database user credentials possess DML permissions (`SELECT`, `INSERT`, `UPDATE`, `DELETE`) but lack DDL permissions (`DROP TABLE`, `ALTER TABLE`) during runtime execution (DDL is restricted to migration runners).
3. **Encrypted Transport:** PostgreSQL connections require SSL encryption (`sslmode=require`).

---

## 24. Error Handling & Information Leakage

1. **Sanitized Production Responses:** In production environments (`NODE_ENV=production`), application stack traces, SQL syntax errors, database constraints, and internal file paths are stripped from error responses.
2. **Standard Error Envelope:** Errors return consistent JSON structures with standardized application error codes (e.g., `RESOURCE_NOT_FOUND`, `DAILY_LIMIT_REACHED`).

---

## 25. Logging and Audit Trails

### 25.1 Data Redaction Filter
Loggers (Winston/Pino) must pass all log streams through an automated redaction filter targeting sensitive keys:
* `password`, `password_hash`, `token`, `accessToken`, `refreshToken`, `authorization`, `otp`, `secret`, `razorpay_signature`, `keyId`, `location`.

### 25.2 Mandatory Audit Events
The following events must always generate structured audit logs:
* Failed authentication attempts (IP, identifier, timestamp).
* Account suspensions and bans (Admin ID, User ID, reason).
* Payment webhook lifecycle events (Event ID, provider, outcome).
* Security rate-limit trigger events.

---

## 26. CORS, Headers and HTTP Security

1. **Security Headers (Helmet):**
   * `Strict-Transport-Security` (HSTS): `max-age=31536000; includeSubDomains; preload`
   * `X-Content-Type-Options`: `nosniff`
   * `X-Frame-Options`: `DENY`
   * `Content-Security-Policy` (CSP): Strict default policy.
2. **CORS Policy:**
   * Whitelist explicit mobile and web client domains.
   * `Access-Control-Allow-Origin: *` is **STRICTLY PROHIBITED** on authenticated routes with credentials.
   * `credentials: true` enabled for HTTP-only cookie transmission.

---

## 27. Secrets and Environment Variables

1. **No Hardcoded Secrets:** No API keys, JWT secrets, database passwords, or AWS keys are committed to Git.
2. **Startup Environment Validation:** Application boot scripts validate all required environment variables using Zod schemas at startup (`src/config/env.ts`). If any secret is missing, the application crashes immediately with a configuration error.

---

## 28. File Upload Security

1. **Direct-to-S3 Architecture:** Uploads bypass application servers, eliminating server memory starvation / DoS attacks.
2. **MIME & Extension Whitelist:** Only `image/jpeg`, `image/png`, `image/webp` MIME types are permitted.
3. **Isolated S3 Key Generation:** Storage keys use server-generated UUIDs (`photos/{userId}/{uuid}.webp`). Client-provided original filenames are never used as storage paths.

---

## 29. Account Deletion and Data Retention

1. **Soft Delete Implementation:** User deletion sets `users.deleted_at = CURRENT_TIMESTAMP`, `status = 'DELETED'`, and revokes all active refresh tokens.
2. **Cascade Protection:** Financial transaction records (`payments`) and safety moderation records (`reports`) retain references with `ON DELETE SET NULL` to ensure tax and legal compliance.
3. **Hard Purge Window:** An automated background job permanently purges soft-deleted user records and removes S3 media binaries after a **30-day compliance retention window**.

---

## 30. Security Testing Standards

1. **Unit Security Tests:** Verify password hashing, JWT signing/expiration, Zod schema edge cases, and entitlement evaluations.
2. **Integration Security Tests (Supertest):**
   * Attempt IDOR access on profiles and messages.
   * Attempt discovery swipe bypassing when daily limits are reached.
   * Verify "Who Liked You" response censoring for Free tier users.
   * Verify Webhook HMAC signature verification and rejection of forged signatures.
3. **Negative Security Scenarios:**
   * Sending media messages from a Free user account (must return `403 PREMIUM_REQUIRED`).
   * Submitting negative or zero pricing in payment checkouts.
   * Accessing admin routes with standard `USER` tokens.

---

## 31. Developer Security Checklist

Before creating a Pull Request or deploying code, verify that all applicable items are satisfied:

### Authentication & Passwords
* [ ] Passwords hashed using Argon2id with verified parameters.
* [ ] JWT access token is short-lived (15 min) and contains no sensitive PII.
* [ ] Refresh token is transported in an `HttpOnly`, `Secure`, `SameSite=Strict` cookie.
* [ ] Refresh token rotation and reuse detection are enforced.
* [ ] Account logout revokes the refresh token in the database.

### Authorization & IDOR
* [ ] Authenticated endpoints enforce `auth.middleware.ts`.
* [ ] Admin endpoints enforce `requireRole('ADMIN')`.
* [ ] Resource ownership verified for all mutating operations (`resource.user_id === req.user.id`).
* [ ] Chat queries verify active match participation.

### Privacy & Data Protection
* [ ] Exact spatial coordinates (`latitude`, `longitude`) are NEVER returned in API responses.
* [ ] "Who Liked You" admirer details are redacted server-side for Free users.
* [ ] Response serializers are used to whitelist returned JSON attributes.
* [ ] Password hashes and tokens are excluded from Sequelize default scopes.

### Validation & Injection
* [ ] Request body, query parameters, and URL params validated using Zod.
* [ ] SQL queries use Sequelize parameterization (no raw string interpolation).
* [ ] JSON payload sizes are capped at 100 KiB.

### Monetization & Payments
* [ ] Entitlements are evaluated dynamically from server-side subscriptions.
* [ ] Daily swipe (10) and message (20) quotas for Free users are enforced atomically in PostgreSQL.
* [ ] Plan pricing is resolved server-side; client prices are ignored.
* [ ] Razorpay webhook HMAC signatures are verified before processing.
* [ ] Webhook processing is idempotent via `processed_webhooks`.

### File Uploads & S3
* [ ] Media uploaded directly to S3 via presigned URLs.
* [ ] S3 bucket has public access blocked.
* [ ] S3 object keys are generated using random UUIDs.

---

## 32. Open Questions / Conflicts

### SEC-OQ-01: Multi-Device Push Notification Payload Security
* **Issue:** When dispatching FCM/APNS push notifications for new messages or likes, should message text previews and admirer names be included in the push payload?
* **Why it matters:** Lock-screen push notifications could leak sensitive dating activity or message snippets to unauthorized onlookers.
* **Current recommendation:** Push notifications should display generic alerts by default (e.g., *"You have a new message"*, *"Someone liked your profile"*) without embedding private chat content or sender identities in the raw push payload.
* **Needs product decision:** No (Follows security best practices for dating privacy).

### SEC-OQ-02: Automated Image Moderation (NSFW / Nudity Detection)
* **Issue:** Product Requirements designate automated photo moderation as Phase 1.5. In Phase 1, photos are uploaded directly to S3 without automated scanning.
* **Why it matters:** Malicious users could upload inappropriate profile pictures before human admin review occurs via the reporting queue.
* **Current recommendation:** Rely on user reporting (`reports` table) and manual admin review for Phase 1. Integrate AWS Rekognition in Phase 1.5 via S3 event triggers.
* **Needs product decision:** No (Aligned with approved Phase 1 vs Phase 1.5 scope).
