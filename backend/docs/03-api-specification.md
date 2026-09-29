# Love Bite - API Specification & Contract

> **Document Path:** `backend/docs/03-api-specification.md`  
> **Target Version:** API v1 (`/api/v1`)  
> **Status:** Authoritative Backend Contract Specification  
> **Architecture Pattern:** Route $\rightarrow$ Controller $\rightarrow$ Service $\rightarrow$ Data Access $\rightarrow$ Sequelize Model $\rightarrow$ PostgreSQL/PostGIS

---

## 1. Overview

This document defines the **RESTful API Specification** and **Socket.IO Realtime Contract** for the **Love Bite** dating platform. It is the integration guide for frontend mobile/web engineers, and the contract for backend engineers and QA.

### Implementation status

Phase 2 authentication is implemented and verified. Sections **4** and **11** below describe that live behavior, including the basic profile API in section **11.14**. Sections **12** onward (full onboarding, the richer profile views, discovery, likes, chat, subscriptions, payments, and the rest) are the planned contract. Those routes are **not** mounted. Do not call them.

Health checks are also live: `GET /health` and `GET /api/v1/health`.

### Core Architectural Principles:
* **Strict REST Semantics:** Standard HTTP verbs (`GET`, `POST`, `PATCH`, `PUT`, `DELETE`) with resource-oriented URIs.
* **Dual-Token Authentication:** Ephemeral JWT Access Tokens (15-minute validity) paired with Rotating Refresh Tokens delivered via secure `HTTP-Only`, `SameSite=Strict`, `Secure` cookies.
* **Centralized Entitlements & Server-Side Enforcement:** Feature gating (Free vs. Premium tiers) and rate/usage quota limits (10 combined Swipes/day, 20 text messages/day for Free users) are strictly verified server-side. Frontend clients are never trusted with entitlement decisions.
* **Privacy & Security by Design:** 
  * Exact spatial coordinates (`latitude`, `longitude`) are **NEVER** returned in any client payload. Clients receive only the registered `city` and an approximate server-calculated distance in kilometers.
  * Liker identities for non-paying Free users are filtered server-side (returning only aggregate counts, with zero personal metadata or photos in API responses).
* **Idempotent Financial Operations:** Razorpay webhook events and client checkout verifications are guaranteed idempotent via database transaction boundaries and unique event ledgers.
* **Realtime Synchronization:** Socket.IO handles low-latency chat delivery and instant match alerts, backed by PostgreSQL as the authoritative persistence tier.

---

## 2. API Design Principles

1. **Layered Separation of Concerns:**
   * **Routes:** Define endpoint paths, bind HTTP verbs, and register middleware chains (`validate`, `authenticate`, `requireRole`, `rateLimit`).
   * **Controllers:** Extract parameters, headers, cookies, and validated bodies; invoke domain services; serialize standard JSON HTTP responses.
   * **Services:** Enforce all business rules, eligibility evaluations, entitlement checks, quota tracking, and multi-entity database transactions.
   * **Data Access:** Execute parameterized Sequelize queries, raw PostGIS spatial expressions, and transaction-bound writes.
2. **Predictable URL Structure:** Plural resource nouns prefixed by the API version: `/api/v1/<resource-name>`.
3. **Deterministic Status Codes:**
   * `200 OK` — Successful retrieval or idempotent mutation.
   * `201 Created` — Successful resource creation.
   * `204 No Content` — Successful deletion or action with no response payload.
   * `400 Bad Request` — Schema validation failure or invalid payload structure.
   * `401 Unauthorized` — Missing, expired, or cryptographically invalid JWT access token.
   * `403 Forbidden` — Insufficient role permissions or gated Premium feature entitlement required.
   * `404 Not Found` — Requested entity does not exist or has been soft-deleted.
   * `409 Conflict` — State conflict (e.g., unique constraint violation, duplicate like action).
   * `422 Unprocessable Entity` — Syntactically valid request failing domain business rules (e.g., underage registration).
   * `429 Too Many Requests` — Abuse-prevention rate limit or daily product usage quota exhausted.
   * `500 Internal Server Error` — Unhandled server exception (sanitized in production).

---

## 3. Base URL

All REST endpoints are rooted at:

```text
/api/v1
```

*Example:* `GET /api/v1/profiles/me`

---

## 4. Authentication

### 4.1 Token mechanics (implemented)

The access token is a short-lived **HS256 JWT**. The default lifetime is **15 minutes** (`expiresIn: 900` seconds). Send it on protected calls:

```http
Authorization: Bearer <accessToken>
```

The login response is the place to read `accessToken`, `expiresIn`, and `user`. Keep the access token in memory for the session. The refresh token is **not** a JWT and is **not** in the JSON body.

The refresh token is an opaque random value. The server stores only its SHA-256 hash. The browser receives it as an `HttpOnly` cookie:

| Cookie attribute | Value |
| :--- | :--- |
| Name | `refreshToken` |
| `HttpOnly` | `true` (JavaScript cannot read it) |
| `SameSite` | `Strict` |
| `Secure` | `true` in production only. Local HTTP development leaves it unset so the cookie can be stored. |
| `Path` | `/api/v1/auth/refresh` |
| `Max-Age` | 7 days |

Because the path is `/api/v1/auth/refresh`, the browser attaches this cookie only to `POST /api/v1/auth/refresh`. Do not put the refresh token in `localStorage` or `sessionStorage`. Do not try to read it from `document.cookie`.

CORS allows credentialed requests (`credentials: true`) from `CORS_ORIGIN` (default `http://localhost:3000`). The frontend HTTP client must send cookies:

* `fetch`: `credentials: 'include'`
* Axios: `withCredentials: true`

`SameSite=Strict` means the API and the web app must be same-site. A cross-site page will not receive or send this cookie.

Refreshing rotates the token: the previous refresh row is revoked and a new cookie is set. Presenting an already rotated refresh token revokes every active refresh row for that user and returns `401 INVALID_TOKEN`.

### 4.2 Which calls need a token

Live public routes (no `Authorization` header): register, verify-email, verify-phone, resend-verification, login, refresh, forgot-password, reset-password, `GET /genders`, `GET /interests`, and `GET /relationship-intentions`.

`POST /api/v1/auth/logout` is the only live route that requires `Authorization: Bearer <accessToken>`. An unverified account (`status: UNVERIFIED`) may log in and log out. Suspended and banned accounts are rejected with `403`.

There is no live admin API yet. `requireRole('ADMIN')` exists for later routes.

---

## 5. Authorization

Authorization is verified across four distinct tiers:
1. **Authentication Middleware (`auth.middleware.ts`):** Validates access token signature, checks user active status, and binds `req.user`.
2. **Role Authorization (`role.middleware.ts`):** Checks role privileges (e.g., `requireRole('ADMIN')`).
3. **Resource Ownership Guardrails:** Ensures users can only mutate their own records (e.g., `profiles.user_id === req.user.id`).
4. **Entitlement Guardrails (`entitlement.middleware.ts`):** Verifies active subscription feature entitlements and evaluates daily usage limits.

---

## 6. Common Request Format

* Standard HTTP request headers:
  * `Content-Type: application/json` (for JSON bodies)
  * `Authorization: Bearer <token>` (for authenticated endpoints)
  * `Idempotency-Key: <UUIDv4>` (optional/mandatory for state-mutating checkout/actions)
  * `X-Request-ID: <UUIDv4>` (client-supplied or generated by gateway for distributed tracing)

---

## 7. Common Response Format

### 7.1 Standard Success Response
```json
{
  "success": true,
  "data": {},
  "message": "Operation completed successfully"
}
```

### 7.2 Standard Paginated Success Response
```json
{
  "success": true,
  "data": {
    "items": [],
    "pagination": {
      "nextCursor": "eyJjcmVhdGVkQXQiOiIyMDI2LTA5LTE1VDEyOjAwOjAwLjAwMFoiLCJpZCI6InV1aWQtMSJ9",
      "hasMore": true,
      "limit": 20
    }
  }
}
```

---

## 8. Error Handling

All failed HTTP requests return a standardized, machine-parseable JSON error envelope:

```json
{
  "success": false,
  "error": {
    "code": "EXCEEDED_DAILY_LIKE_LIMIT",
    "message": "You have reached your daily limit of 10 likes/passes.",
    "details": [],
    "timestamp": "2026-09-15T10:30:00.000Z",
    "requestId": "c1a9f4e2-8821-4122-901b"
  }
}
```

### Core Error Codes Catalog:
| Error Code | HTTP Status | Meaning |
| :--- | :--- | :--- |
| `AUTH_REQUIRED` | 401 | Missing or malformed Authorization header. |
| `INVALID_TOKEN` | 401 | Expired, revoked, or signature-invalid JWT. |
| `INVALID_CREDENTIALS` | 401 | Email/Phone and password combination does not match. |
| `EMAIL_NOT_VERIFIED` | 403 | Account requires email verification. |
| `PHONE_NOT_VERIFIED` | 403 | Account requires SMS OTP verification. |
| `ACCOUNT_SUSPENDED` | 403 | User account is temporarily suspended by admin. |
| `ACCOUNT_BANNED` | 403 | User account has been permanently terminated. |
| `PROFILE_INCOMPLETE` | 403 | Onboarding is incomplete; discovery/matching locked. |
| `PREMIUM_REQUIRED` | 403 | Feature requires an active Premium subscription. |
| `FORBIDDEN` | 403 | Insufficient role permissions or resource access denied. |
| `RESOURCE_NOT_FOUND` | 404 | Target entity does not exist or is soft-deleted. |
| `USER_NOT_FOUND` | 404 | Target user profile not found. |
| `PROFILE_NOT_FOUND` | 404 | The authenticated user has no profile row. |
| `PROFILE_ALREADY_EXISTS` | 409 | The authenticated user already has a profile. |
| `INVALID_GENDER` | 400 | `genderId` is missing, unknown, or not an active gender. |
| `MATCH_NOT_FOUND` | 404 | Active match record does not exist. |
| `CONVERSATION_CLOSED` | 404 | Conversation is closed due to unmatch or safety block. |
| `DUPLICATE_IDENTIFIER` | 409 | Email or phone is already registered to an active account. |
| `ALREADY_SWIPED` | 409 | Target user has already been liked or permanently passed. |
| `ACTIVE_MATCH_EXISTS` | 409 | Users are already in an active mutual match. |
| `BLOCKED_USER` | 409 | Interaction prohibited due to an active safety block. |
| `VALIDATION_ERROR` | 400 | Request body/query failed Zod structural validation. |
| `UNDERAGE_NOT_PERMITTED`| 422 | User date of birth indicates age < 18 years. |
| `DAILY_LIMIT_REACHED` | 429 | Free tier daily swipe or message quota exhausted. |
| `RATE_LIMITED` | 429 | Exceeded endpoint request threshold per time window. |
| `PAYMENT_FAILED` | 402 | Gateway payment initiation or capture failed. |
| `IDEMPOTENCY_CONFLICT` | 409 | Concurrent request with identical Idempotency-Key in flight. |
| `INTERNAL_SERVER_ERROR`| 500 | Unexpected server error. |

---

## 9. Pagination Strategy

### 9.1 Cursor-Based Pagination (Feeds & Infinite Streams)
Used for Discovery candidates, Chat Messages, Inbox Dialogs, and Notifications.
* **Query Parameters:**
  * `limit`: Integer (Default: `20`, Max: `50`).
  * `cursor`: Base64-encoded string representing `(created_at, id)`.
* **Response Pagination Object:**
  ```json
  "pagination": {
    "nextCursor": "eyJjcmVhdGVkQXQiOiIyMDI2LTA5LTE1VDEyOjAwOjAwLjAwMFoiLCJpZCI6IjY2ZTIxYzg1..."},
    "hasMore": true,
    "limit": 20
  }
  ```

### 9.2 Offset-Based Pagination (Admin & Search)
Used exclusively for Admin Management Tables where jumping to arbitrary page numbers is required.
* **Query Parameters:**
  * `page`: Integer (Default: `1`).
  * `limit`: Integer (Default: `20`, Max: `100`).
* **Response Pagination Object:**
  ```json
  "pagination": {
    "total": 154,
    "page": 1,
    "limit": 20,
    "totalPages": 8
  }
  ```

---

## 10. API Versioning

* Versioning is embedded in the URI path: `/api/v1/`.
* Breaking schema or behavioral modifications require incrementing the route version (e.g., `/api/v2/`).

---

## 11. Authentication APIs (implemented)

Every live auth route is `POST` under `/api/v1/auth`. Send `Content-Type: application/json`. Success bodies use `{ success, data, message }`. Failures use the error envelope in section 8.

Password rules for register and reset: 8–128 characters, at least one uppercase letter, one digit, and one special character.

Phone numbers are E.164: `+`, a first digit from 1 to 9, then 1 to 14 more digits. Emails are trimmed and lowercased. An empty string for `email` or `phone` is treated as omitted.

### 11.1 Register account

* **Method and path:** `POST /api/v1/auth/register`
* **Auth:** None.
* **Rate limit:** 5 requests / 60 seconds / IP. Over the limit: `429 RATE_LIMITED`, message `Too many requests. Please try again later.`

Send email, phone, or both. At least one identifier is required.

```json
{
  "email": "alex.morgan@example.com",
  "phone": "+919876543210",
  "password": "SecurePassword123!",
  "dateOfBirth": "2002-06-15",
  "termsAccepted": true,
  "privacyAccepted": true
}
```

| Field | Required | Notes |
| :--- | :--- | :--- |
| `email` | One of email or phone | Valid email. Stored lowercased. |
| `phone` | One of email or phone | E.164. |
| `password` | Yes | Password rules above. |
| `dateOfBirth` | Yes | `YYYY-MM-DD`. Must be a real calendar date. Age is calculated in UTC and must be at least 18. |
| `termsAccepted` | Yes | Must be the boolean `true`. |
| `privacyAccepted` | Yes | Must be the boolean `true`. |

`dateOfBirth` is validated and then discarded. Phase 2 does **not** store it on the user, and it does **not** create a profile. Do not read the date of birth back from the user after registration. Phase 3 will persist it on the profile.

`201 Created`:

```json
{
  "success": true,
  "data": {
    "userId": "b2f6c91a-8821-4122-901b-5e4d29381029",
    "email": "alex.morgan@example.com",
    "phone": "+919876543210",
    "status": "UNVERIFIED",
    "emailVerified": false,
    "phoneVerified": false,
    "nextStep": "VERIFY_EMAIL"
  },
  "message": "Registration successful. Please verify your account."
}
```

There is no access token and no refresh cookie. `nextStep` is `VERIFY_EMAIL` when an email was sent, otherwise `VERIFY_PHONE`. If both identifiers are sent, only the email code is sent and `nextStep` is `VERIFY_EMAIL`.

A code is a 6-digit string, valid for 5 minutes, with 3 attempts. Registration also starts the 60-second resend window for that identifier, so an immediate resend returns `429`.

Frontend: show the verification screen for `nextStep`. Do not treat the user as logged in.

Errors:

* `400 VALIDATION_ERROR` — bad shape, missing identifier, weak password, or legal flags not exactly `true`. `error.details[]` has `field`, `message`, and `code`.
* `422 UNDERAGE_NOT_PERMITTED` — the only problem is age under 18. Message: `You must be at least 18 years old.` If other fields are also invalid, the response is `400`, not `422`.
* `409 DUPLICATE_IDENTIFIER` — an active account already uses that email or phone. Message: `An account with this email or phone already exists.`
* `429 RATE_LIMITED` — IP limit above.

A soft-deleted account does not block reuse of its email or phone.

### 11.2 Verify email

* **Method and path:** `POST /api/v1/auth/verify-email`
* **Auth:** None.

```json
{
  "email": "alex.morgan@example.com",
  "token": "481920"
}
```

`token` is the 6-digit code from the verification message, not a JWT.

`200 OK`:

```json
{
  "success": true,
  "data": {
    "verified": true,
    "status": "ACTIVE"
  },
  "message": "Email verified successfully."
}
```

`isVerified` is true when the account's email is verified, or when its phone is verified. Verifying email on an account that also has a phone still sets `status` to `ACTIVE` even if the phone is not verified yet. Suspended, banned, and deleted accounts keep their existing status.

Wrong, expired, exhausted, or unknown-email codes all return `401 INVALID_TOKEN` with message `Invalid or expired verification code.` The third wrong attempt deletes the code. Do not tell the user which of those cases happened.

After success, send the user to login. This call does not issue a session.

### 11.3 Verify phone

* **Method and path:** `POST /api/v1/auth/verify-phone`
* **Auth:** None.

```json
{
  "phone": "+919876543210",
  "otp": "839201"
}
```

`otp` is the 6-digit SMS code. The field name is `otp`, not `token`.

`200 OK`:

```json
{
  "success": true,
  "data": {
    "verified": true,
    "status": "ACTIVE"
  },
  "message": "Phone number verified successfully."
}
```

Failure is the same `401 INVALID_TOKEN` / `Invalid or expired verification code.` as email verification, including an unknown phone. A phone-only account becomes `ACTIVE` after this succeeds. Then go to login. No session is issued.

### 11.4 Resend verification

* **Method and path:** `POST /api/v1/auth/resend-verification`
* **Auth:** None.
* **Rate limit:** 1 request / 60 seconds / identifier. This is the same window registration already consumed.

```json
{
  "identifier": "alex.morgan@example.com",
  "type": "EMAIL"
}
```

`type` is `EMAIL` or `PHONE`. For `EMAIL`, `identifier` must be a valid email. For `PHONE`, it must be E.164. This route does **not** hide whether an account exists.

`200 OK`:

```json
{
  "success": true,
  "data": { "sent": true },
  "message": "Verification code resent."
}
```

Errors:

* `429 RATE_LIMITED` — `Please wait before requesting another verification code.` Disable the resend action for 60 seconds.
* `404 USER_NOT_FOUND` — no matching account, or the account is deleted. Message: `User not found.`
* `400 VALIDATION_ERROR` — bad identifier, or the channel is already verified (`Email is already verified.` / `Phone number is already verified.`).

### 11.5 Login

* **Method and path:** `POST /api/v1/auth/login`
* **Auth:** None.
* **Rate limit:** 5 requests / 60 seconds / IP.

```json
{
  "identifier": "alex.morgan@example.com",
  "password": "SecurePassword123!"
}
```

`identifier` is an email or an E.164 phone. Unverified accounts may log in.

`200 OK` also sets the `refreshToken` cookie described in section 4. The JSON body does not include the refresh token.

```json
{
  "success": true,
  "data": {
    "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "expiresIn": 900,
    "user": {
      "id": "b2f6c91a-8821-4122-901b-5e4d29381029",
      "email": "alex.morgan@example.com",
      "phone": null,
      "role": "USER",
      "status": "ACTIVE",
      "isVerified": true,
      "isProfileComplete": false
    }
  },
  "message": "Login successful."
}
```

Store `accessToken` in memory and send it as `Authorization: Bearer <accessToken>`. `expiresIn` is seconds. `isProfileComplete` is `false` until a later phase writes a completed profile. There is no date of birth on `user`.

The access-token claims are `sub` (user id), `role`, `isVerified`, `isProfileComplete`, `iat`, and `exp`. They are a snapshot. The login `user` object is the one to render.

Errors:

* `401 INVALID_CREDENTIALS` — unknown account, deleted account, or wrong password. Message: `Invalid credentials provided.`
* `403 ACCOUNT_SUSPENDED` — `Account is suspended.`
* `403 ACCOUNT_BANNED` — `Account is banned.`
* `429 RATE_LIMITED` — IP limit.
* `400 VALIDATION_ERROR` — identifier or password shape.

### 11.6 Refresh

* **Method and path:** `POST /api/v1/auth/refresh`
* **Auth:** The `refreshToken` cookie. No bearer token. No JSON body.
* **Client:** `credentials: 'include'` or Axios `withCredentials: true`.

```text
Access token expires or a protected call returns 401 INVALID_TOKEN
        ↓
POST /api/v1/auth/refresh with cookies enabled
        ↓
Browser sends the HttpOnly refresh cookie
        ↓
Server checks the opaque token, rotates it, and sets a new cookie
        ↓
Response contains a new access token
        ↓
Replace the in-memory access token and retry the original request once
```

`200 OK`:

```json
{
  "success": true,
  "data": {
    "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "expiresIn": 900
  },
  "message": "Token refreshed."
}
```

The new JWT carries the current `isVerified` and `isProfileComplete`. The user object is not returned again.

If refresh returns `401 INVALID_TOKEN` (`Invalid token.`), or `403 ACCOUNT_SUSPENDED` / `403 ACCOUNT_BANNED`, clear the in-memory access token and user, and show login. Do not loop on refresh. A reused (already rotated) refresh token is also `401 INVALID_TOKEN`, and the server revokes that user's remaining active refresh rows.

### 11.7 Logout

* **Method and path:** `POST /api/v1/auth/logout`
* **Auth:** `Authorization: Bearer <accessToken>`.
* **Body:** None.
* **Client:** Send credentials as well.

`200 OK`:

```json
{
  "success": true,
  "data": null,
  "message": "Logged out successfully."
}
```

The response clears the `refreshToken` cookie (same name, path, `SameSite`, and `Secure` flag). Clear the in-memory access token and user.

The cookie path is only `/api/v1/auth/refresh`, so the browser does not attach it to `/logout`. Logout still clears the cookie. It revokes the refresh row only when that cookie is actually present on this request and belongs to the authenticated user. An unverified user may log out. Missing or expired access tokens return `401 AUTH_REQUIRED` or `401 INVALID_TOKEN`.

### 11.8 Forgot password

* **Method and path:** `POST /api/v1/auth/forgot-password`
* **Auth:** None.
* **Rate limit:** 5 requests / 60 seconds / IP.

```json
{
  "identifier": "alex.morgan@example.com"
}
```

`identifier` is an email or E.164 phone.

`200 OK` with `data: null` and this message, whether or not an account exists:

```text
If an account exists for this identifier, password reset instructions have been sent.
```

Do not branch the UI on whether the account exists. Always show that generic confirmation. A deleted account gets the same `200` and no message is sent.

When an account exists, the reset token is a 64-character hex string, valid for 15 minutes. It is sent by the current mock email or SMS provider. It is not a 6-digit code.

`429 RATE_LIMITED` uses the IP-limit message. `400 VALIDATION_ERROR` means the identifier is not a valid email or phone.

### 11.9 Reset password

* **Method and path:** `POST /api/v1/auth/reset-password`
* **Auth:** None.

```json
{
  "identifier": "alex.morgan@example.com",
  "token": "64-character-hex-reset-token",
  "newPassword": "NewSecurePassword123!"
}
```

`identifier` must be the same email or phone used for forgot-password. `newPassword` uses the register password rules.

`200 OK`:

```json
{
  "success": true,
  "data": null,
  "message": "Password reset successfully. Please log in."
}
```

The server revokes active refresh rows for that user. This call does not log the user in. Navigate to login.

Invalid, expired, mismatched, or already-used tokens return `401 INVALID_TOKEN` with message `Invalid or expired reset token.` Ask the user to request a new reset. `400 VALIDATION_ERROR` covers a weak new password or a bad identifier.

### 11.10 Account fields the UI can rely on

From registration:

| Field | Meaning |
| :--- | :--- |
| `status` | `UNVERIFIED` until a required identifier is verified. Then `ACTIVE`, unless the account is `SUSPENDED`, `BANNED`, or `DELETED`. |
| `emailVerified` / `phoneVerified` | That channel only. |
| `nextStep` | `VERIFY_EMAIL` or `VERIFY_PHONE`. |

From login `user`, and from access-token claims:

| Field | Meaning |
| :--- | :--- |
| `role` | `USER` for accounts created by register. `ADMIN` is not issued by these routes. |
| `isVerified` | True when a stored email is verified, or a stored phone is verified. |
| `isProfileComplete` | True only when a profile row says so. Registration does not create one, so this is `false` after Phase 2 login. |

`DELETED` accounts behave as unknown on login (`401 INVALID_CREDENTIALS`). They are not a screen the client renders from a successful auth response.

### 11.11 Errors the auth UI should handle

| Status | Code | What to do |
| :--- | :--- | :--- |
| 400 | `VALIDATION_ERROR` | Show `error.details` on the matching fields. Message is `Validation failed` for schema failures. |
| 401 | `AUTH_REQUIRED` | No bearer token, or it is not `Bearer <token>`. Send the user through login. |
| 401 | `INVALID_TOKEN` | Expired or bad access token: try refresh once. Refresh, verify, and reset failures: go to the relevant form, do not loop. |
| 401 | `INVALID_CREDENTIALS` | Show the invalid-credentials message. Do not say which field was wrong. |
| 403 | `ACCOUNT_SUSPENDED` or `ACCOUNT_BANNED` | Block the session and show the message. Do not refresh. |
| 403 | `EMAIL_NOT_VERIFIED` or `PHONE_NOT_VERIFIED` | Not returned by the Phase 2 auth routes. Reserved for later routes that require verification. |
| 404 | `USER_NOT_FOUND` | Resend only. The identifier has no account. |
| 409 | `DUPLICATE_IDENTIFIER` | Registration. Offer login. |
| 422 | `UNDERAGE_NOT_PERMITTED` | Registration. Block submit. |
| 429 | `RATE_LIMITED` | Show the message and wait. There is no `Retry-After` header. |
| 500 | `INTERNAL_SERVER_ERROR` | Generic failure. Message: `An unexpected error occurred. Please try again later.` |

### 11.12 What is live, and what Phase 3 will add

Live now: registration, email and phone verification, resend, login, refresh, logout, forgot-password, reset-password, the public catalog reads in section 11.13, and the authenticated basic profile API in section 11.14.

Not implemented, even though the database tables exist: the rest of onboarding, photo upload, interest selection, relationship-intention selection, dating preferences, location, the richer profile views in section 13, discovery, likes, matches, chat, subscriptions, payments, and boosts. Do not call those paths.

Phase 3 Step 1 is the three public catalog reads. Phase 3 Step 3 is `GET`, `POST`, and `PATCH /api/v1/profile`. Gender and relationship-intention seed data exist. Production interests are not seeded, because the approved interest list is not defined. Phase 3 is not complete. Later sections remain the planned contract unless a subsection says it is implemented.

### 11.13 Public catalog reads

Implemented. These three reads are public. They do not use `authenticate` or `requireVerified`. They share the public IP rate limit: 100 requests / 60 seconds / IP, Redis key `ratelimit:public:<ip>`. Over the limit: `429 RATE_LIMITED`.

Only active rows are returned, ordered by `display_order` ascending. An empty catalog is success: `200` with `data: []`. Responses use the standard success envelope and do not include `isActive`, `displayOrder`, or timestamps.

#### List active genders

* **Method & Path:** `GET /api/v1/genders`
* **Auth:** Public
* **Seed data:** `MAN` / Man, `WOMAN` / Woman, `NON_BINARY` / Non-binary, `PREFER_NOT_TO_SAY` / Prefer not to say. All are active. Display order is 1 through 4.
* **Success Response (`200 OK`):**

```json
{
  "success": true,
  "data": [
    { "id": "6e6e0001-0000-4000-8000-000000000001", "code": "MAN", "name": "Man" }
  ],
  "message": "Genders retrieved successfully"
}
```

#### List active interests

* **Method & Path:** `GET /api/v1/interests`
* **Auth:** Public
* **Seed data:** none. The approved production interest list is not defined. The endpoint returns whatever active rows exist.
* **Success Response (`200 OK`):** `data` items are `{ "id", "code", "name", "category" }`. `category` may be `null`. Message: `Interests retrieved successfully`. An empty table returns `data: []`.

#### List active relationship intentions

* **Method & Path:** `GET /api/v1/relationship-intentions`
* **Auth:** Public
* **Seed data:** `LONG_TERM_RELATIONSHIP` / Long-term relationship, `SOMETHING_CASUAL` / Something casual, `FRIENDSHIP` / Friendship, `NOT_SURE_YET` / Not sure yet. All are active. Display order is 1 through 4. `description` is not returned.
* **Success Response (`200 OK`):** `data` items are `{ "id", "code", "name" }`. Message: `Relationship intentions retrieved successfully`.

### 11.14 Basic profile

Implemented. These three routes are the authenticated user's own basic profile. They are not public. They do not accept another user's id. There is no rate limiter on these routes; the public catalog limiter does not apply.

* **Auth:** `Authorization: Bearer <accessToken>` and role `USER`.
* **Missing or malformed token:** `401 AUTH_REQUIRED`.
* **Invalid or expired token:** `401 INVALID_TOKEN`.
* **Suspended or banned account:** `403 ACCOUNT_SUSPENDED` or `403 ACCOUNT_BANNED`, from the existing authentication middleware.
* **Any other role, including `ADMIN`:** `403 FORBIDDEN`.
* **Verification:** `requireVerified` is not applied. An unverified `USER` may call these routes.

Registration still validates `dateOfBirth` and does not store it. It does not create a profile. These routes are where the basic profile, including date of birth, is stored.

The response `data` object is only:

```json
{
  "id": "b2f6c91a-8821-4122-901b-5e4d29381029",
  "userId": "a1e5b80f-7710-4011-890a-4d3c18270918",
  "firstName": "John",
  "dateOfBirth": "1998-05-10",
  "gender": { "id": "9a12c4b5-8821-4122-901b-5e4d29381001", "code": "MAN", "name": "Man" },
  "bio": "Coffee and long walks.",
  "occupation": "Engineer",
  "education": "B.Tech",
  "city": null,
  "isProfileComplete": false
}
```

`city` is returned and is null until a later location step. `location` is never returned. Password hashes, refresh tokens, OTP data, and other user security fields are not returned.

`isProfileComplete` is stored on `profiles.is_profile_complete` and is never taken from the request. Creating or updating a basic profile does not set it to `true`. It stays `false` while city, location, a primary photo, 3–10 interests, at least one relationship intention, or dating preferences are missing. This step does not write those values. A later completion step is what sets the flag. Editing a basic field does not clear a flag that was already `true`.

#### Get own profile

* **Method & Path:** `GET /api/v1/profile`
* **Body:** none. This request does not create or update a row.
* **Success Response (`200 OK`):** the profile object above. Message: `Profile retrieved successfully`.
* **No profile:** `404 PROFILE_NOT_FOUND`.

#### Create own profile

* **Method & Path:** `POST /api/v1/profile`
* **Success Response (`201 Created`):** the profile object above. Message: `Profile created successfully`.
* **Duplicate:** `409 PROFILE_ALREADY_EXISTS`. The existing row is not overwritten.
* **Request body:**

| Field | Required | Rule |
| :--- | :--- | :--- |
| `firstName` | Yes | String. Trimmed. 1–100 characters (`profiles.first_name`). |
| `dateOfBirth` | Yes | `YYYY-MM-DD`. Must be a real calendar date. Age is calculated in UTC and must be at least 18. |
| `genderId` | Yes | UUID of an active gender. Unknown or inactive: `400 INVALID_GENDER`. |
| `bio` | No | String or `null`. Trimmed. Max 500 characters. Blank becomes `null`. |
| `occupation` | No | String or `null`. Trimmed. Max 100 characters. Blank becomes `null`. |
| `education` | No | String or `null`. Trimmed. Max 100 characters. Blank becomes `null`. |

Any other field is rejected with `400 VALIDATION_ERROR`, including `userId`, `id`, `isProfileComplete`, `city`, `location`, `interests`, `relationshipIntentions`, `datingPreferences`, and `photos`. Ownership always comes from the access token.

`422 UNDERAGE_NOT_PERMITTED` is returned when the only failure is an underage date of birth. `chk_profiles_age_18_plus` remains the database safeguard.

#### Update own profile

* **Method & Path:** `PATCH /api/v1/profile`
* **Success Response (`200 OK`):** the profile object above. Message: `Profile updated successfully`.
* **No profile:** `404 PROFILE_NOT_FOUND`. This is not an upsert.
* **Empty body:** `400 VALIDATION_ERROR`. No update is executed.
* **Request body:** any subset of `firstName`, `dateOfBirth`, `genderId`, `bio`, `occupation`, and `education`, using the same rules as create. At least one of those fields is required. The same forbidden fields are rejected. A partial body changes only the fields that were sent. `null` clears `bio`, `occupation`, or `education`.

---

## 12. Onboarding APIs

**Not implemented.** The onboarding routes in this section are the planned contract only. They are not mounted. The live basic profile API is section 11.14. Public catalog reads are live in section 11.13.

The onboarding pipeline enforces sequential profile completion before granting access to discovery.

### 12.1 Get Onboarding Status
* **Method & Path:** `GET /api/v1/onboarding/status`
* **Auth:** Authenticated
* **Success Response (`200 OK`):**
  ```json
  {
    "success": true,
    "data": {
      "isVerified": true,
      "isProfileComplete": false,
      "completedSteps": ["VERIFICATION", "BASIC_PROFILE", "PHOTOS"],
      "nextStep": "INTERESTS"
    }
  }
  ```

---

### 12.2 Save Basic Profile Info
* **Method & Path:** `PATCH /api/v1/onboarding/profile`
* **Auth:** Authenticated
* **Request Body:**
  ```json
  {
    "firstName": "Alex",
    "genderId": "9a12c4b5-8821-4122-901b-5e4d29381001",
    "bio": "Adventure enthusiast, coffee lover, and dog parent.",
    "occupation": "Software Engineer",
    "education": "B.Tech Computer Science"
  }
  ```
* **Validation:** `firstName` (1–50 chars), `genderId` (valid UUID referencing active gender), `bio` (max 500 chars).
* **Success Response (`200 OK`):** Returns updated profile summary.

---

### 12.3 Set Onboarding Interests
* **Method & Path:** `PUT /api/v1/onboarding/interests`
* **Auth:** Authenticated
* **Request Body:**
  ```json
  {
    "interestIds": [
      "1a2b3c4d-0001-4000-8000-000000000001",
      "1a2b3c4d-0002-4000-8000-000000000002",
      "1a2b3c4d-0003-4000-8000-000000000003"
    ]
  }
  ```
* **Validation:** Array of active interest UUIDs, **min 3, max 10 items**.
* **Success Response (`200 OK`):** Returns selected interest list.

---

### 12.4 Set Onboarding Relationship Intentions
* **Method & Path:** `PUT /api/v1/onboarding/relationship-intentions`
* **Auth:** Authenticated
* **Request Body:**
  ```json
  {
    "relationshipIntentionIds": [
      "2a3b4c5d-0001-4000-8000-000000000001"
    ]
  }
  ```
* **Validation:** Array of active intention UUIDs, **min 1 item**.
* **Success Response (`200 OK`):** Returns selected intention list.

---

### 12.5 Set Onboarding Dating Preferences
* **Method & Path:** `PUT /api/v1/onboarding/dating-preferences`
* **Auth:** Authenticated
* **Request Body:**
  ```json
  {
    "minAge": 22,
    "maxAge": 32,
    "maxDistanceKm": 40,
    "interestedInGenderIds": [
      "9a12c4b5-8821-4122-901b-5e4d29381002"
    ],
    "preferredIntentionIds": [
      "2a3b4c5d-0001-4000-8000-000000000001"
    ]
  }
  ```
* **Validation:** `minAge >= 18`, `maxAge <= 100`, `maxAge >= minAge`, `maxDistanceKm` between 1 and 500.
* **Success Response (`200 OK`):** Returns stored dating preferences.

---

### 12.6 Set Onboarding Location
* **Method & Path:** `PUT /api/v1/onboarding/location`
* **Auth:** Authenticated
* **Request Body:**
  ```json
  {
    "city": "Bengaluru",
    "latitude": 12.9716,
    "longitude": 77.5946
  }
  ```
* **Validation:** `city` (string, max 100), `latitude` (-90 to 90), `longitude` (-180 to 180).
* **Success Response (`200 OK`):** Returns `{ "city": "Bengaluru", "updated": true }`. *Coordinates are never reflected.*

---

### 12.7 Finalize Onboarding & Complete Profile
* **Method & Path:** `POST /api/v1/onboarding/complete`
* **Auth:** Authenticated
* **Purpose:** Server validates all onboarding prerequisites (verification, basic profile, $\ge 1$ photo, 3–10 interests, $\ge 1$ intention, dating preferences, location).
* **Success Response (`200 OK`):**
  ```json
  {
    "success": true,
    "data": {
      "isProfileComplete": true,
      "status": "ACTIVE"
    },
    "message": "Onboarding complete! Welcome to Love Bite."
  }
  ```
* **Errors:** `400 PROFILE_INCOMPLETE` with `details` listing missing prerequisite steps.

---

## 13. Profile APIs

**Not implemented.** The routes in this section are the planned fuller profile contract, including photos, interests, and public profiles. They are not mounted. The live basic profile API is `GET`, `POST`, and `PATCH /api/v1/profile` in section 11.14.

### 13.1 Get Current User Profile (Private View)
* **Method & Path:** `GET /api/v1/profiles/me`
* **Auth:** Authenticated
* **Success Response (`200 OK`):**
  ```json
  {
    "success": true,
    "data": {
      "id": "b2f6c91a-8821-4122-901b-5e4d29381029",
      "firstName": "Alex",
      "dateOfBirth": "2002-06-15",
      "age": 24,
      "gender": { "id": "9a12c4b5...", "name": "Woman", "code": "WOMAN" },
      "bio": "Adventure enthusiast and coffee lover.",
      "occupation": "Software Engineer",
      "education": "B.Tech Computer Science",
      "city": "Bengaluru",
      "isProfileComplete": true,
      "photos": [
        {
          "id": "photo-uuid-1",
          "url": "https://cdn.lovebite.app/signed/photos/...",
          "displayOrder": 1,
          "isPrimary": true
        }
      ],
      "interests": [
        { "id": "int-uuid-1", "name": "Hiking", "code": "HIKING" }
      ],
      "relationshipIntentions": [
        { "id": "int-uuid-1", "name": "Long-term relationship", "code": "LONG_TERM_RELATIONSHIP" }
      ]
    }
  }
  ```

---

### 13.2 Update Current User Profile
* **Method & Path:** `PATCH /api/v1/profiles/me`
* **Auth:** Authenticated
* **Request Body:** Partial profile fields (`firstName`, `bio`, `occupation`, `education`).  
  *Note: `dateOfBirth` cannot be modified post-onboarding without admin review.*
* **Success Response (`200 OK`):** Returns updated private profile.

---

### 13.3 View Another User's Profile (Public View)
* **Method & Path:** `GET /api/v1/profiles/:userId`
* **Auth:** Authenticated
* **Business Rules:**
  * Checks bidirectional block state (returns `404 NOT_FOUND` if blocked).
  * Obfuscates exact coordinates; returns only `city` and server-calculated `distanceKm`.
  * Returns active photos, interests, intentions, bio, occupation, and education.
* **Success Response (`200 OK`):**
  ```json
  {
    "success": true,
    "data": {
      "id": "c3e7d81b-9932-4233-812c-6f5e39482130",
      "firstName": "Jordan",
      "age": 25,
      "gender": { "name": "Man", "code": "MAN" },
      "bio": "Photographer exploring the world.",
      "occupation": "Freelance Designer",
      "education": "NID Ahmedabad",
      "city": "Bengaluru",
      "distanceKm": 4,
      "photos": [
        { "id": "photo-uuid-2", "url": "https://cdn.lovebite.app/signed/...", "displayOrder": 1, "isPrimary": true }
      ],
      "interests": [
        { "id": "int-1", "name": "Photography" },
        { "id": "int-2", "name": "Travel" },
        { "id": "int-3", "name": "Art" }
      ],
      "relationshipIntentions": [
        { "id": "rel-1", "name": "Long-term relationship" }
      ]
    }
  }
  ```

---

## 14. Photo APIs

### 14.1 Request Presigned S3 Upload Slot
* **Method & Path:** `POST /api/v1/profile-photos/upload-url`
* **Auth:** Authenticated
* **Purpose:** Generates a short-lived S3 `PutObject` presigned URL and reserves a photo slot.
* **Request Body:**
  ```json
  {
    "mimeType": "image/webp",
    "fileSizeBytes": 2048576,
    "originalFilename": "profile_pic.webp"
  }
  ```
* **Validation:** `mimeType` in `['image/jpeg', 'image/png', 'image/webp']`, `fileSizeBytes <= 10485760` (10 MB). Max 5 active photos per user.
* **Success Response (`200 OK`):**
  ```json
  {
    "success": true,
    "data": {
      "photoId": "photo-uuid-1",
      "uploadUrl": "https://lovebite-private-photos.s3.amazonaws.com/photos/user-id/photo-uuid-1.webp?X-Amz-...",
      "storageKey": "photos/b2f6c91a.../photo-uuid-1.webp",
      "expiresInSeconds": 300
    }
  }
  ```

---

### 14.2 Confirm Uploaded Photo Metadata
* **Method & Path:** `POST /api/v1/profile-photos/confirm`
* **Auth:** Authenticated
* **Request Body:**
  ```json
  {
    "photoId": "photo-uuid-1",
    "storageKey": "photos/b2f6c91a.../photo-uuid-1.webp",
    "displayOrder": 1,
    "isPrimary": true
  }
  ```
* **Success Response (`201 Created`):** Returns confirmed photo metadata.

---

### 14.3 List Current User Photos
* **Method & Path:** `GET /api/v1/profile-photos`
* **Auth:** Authenticated
* **Success Response (`200 OK`):** Returns array of photo objects with signed GET CDN URLs.

---

### 14.4 Update Photo Order or Primary Flag
* **Method & Path:** `PATCH /api/v1/profile-photos/:photoId`
* **Auth:** Authenticated
* **Request Body:**
  ```json
  {
    "displayOrder": 2,
    "isPrimary": false
  }
  ```
* **Success Response (`200 OK`):** Returns updated photo list.

---

### 14.5 Delete Photo
* **Method & Path:** `DELETE /api/v1/profile-photos/:photoId`
* **Auth:** Authenticated
* **Business Rules:**
  * Cannot delete if it is the only remaining photo of a completed profile (minimum 1 required).
  * If the primary photo is deleted, the next photo in `displayOrder` is automatically designated primary.
* **Success Response (`200 OK`):** Returns `{ "deleted": true }`.

---

## 15. Interest APIs

### 15.1 List Active Interests
* **Status:** Implemented. See section 11.13. Public, active rows only, `display_order` ascending. Empty `data: []` is success. Production interests are not seeded.
* **Method & Path:** `GET /api/v1/interests`
* **Auth:** Public
* **Success Response (`200 OK`):** Message is `Interests retrieved successfully`. Item fields are `id`, `code`, `name`, and `category`. The sample below is illustrative only; those interest names are not seed data.
  ```json
  {
    "success": true,
    "data": [
      { "id": "int-uuid-1", "code": "HIKING", "name": "Hiking & Outdoors", "category": "Sports" },
      { "id": "int-uuid-2", "code": "COFFEE", "name": "Coffee & Cafes", "category": "Food & Drink" }
    ]
  }
  ```

---

### 15.2 Update Current User Interests
* **Method & Path:** `PUT /api/v1/me/interests`
* **Auth:** Authenticated
* **Request Body:** `{ "interestIds": ["uuid-1", "uuid-2", "uuid-3"] }` (min 3, max 10).
* **Success Response (`200 OK`):** Returns updated user interest list.

---

## 16. Relationship Intention APIs

### 16.1 List Active Relationship Intentions
* **Status:** Implemented. See section 11.13. Public, active rows only, `display_order` ascending.
* **Method & Path:** `GET /api/v1/relationship-intentions`
* **Auth:** Public
* **Success Response (`200 OK`):** Returns active intentions (`LONG_TERM_RELATIONSHIP`, `SOMETHING_CASUAL`, `FRIENDSHIP`, `NOT_SURE_YET`) as `{ "id", "code", "name" }`. Message: `Relationship intentions retrieved successfully`.

---

### 16.2 Update Current User Intentions
* **Method & Path:** `PUT /api/v1/me/relationship-intentions`
* **Auth:** Authenticated
* **Request Body:** `{ "relationshipIntentionIds": ["uuid-1", "uuid-2"] }` ($\ge 1$).
* **Success Response (`200 OK`):** Returns updated intentions list.

---

## 17. Dating Preference APIs

### 17.1 Get Dating Preferences
* **Method & Path:** `GET /api/v1/dating-preferences`
* **Auth:** Authenticated
* **Success Response (`200 OK`):**
  ```json
  {
    "success": true,
    "data": {
      "minAge": 21,
      "maxAge": 30,
      "maxDistanceKm": 35,
      "interestedInGenders": [
        { "id": "gen-1", "code": "WOMAN", "name": "Woman" }
      ],
      "preferredIntentions": [
        { "id": "rel-1", "code": "LONG_TERM_RELATIONSHIP", "name": "Long-term relationship" }
      ]
    }
  }
  ```

---

### 17.2 Update Dating Preferences
* **Method & Path:** `PUT /api/v1/dating-preferences`
* **Auth:** Authenticated
* **Request Body:**
  ```json
  {
    "minAge": 21,
    "maxAge": 30,
    "maxDistanceKm": 35,
    "interestedInGenderIds": ["gen-1"],
    "preferredIntentionIds": ["rel-1"]
  }
  ```
* **Success Response (`200 OK`):** Returns updated preferences.

---

## 18. Location APIs

### 18.1 Update User Location
* **Method & Path:** `PUT /api/v1/location`
* **Auth:** Authenticated
* **Request Body:**
  ```json
  {
    "city": "Bengaluru",
    "latitude": 12.9716,
    "longitude": 77.5946
  }
  ```
* **Success Response (`200 OK`):**
  ```json
  {
    "success": true,
    "data": { "city": "Bengaluru", "updated": true },
    "message": "Location updated."
  }
  ```

---

## 19. Discovery APIs

### 19.1 Get Next Discovery Candidate Card
* **Method & Path:** `GET /api/v1/discovery`
* **Auth:** Authenticated
* **Behavior & Business Rules:**
  * Evaluates PostGIS mutual distance (`ST_DWithin`) using `idx_profiles_location_gist`.
  * Enforces mutual age, gender, and relationship intention filters.
  * Excludes: self, incomplete profiles, inactive accounts, active matches, blocks, and permanently passed profiles.
  * Applies Boost multipliers to discovery candidate ranking.
  * **Quota Rule:** Browsing candidate profiles is **unlimited for both Free and Premium users**. Quota is consumed ONLY upon submitting a Like or Pass action.
* **Success Response (`200 OK`):**
  ```json
  {
    "success": true,
    "data": {
      "candidate": {
        "id": "c3e7d81b-9932-4233-812c-6f5e39482130",
        "firstName": "Jordan",
        "age": 25,
        "gender": { "name": "Woman", "code": "WOMAN" },
        "bio": "Designer & coffee enthusiast.",
        "occupation": "Product Designer",
        "education": "NID",
        "city": "Bengaluru",
        "distanceKm": 4,
        "isSuperLiked": false,
        "photos": [
          { "id": "p-1", "url": "https://cdn.lovebite.app/signed/...", "displayOrder": 1, "isPrimary": true },
          { "id": "p-2", "url": "https://cdn.lovebite.app/signed/...", "displayOrder": 2, "isPrimary": false }
        ],
        "interests": [{ "id": "int-1", "name": "Design" }, { "id": "int-2", "name": "Coffee" }],
        "relationshipIntentions": [{ "id": "rel-1", "name": "Long-term relationship" }]
      }
    }
  }
  ```
  *(Returns `data: { "candidate": null }` if no eligible candidates remain in the stack).*

---

## 20. Like / Pass APIs

### 20.1 Like a Profile
* **Method & Path:** `POST /api/v1/discovery/:userId/like`
* **Auth:** Authenticated
* **Quota Enforcement:** 
  * Free users: Consumes 1 from the combined 10 daily Like/Pass quota. Throws `429 DAILY_LIMIT_REACHED` if exhausted.
  * Premium users: Unlimited actions.
* **Transaction Execution:**
  * Checks for reciprocal like with row lock (`SELECT FOR UPDATE`).
  * If reciprocal like exists $\rightarrow$ Creates `matches` row (`status = 'ACTIVE'`) + creates `conversations` row + emits realtime `match:new` Socket.IO event.
* **Success Response (`200 OK`):**
  ```json
  {
    "success": true,
    "data": {
      "action": "LIKE",
      "targetUserId": "c3e7d81b-9932-4233-812c-6f5e39482130",
      "isMatch": true,
      "matchId": "m-8821c4b5-1111-4000-8000-000000000001",
      "remainingDailyActions": 9
    },
    "message": "It's a Match!"
  }
  ```

---

### 20.2 Pass a Profile
* **Method & Path:** `POST /api/v1/discovery/:userId/pass`
* **Auth:** Authenticated
* **Quota Enforcement:** Consumes 1 from combined 10 daily quota for Free users.
* **Permanence:** Stored in `likes` (`action = 'PASS'`). Excludes candidate permanently from future discovery.
* **Success Response (`200 OK`):**
  ```json
  {
    "success": true,
    "data": {
      "action": "PASS",
      "targetUserId": "c3e7d81b-9932-4233-812c-6f5e39482130",
      "remainingDailyActions": 8
    },
    "message": "Profile passed."
  }
  ```

---

### 20.3 Super Like a Profile
* **Method & Path:** `POST /api/v1/discovery/:userId/super-like`
* **Auth:** Authenticated (Requires active Super Like credit balance)
* **Success Response (`200 OK`):** Returns action summary and decremented Super Like balance.

---

## 21. Undo APIs

### 21.1 Undo Immediately Preceding Action
* **Method & Path:** `POST /api/v1/discovery/undo`
* **Auth:** Authenticated (Premium Entitlement: `UNDO_ACTION`)
* **Business Rules:**
  * Restricted to active Premium subscribers (Free users receive `403 PREMIUM_REQUIRED`).
  * Reverts only the immediately previous action (`likes.is_undone = TRUE`).
  * If the previous action created an active match, the transaction invalidates the `matches` record (`status = 'UNDONE'`), closes the conversation, and reverts state.
  * Undo does NOT consume daily Like/Pass quota.
* **Success Response (`200 OK`):**
  ```json
  {
    "success": true,
    "data": {
      "undoneAction": "PASS",
      "targetUserId": "c3e7d81b-9932-4233-812c-6f5e39482130",
      "revertedMatch": false
    },
    "message": "Previous action undone."
  }
  ```

---

## 22. Match APIs

### 22.1 List Active Matches
* **Method & Path:** `GET /api/v1/matches`
* **Auth:** Authenticated
* **Query Params:** `limit` (default 20), `cursor`
* **Success Response (`200 OK`):**
  ```json
  {
    "success": true,
    "data": {
      "items": [
        {
          "matchId": "m-8821c4b5-1111-4000-8000-000000000001",
          "matchedAt": "2026-09-15T08:30:00.000Z",
          "conversationId": "conv-uuid-1",
          "user": {
            "id": "c3e7d81b-9932-4233-812c-6f5e39482130",
            "firstName": "Jordan",
            "age": 25,
            "city": "Bengaluru",
            "primaryPhotoUrl": "https://cdn.lovebite.app/signed/..."
          },
          "lastMessage": {
            "content": "Hey Alex! Loved your hiking photos.",
            "sentAt": "2026-09-15T08:35:00.000Z"
          }
        }
      ],
      "pagination": { "nextCursor": null, "hasMore": false, "limit": 20 }
    }
  }
  ```

---

### 22.2 Unmatch a User
* **Method & Path:** `DELETE /api/v1/matches/:matchId`
* **Auth:** Authenticated
* **Business Rules:**
  * Transitions match `status = 'UNMATCHED'`, sets `unmatched_at = CURRENT_TIMESTAMP`, `unmatched_by_user_id = req.user.id`.
  * Closes conversation (`conversations.status = 'CLOSED'`).
  * Preserves message history in PostgreSQL for safety/audit compliance.
  * Allows legitimate future re-matching if users encounter each other again.
* **Success Response (`200 OK`):**
  ```json
  {
    "success": true,
    "data": { "unmatched": true },
    "message": "Unmatched successfully."
  }
  ```

---

## 23. Conversation APIs

### 23.1 List Inbox Conversations
* **Method & Path:** `GET /api/v1/conversations`
* **Auth:** Authenticated
* **Success Response (`200 OK`):** Returns cursor-paginated active conversation threads with unread counts and last message previews.

---

### 23.2 Get Conversation Details
* **Method & Path:** `GET /api/v1/conversations/:conversationId`
* **Auth:** Authenticated
* **Success Response (`200 OK`):** Returns conversation status, match participant metadata, and unread count.

---

## 24. Message APIs

### 24.1 List Messages in a Conversation
* **Method & Path:** `GET /api/v1/conversations/:conversationId/messages`
* **Auth:** Authenticated
* **Query Params:** `limit` (default 20), `cursor`
* **Success Response (`200 OK`):**
  ```json
  {
    "success": true,
    "data": {
      "items": [
        {
          "id": "msg-uuid-1",
          "conversationId": "conv-uuid-1",
          "senderId": "c3e7d81b-9932-4233-812c-6f5e39482130",
          "messageType": "TEXT",
          "content": "Hey Alex! How is your week going?",
          "mediaUrl": null,
          "readAt": "2026-09-15T08:40:00.000Z",
          "createdAt": "2026-09-15T08:35:00.000Z"
        }
      ],
      "pagination": { "nextCursor": null, "hasMore": false, "limit": 20 }
    }
  }
  ```

---

### 24.2 Send a Message
* **Method & Path:** `POST /api/v1/conversations/:conversationId/messages`
* **Auth:** Authenticated
* **Quota & Entitlement Rules:**
  * Free tier: Max 20 text messages/day. Attachments (`IMAGE`, `VIDEO`, `VOICE`, `GIF`) strictly prohibited (throws `403 PREMIUM_REQUIRED`).
  * Premium tier: Unlimited text messages + full media attachment permissions.
* **Request Body:**
  ```json
  {
    "messageType": "TEXT",
    "content": "Hey Jordan! Doing great, looking forward to the weekend."
  }
  ```
* **Success Response (`201 Created`):**
  ```json
  {
    "success": true,
    "data": {
      "id": "msg-uuid-2",
      "conversationId": "conv-uuid-1",
      "senderId": "b2f6c91a-8821-4122-901b-5e4d29381029",
      "messageType": "TEXT",
      "content": "Hey Jordan! Doing great, looking forward to the weekend.",
      "mediaUrl": null,
      "readAt": null,
      "createdAt": "2026-09-15T08:42:00.000Z",
      "remainingDailyMessages": 19
    }
  }
  ```

---

### 24.3 Mark Conversation Messages as Read
* **Method & Path:** `PATCH /api/v1/conversations/:conversationId/read`
* **Auth:** Authenticated
* **Success Response (`200 OK`):** Updates `read_at = CURRENT_TIMESTAMP` for unread messages and emits `chat:message:read` Socket.IO event.

---

## 25. Block APIs

### 25.1 Block a User
* **Method & Path:** `POST /api/v1/blocks/:userId`
* **Auth:** Authenticated
* **Business Rules:**
  * Immediately dissolves active matches, closes open conversations, and permanently isolates both profiles from discovery queues.
* **Success Response (`200 OK`):**
  ```json
  {
    "success": true,
    "data": { "blocked": true, "targetUserId": "c3e7d81b..." },
    "message": "User blocked successfully."
  }
  ```

---

### 25.2 List Blocked Users
* **Method & Path:** `GET /api/v1/blocks`
* **Auth:** Authenticated
* **Success Response (`200 OK`):** Returns list of blocked accounts.

---

### 25.3 Unblock a User
* **Method & Path:** `DELETE /api/v1/blocks/:userId`
* **Auth:** Authenticated
* **Success Response (`200 OK`):** Removes block record.

---

## 26. Report APIs

### 26.1 Report User Misconduct
* **Method & Path:** `POST /api/v1/reports`
* **Auth:** Authenticated
* **Request Body:**
  ```json
  {
    "reportedUserId": "c3e7d81b-9932-4233-812c-6f5e39482130",
    "reason": "INAPPROPRIATE_CONTENT",
    "description": "User posted offensive content in chat."
  }
  ```
* **Validation:** `reason` in `['FAKE_PROFILE', 'HARASSMENT', 'SPAM', 'INAPPROPRIATE_CONTENT', 'SCAM', 'OTHER']`.
* **Success Response (`201 Created`):**
  ```json
  {
    "success": true,
    "data": { "reportId": "rep-uuid-1", "status": "PENDING" },
    "message": "Report submitted. Our safety team will review it."
  }
  ```

---

## 27. Notification & "Who Liked You" APIs

### 27.1 List Notifications
* **Method & Path:** `GET /api/v1/notifications`
* **Auth:** Authenticated
* **Query Params:** `limit` (default 20), `cursor`
* **Success Response (`200 OK`):** Returns user notification feed (`NEW_MATCH`, `NEW_MESSAGE`, `NEW_LIKE`).

---

### 27.2 "Who Liked You" (Admirers Feed)
* **Method & Path:** `GET /api/v1/likes/who-liked-me`
* **Auth:** Authenticated
* **Security & Monetization Mandate:**
  * **Free Users:** Receive `{ "count": 5, "admirers": [] }`. **Zero user IDs, names, or photo URLs are returned.**
  * **Premium Users:** Receive full admirer profiles: `{ "count": 5, "admirers": [{ "userId": "...", "firstName": "Jordan", "photos": [...] }] }`.
* **Success Response for Free User (`200 OK`):**
  ```json
  {
    "success": true,
    "data": {
      "count": 5,
      "isUnlocked": false,
      "admirers": []
    },
    "message": "5 people liked your profile! Upgrade to Premium to see who."
  }
  ```
* **Success Response for Premium User (`200 OK`):**
  ```json
  {
    "success": true,
    "data": {
      "count": 5,
      "isUnlocked": true,
      "admirers": [
        {
          "userId": "c3e7d81b-9932-4233-812c-6f5e39482130",
          "firstName": "Jordan",
          "age": 25,
          "city": "Bengaluru",
          "distanceKm": 4,
          "likedAt": "2026-09-15T06:12:00.000Z",
          "primaryPhotoUrl": "https://cdn.lovebite.app/signed/..."
        }
      ]
    }
  }
  ```

---

## 28. Subscription APIs

### 28.1 List Subscription Plans
* **Method & Path:** `GET /api/v1/subscriptions/plans`
* **Auth:** Public / Authenticated
* **Success Response (`200 OK`):**
  ```json
  {
    "success": true,
    "data": [
      {
        "id": "plan-free",
        "code": "FREE",
        "name": "Free Tier",
        "priceInCents": 0,
        "currency": "INR",
        "billingInterval": "NONE"
      },
      {
        "id": "plan-premium-monthly",
        "code": "PREMIUM_MONTHLY",
        "name": "Love Bite Premium (Monthly)",
        "priceInCents": 49900,
        "currency": "INR",
        "billingInterval": "MONTH"
      },
      {
        "id": "plan-premium-yearly",
        "code": "PREMIUM_YEARLY",
        "name": "Love Bite Premium (Yearly)",
        "priceInCents": 399900,
        "currency": "INR",
        "billingInterval": "YEAR"
      }
    ]
  }
  ```

---

### 28.2 Get Current Active Subscription
* **Method & Path:** `GET /api/v1/subscriptions/me`
* **Auth:** Authenticated
* **Success Response (`200 OK`):**
  ```json
  {
    "success": true,
    "data": {
      "hasActiveSubscription": true,
      "plan": {
        "code": "PREMIUM_MONTHLY",
        "name": "Love Bite Premium (Monthly)"
      },
      "status": "ACTIVE",
      "autoRenew": true,
      "currentPeriodStart": "2026-09-01T00:00:00.000Z",
      "currentPeriodEnd": "2026-10-01T00:00:00.000Z",
      "gracePeriodEnd": null
    }
  }
  ```

---

### 28.3 Cancel Subscription Auto-Renewal
* **Method & Path:** `POST /api/v1/subscriptions/cancel`
* **Auth:** Authenticated
* **Business Rules:**
  * Disables auto-renew (`auto_renew = FALSE`, `status = 'CANCELED'`).
  * Premium benefits remain active until `currentPeriodEnd`.
* **Success Response (`200 OK`):**
  ```json
  {
    "success": true,
    "data": { "autoRenew": false, "activeUntil": "2026-10-01T00:00:00.000Z" },
    "message": "Subscription cancelled. Premium access remains active until period end."
  }
  ```

---

## 29. Payment APIs (Razorpay Integration)

### 29.1 Create Checkout Session
* **Method & Path:** `POST /api/v1/payments/checkout`
* **Auth:** Authenticated
* **Request Body:**
  ```json
  {
    "planId": "plan-premium-monthly",
    "paymentType": "SUBSCRIPTION_INITIAL"
  }
  ```
* **Success Response (`200 OK`):**
  ```json
  {
    "success": true,
    "data": {
      "orderId": "order_Hk9281jsa82",
      "subscriptionId": "sub_Nx82910sa8",
      "keyId": "rzp_test_xxxxxx",
      "amount": 49900,
      "currency": "INR",
      "customer": {
        "name": "Alex Morgan",
        "email": "alex.morgan@example.com"
      }
    }
  }
  ```

---

### 29.2 Verify Client Payment Handshake
* **Method & Path:** `POST /api/v1/payments/verify`
* **Auth:** Authenticated
* **Purpose:** Validates cryptographic HMAC signature returned by client Razorpay SDK.
* **Request Body:**
  ```json
  {
    "razorpayPaymentId": "pay_Hk9281a9",
    "razorpayOrderId": "order_Hk9281jsa82",
    "razorpaySignature": "9a8b7c6d5e4f3a2b1c..."
  }
  ```
* **Success Response (`200 OK`):** Returns verification confirmation. *(Note: Authoritative subscription activation occurs via webhook).*

---

## 30. Entitlement & Usage APIs

### 30.1 Get Current User Entitlements
* **Method & Path:** `GET /api/v1/me/entitlements`
* **Auth:** Authenticated
* **Success Response (`200 OK`):**
  ```json
  {
    "success": true,
    "data": {
      "tier": "PREMIUM",
      "features": {
        "unlimitedSwipes": true,
        "seeWhoLikedYou": true,
        "advancedFilters": true,
        "undoAction": true,
        "chatMedia": true,
        "adFree": true,
        "priorityVisibility": true
      },
      "credits": {
        "boostBalance": 2,
        "superLikeBalance": 5
      }
    }
  }
  ```

---

### 30.2 Get Daily Usage Quotas
* **Method & Path:** `GET /api/v1/me/usage`
* **Auth:** Authenticated
* **Success Response (`200 OK`):**
  ```json
  {
    "success": true,
    "data": {
      "dailyLikePass": {
        "used": 4,
        "limit": 10,
        "remaining": 6,
        "isUnlimited": false
      },
      "dailyTextMessages": {
        "used": 8,
        "limit": 20,
        "remaining": 12,
        "isUnlimited": false
      },
      "quotaResetsAt": "2026-09-16T00:00:00.000Z"
    }
  }
  ```

---

## 31. Admin APIs (`role: ADMIN` Required)

### 31.1 User Management
* **List Users:** `GET /api/v1/admin/users?page=1&limit=20&status=ACTIVE&search=alex`
* **Inspect User Details:** `GET /api/v1/admin/users/:userId`
* **Update User Status:** `PATCH /api/v1/admin/users/:userId/status`
  * Body: `{ "status": "SUSPENDED", "reason": "Terms violation" }`

### 31.2 Moderation & Reports
* **List Reports Queue:** `GET /api/v1/admin/reports?status=PENDING&page=1&limit=20`
* **Get Report Details:** `GET /api/v1/admin/reports/:reportId`
* **Resolve Report:** `PATCH /api/v1/admin/reports/:reportId`
  * Body: `{ "status": "RESOLVED", "adminNotes": "User banned for harassment", "actionTaken": "BAN_USER" }`

### 31.3 Dynamic Configuration Management
* **Manage Genders:** `GET`, `POST`, `PATCH /api/v1/admin/config/genders`
* **Manage Interests:** `GET`, `POST`, `PATCH /api/v1/admin/config/interests`
* **Manage Relationship Intentions:** `GET`, `POST`, `PATCH /api/v1/admin/config/relationship-intentions`
* **Manage Plans & Limits:** `GET`, `PATCH /api/v1/admin/config/plans/:planId`

### 31.4 System KPI Dashboard
* **Get System Statistics:** `GET /api/v1/admin/dashboard/stats`
  * Returns total active users, active matches, daily swipe volume, MRR, and open moderation queue counts.

---

## 32. Realtime / Socket.IO Events Specification

* **Handshake Authentication:** Client passes `auth: { token: "<access_token>" }`. Handshake rejects unauthenticated or banned sockets.
* **Room Topologies:**
  * User Private Channel: `user:{userId}` (receives system alerts, match alerts).
  * Match Conversation Channel: `conversation:{conversationId}` (receives live messages).

### 32.1 Server $\rightarrow$ Client Events
| Event Name | Room / Target | Payload Structure | Trigger Condition |
| :--- | :--- | :--- | :--- |
| `match:new` | `user:{userId}` | `{"matchId": "...", "matchedUser": { "id": "...", "firstName": "Jordan", "photos": [...] }, "matchedAt": "..."}` | Reciprocal like establishes active match. |
| `match:unmatch` | `user:{userId}` | `{"matchId": "...", "conversationId": "..."}` | Participant unmatches or block is triggered. |
| `chat:message:new` | `conversation:{id}`| `{"id": "msg-1", "conversationId": "...", "senderId": "...", "messageType": "TEXT", "content": "...", "createdAt": "..."}` | Message persisted in PostgreSQL. |
| `chat:message:read`| `conversation:{id}`| `{"conversationId": "...", "readerId": "...", "readAt": "..."}` | Participant opens active conversation. |
| `notification:new` | `user:{userId}` | `{"id": "notif-1", "type": "NEW_LIKE", "title": "New Like!", "message": "Someone liked you!"}` | System notification dispatched. |

### 32.2 Client $\rightarrow$ Server Events
| Event Name | Payload Structure | Description |
| :--- | :--- | :--- |
| `chat:message:send` | `{"conversationId": "...", "messageType": "TEXT", "content": "..."}` | Client transmits chat message. |
| `chat:message:read` | `{"conversationId": "..."}` | Client marks incoming messages as read. |
| `chat:typing:start` | `{"conversationId": "..."}` | Client begins typing in active match. |
| `chat:typing:stop` | `{"conversationId": "..."}` | Client stops typing. |

---

## 33. Webhooks Contract (Razorpay)

* **Endpoint:** `POST /api/v1/webhooks/razorpay`
* **Auth:** Validates `X-Razorpay-Signature` against `RAZORPAY_WEBHOOK_SECRET`.
* **Idempotency Strategy:** Inserts `event.id` into `processed_webhooks`. Duplicate events terminate immediately with `200 OK`.
* **Handled Event Types:**
  * `subscription.activated` $\rightarrow$ Activates user subscription (`status = 'ACTIVE'`).
  * `subscription.charged` $\rightarrow$ Records payment invoice in `payments`, extends `current_period_end`.
  * `payment.failed` $\rightarrow$ Transitions subscription to `PAST_DUE`, triggers 24-hour grace window.
  * `subscription.cancelled` $\rightarrow$ Sets `auto_renew = FALSE`.
  * `subscription.completed` $\rightarrow$ Transitions to `EXPIRED`, downgrades user entitlements to Free.

---

## 34. Idempotency Specification

1. **Client Mutating APIs:** APIs accepting `Idempotency-Key: <UUIDv4>` header:
   * `POST /api/v1/discovery/:userId/like`
   * `POST /api/v1/discovery/undo`
   * `POST /api/v1/payments/checkout`
2. **Execution Flow:**
   * Server checks Redis for cached response keyed by `idempotency:<userId>:<key>`.
   * If cached response exists, returns previous result without re-executing business mutations.
   * Lock expires after 120 seconds.

---

## 35. Rate Limiting Strategy

Rate limits are enforced using Redis sliding-window algorithms:

| Endpoint Group | Rate Limit Window | Max Requests | Scope |
| :--- | :--- | :--- | :--- |
| **Auth register, login, forgot-password** | 1 minute | 5 requests | IP. Live. `429 RATE_LIMITED`. |
| **Verification resend** | 1 minute | 1 request | Identifier. Live. Registration consumes the same window. |
| **Discovery Swipe Actions**| 1 minute | 60 requests | User ID |
| **Chat Message Sending** | 1 minute | 30 requests | User ID |
| **General Public APIs** | 1 minute | 100 requests | IP Address. Live for `GET /genders`, `GET /interests`, and `GET /relationship-intentions` as `ratelimit:public:<ip>`. |
| **Admin APIs** | 1 minute | 120 requests | Admin User ID |

---

## 36. Security Requirements

1. **Argon2id Password Hashing:** `timeCost: 3, memoryCost: 65536, parallelism: 4`.
2. **HTTP Security Headers:** Configured via `Helmet` (CSP, HSTS, X-Content-Type-Options).
3. **CORS:** Restricted to verified web/mobile origin domains with credentials enabled.
4. **IDOR & Mass Assignment Protection:** Sequelize explicit attribute whitelisting; ownership checks on all user resources.
5. **Private Media Storage:** Photos uploaded directly to S3 via short-lived presigned URLs; served through signed CloudFront URLs.
6. **Zero Coordinate Exposure:** SQL projections strictly exclude `profiles.location` from public serialization.

---

## 37. API-to-Database Mapping

| API Endpoint Group | Primary PostgreSQL Tables Interacted With |
| :--- | :--- |
| **Auth** (`/auth/*`) | `users`, `auth_refresh_tokens` |
| **Public catalogs** (`GET /genders`, `GET /interests`, `GET /relationship-intentions`) | `genders`, `interests`, `relationship_intentions` |
| **Onboarding** (`/onboarding/*`) | `users`, `profiles`, `profile_photos`, `user_interests`, `user_relationship_intentions`, `dating_preferences`, `user_dating_preference_genders`, `user_dating_preference_intentions` |
| **Profiles** (`/profiles/*`) | `profiles`, `users`, `genders`, `profile_photos`, `interests`, `relationship_intentions` |
| **Photos** (`/profile-photos/*`) | `profile_photos` |
| **Interests / Intentions** | `interests`, `user_interests`, `relationship_intentions`, `user_relationship_intentions` |
| **Dating Preferences** | `dating_preferences`, `user_dating_preference_genders`, `user_dating_preference_intentions` |
| **Discovery** (`/discovery`) | `profiles` (PostGIS GiST), `dating_preferences`, `user_dating_preference_genders`, `user_dating_preference_intentions`, `likes`, `matches`, `blocks`, `boost_sessions` |
| **Likes & Passes** | `likes`, `matches`, `conversations`, `notifications`, `usage_records` |
| **Undo** (`/discovery/undo`) | `likes`, `matches`, `conversations`, `subscriptions`, `plan_features` |
| **Matches & Conversations** | `matches`, `conversations` |
| **Messages** (`/messages`) | `messages`, `conversations`, `usage_records` |
| **Safety** (`/blocks`, `/reports`) | `blocks`, `reports` |
| **Notifications** | `notifications` |
| **Subscriptions & Plans** | `plans`, `features`, `plan_features`, `subscriptions`, `usage_limits` |
| **Payments & Webhooks** | `payments`, `processed_webhooks`, `subscriptions` |
| **Entitlements & Usage** | `subscriptions`, `plan_features`, `usage_limits`, `usage_records`, `user_credit_balances`, `credit_transactions` |

---

## 38. Developer Implementation Rules

1. **Thin Controllers:** Controllers must contain zero business validation or database queries; they only invoke services and format HTTP responses.
2. **Service-Layer Transactions:** Multi-entity mutations (e.g., Like $\rightarrow$ Match $\rightarrow$ Conversation) must be wrapped in `sequelize.transaction()`.
3. **Zod Validation on Every Route:** Every incoming HTTP body, query param, and path parameter must be validated via Zod middleware before entering controllers.
4. **Never Query Sequelize Models from Controllers:** All database access is strictly isolated inside `*.data-access.ts` files.
5. **Enforce Entitlements Server-Side:** Never rely on client request headers to determine Free vs. Premium capabilities.
6. **Preserve Privacy Invariants:** Never return raw latitude/longitude coordinates or unmasked liker profiles in API responses.

---

## 39. Open Questions / Conflicts

| Item ID | Topic | Current Stance & Resolution | Status |
| :--- | :--- | :--- | :--- |
| **API-OQ-01** | Multi-Device Push Notifications (FCM / APNS) | REST endpoints dispatch in-app notifications and WebSocket events. Mobile push notification token registration (`/api/v1/notifications/push-token`) will be added in Phase 1.5. | Documented & Deferred |
| **API-OQ-02** | Granular Chat "Delete for Me" vs. "Delete for Everyone" | Phase 1 implements standard soft delete (`messages.deleted_at`), removing message for both participants. Granular per-user deletion flags reserved for Phase 1.5. | Resolved for MVP |
| **API-OQ-03** | Standalone Super Like / Boost A La Carte Purchase Flow | Super Likes and Boosts consume balances from `user_credit_balances`. Purchasing additional credits uses `POST /api/v1/payments/checkout` with `paymentType = 'CREDIT_PURCHASE'`. | Fully Specified |
