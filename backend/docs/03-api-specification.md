# Love Bite - API Specification & Contract

> **Document Path:** `backend/docs/03-api-specification.md`  
> **Target Version:** API v1 (`/api/v1`)  
> **Status:** Authoritative Backend Contract Specification  
> **Architecture Pattern:** Route $\rightarrow$ Controller $\rightarrow$ Service $\rightarrow$ Data Access $\rightarrow$ Sequelize Model $\rightarrow$ PostgreSQL/PostGIS

---

## 1. Overview

This document defines the **RESTful API Specification** and **Socket.IO Realtime Contract** for the **Love Bite** dating platform. It is the integration guide for frontend mobile/web engineers, and the contract for backend engineers and QA.

### Implementation status

Phase 2 authentication, Phase 3 onboarding, Phase 4 Discovery, and Phase 5 slices for PASS, LIKE and match creation, SUPER LIKE, UNDO, and UNMATCH are implemented. Sections **4**, **11**, **12**, **14**, **19**, **20**, **21**, and **22.2** describe that live behavior. Sections **13**, **17**, **18**, **22.1**, and **23** onward are the planned contract and are not mounted, except where a subsection says otherwise. `PUT /api/v1/me/interests`, `PUT /api/v1/me/relationship-intentions`, `GET /api/v1/dating-preferences`, `PUT /api/v1/dating-preferences`, `PUT /api/v1/location`, and `PATCH /api/v1/onboarding/profile` are not implemented. `GET /api/v1/matches` is not implemented. `DELETE /api/v1/matches/:matchId` is implemented. Match and conversation rows are created by LIKE and SUPER LIKE. UNMATCH does not delete them.

Health checks are also live: `GET /health` and `GET /api/v1/health`.

### Core Architectural Principles:
* **Strict REST Semantics:** Standard HTTP verbs (`GET`, `POST`, `PATCH`, `PUT`, `DELETE`) with resource-oriented URIs.
* **Dual-Token Authentication:** Ephemeral JWT Access Tokens (15-minute validity) paired with Rotating Refresh Tokens delivered via secure `HTTP-Only`, `SameSite=Strict`, `Secure` cookies.
* **Centralized Entitlements & Server-Side Enforcement:** Feature gating (Free vs. Premium tiers) and rate/usage quota limits (10 combined Swipes/day, 20 text messages/day for Free users) are strictly verified server-side. Frontend clients are never trusted with entitlement decisions.
* **Privacy & Security by Design:** 
  * Exact spatial coordinates (`latitude`, `longitude`) are **NEVER** returned in any client payload. Live Discovery returns the registered `city` and numeric `distanceKm`, rounded to one decimal place.
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

Live routes that require `Authorization: Bearer <accessToken>`:

* `POST /api/v1/auth/logout`. An unverified account may log in and log out.
* `GET`, `POST`, and `PATCH /api/v1/profile`.
* `PUT /api/v1/onboarding/interests`, `PUT /api/v1/onboarding/relationship-intentions`, `PUT /api/v1/onboarding/dating-preferences`, and `PUT /api/v1/onboarding/location`.
* `GET /api/v1/onboarding/status` and `POST /api/v1/onboarding/complete`.
* `POST /api/v1/profile-photos/upload-url`, `POST /api/v1/profile-photos/confirm`, `GET /api/v1/profile-photos`, `PATCH /api/v1/profile-photos/:photoId`, and `DELETE /api/v1/profile-photos/:photoId`.
* `GET /api/v1/discovery`, `POST /api/v1/discovery/:userId/pass`, `POST /api/v1/discovery/:userId/like`, `POST /api/v1/discovery/:userId/super-like`, and `POST /api/v1/discovery/undo`.
* `DELETE /api/v1/matches/:matchId`.

Those profile, onboarding, photo, discovery, and unmatch routes also require role `USER`. `requireVerified` is not applied on the route. An unverified `USER` may call profile, onboarding, and photo routes. Discovery, PASS, LIKE, SUPER LIKE, UNDO, and UNMATCH check verification in the service and return `403 EMAIL_NOT_VERIFIED` or `403 PHONE_NOT_VERIFIED`. Any other role, including `ADMIN`, receives `403 FORBIDDEN`. Suspended and banned accounts are rejected with `403` by the authentication middleware.

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
  * `Idempotency-Key: <UUIDv4>` (optional on `POST /api/v1/discovery/:userId/like` and `POST /api/v1/discovery/:userId/super-like`. PASS, UNDO, and UNMATCH do not read this header. Checkout idempotency remains planned.)
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
    "code": "DAILY_LIMIT_REACHED",
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
| `PROFILE_INCOMPLETE` | 400 | Onboarding is incomplete. Completion lists every missing step in `details` and writes nothing. Discovery, PASS, LIKE, SUPER LIKE, UNDO, and UNMATCH return the same code with empty `details` when the caller has no completed profile, no location, or no dating preferences. |
| `INVALID_INTEREST` | 400 | One or more interest ids are unknown or inactive. |
| `INVALID_RELATIONSHIP_INTENTION` | 400 | One or more relationship intention ids are unknown or inactive. |
| `INVALID_STORAGE_KEY` | 400 | The confirm storage key does not match the upload reservation. |
| `PHOTO_LIMIT_REACHED` | 409 | The caller already has 5 active photos. |
| `PHOTO_CONFLICT` | 409 | Photo order or primary photo conflicts with an existing photo. |
| `PHOTO_REQUIRED` | 409 | A completed profile cannot delete its only active photo. |
| `PREMIUM_REQUIRED` | 403 | Feature requires an active Premium subscription. |
| `FORBIDDEN` | 403 | Insufficient role permissions or resource access denied. |
| `RESOURCE_NOT_FOUND` | 404 | Target entity does not exist or is soft-deleted. |
| `USER_NOT_FOUND` | 404 | Target user profile not found. |
| `PROFILE_NOT_FOUND` | 404 | The authenticated user has no profile row. |
| `PROFILE_ALREADY_EXISTS` | 409 | The authenticated user already has a profile. |
| `INVALID_GENDER` | 400 | `genderId` is missing, unknown, or not an active gender. |
| `MATCH_NOT_FOUND` | 404 | Active match record does not exist. UNMATCH uses this for a missing id, a match the caller does not belong to, a non-`ACTIVE` row, an already `UNMATCHED` row, an `UNDONE` row, and a concurrent request that already changed the row. Message: `Active match record does not exist.` |
| `CONVERSATION_CLOSED` | 404 | Conversation is closed due to unmatch or safety block. |
| `DUPLICATE_IDENTIFIER` | 409 | Email or phone is already registered to an active account. |
| `SELF_INTERACTION` | 400 | The caller targeted their own user id. |
| `INVALID_TARGET` | 404 | The target exists but is not an active, complete profile with a primary photo. |
| `ALREADY_SWIPED` | 409 | Target user has already been liked or permanently passed. |
| `ACTIVE_MATCH_EXISTS` | 409 | Users are already in an active mutual match. |
| `BLOCKED_USER` | 409 | Interaction prohibited due to an active safety block. |
| `NO_UNDOABLE_ACTION` | 400 | There is no active outgoing LIKE or PASS to undo. |
| `UNDO_WINDOW_EXPIRED` | 400 | The latest active outgoing LIKE or PASS is older than five minutes. |
| `INSUFFICIENT_SUPER_LIKE_CREDITS` | 409 | The caller has no remaining `SUPER_LIKE` credits. |
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
Planned for chat, notifications, and match lists. Live `GET /api/v1/discovery` returns one card and does not paginate.
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

`dateOfBirth` is validated and then discarded. Registration does **not** store it on the user, and it does **not** create a profile. Do not read the date of birth back from the user after registration. `POST /api/v1/profile` stores it on the profile.

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
| 403 | `EMAIL_NOT_VERIFIED` or `PHONE_NOT_VERIFIED` | Not returned by the Phase 2 auth routes. Discovery, PASS, LIKE, SUPER LIKE, UNDO, and UNMATCH return these when the caller is unverified. |
| 404 | `USER_NOT_FOUND` | Resend only. The identifier has no account. |
| 409 | `DUPLICATE_IDENTIFIER` | Registration. Offer login. |
| 422 | `UNDERAGE_NOT_PERMITTED` | Registration. Block submit. |
| 429 | `RATE_LIMITED` | Show the message and wait. There is no `Retry-After` header. |
| 500 | `INTERNAL_SERVER_ERROR` | Generic failure. Message: `An unexpected error occurred. Please try again later.` |

### 11.12 What is live

Live now: registration, email and phone verification, resend, login, refresh, logout, forgot-password, reset-password, the public catalog reads in section 11.13, the authenticated basic profile API in section 11.14, onboarding interests and relationship intentions in section 11.15, profile photos in section 14, dating preferences in section 12.5, location in section 12.6, onboarding status in section 12.1, onboarding completion in section 12.7, `GET /api/v1/discovery` in section 19, PASS, LIKE, SUPER LIKE, and UNDO in sections 20 and 21, and UNMATCH in section 22.2.

Phase 3 onboarding is complete. Phase 4 — Discovery is complete. Phase 5 slices for PASS, LIKE and match creation, SUPER LIKE, UNDO, and UNMATCH are complete. `GET /api/v1/matches` is not implemented. Rematch is not implemented. Gender and relationship-intention seed data exist. Production interests are not seeded, because the approved interest list is not defined.

Not implemented: `PUT /api/v1/me/interests`, `PUT /api/v1/me/relationship-intentions`, `GET /api/v1/dating-preferences`, `PUT /api/v1/dating-preferences`, `PUT /api/v1/location`, `PATCH /api/v1/onboarding/profile`, the richer profile views in section 13, `GET /api/v1/matches`, who-liked-me, chat, notifications, subscriptions as a public API, payments, and boosts. Do not call those paths. `DELETE /api/v1/matches/:matchId` is live.

Later sections remain the planned contract unless a subsection says it is implemented.

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

`isProfileComplete` is the stored `profiles.is_profile_complete` flag and is never taken from the request. Creating or updating a basic profile does not set it to `true`. It stays `false` until `POST /api/v1/onboarding/complete` sets it. That completion route is separate from `users.status`. Editing a basic field does not clear a flag that was already `true`.

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

### 11.15 Onboarding interests and relationship intentions

Implemented. These two routes replace the authenticated user's own catalog selections. They do not use `requireVerified`. They are not part of the public catalog rate limit. There is no rate limiter on these routes.

* **Auth:** `Authorization: Bearer <accessToken>` and role `USER`.
* **Ownership:** `req.user.id` only. The body must not include `userId`. Any unexpected field is `400 VALIDATION_ERROR`.
* **Missing or malformed token:** `401 AUTH_REQUIRED`.
* **Invalid or expired token:** `401 INVALID_TOKEN`.
* **Suspended or banned account:** `403 ACCOUNT_SUSPENDED` or `403 ACCOUNT_BANNED`.
* **Any other role, including `ADMIN`:** `403 FORBIDDEN`.
* **Replace semantics:** the user's existing junction rows are deleted and the submitted ids are inserted in one Sequelize transaction. The stored set becomes exactly the request. A later call does not append. Another user's rows are not changed.
* **Catalog check:** every id must already exist and have `is_active = true`. Unknown and inactive ids are rejected. They are not skipped.
* **Profile completion:** these routes do not read or write `profiles.is_profile_complete`. They do not accept photos, location, or dating preferences.
* **Not mounted:** `PUT /api/v1/me/interests` and `PUT /api/v1/me/relationship-intentions`.

Successful `data` is the selected catalog records, ordered by `display_order` ascending, then `code` ascending. Database-only fields such as `isActive`, `displayOrder`, `description`, and timestamps are omitted.

#### Replace interests

* **Method & Path:** `PUT /api/v1/onboarding/interests`
* **Request body:**

```json
{
  "interestIds": [
    "1a2b3c4d-0001-4000-8000-000000000001",
    "1a2b3c4d-0002-4000-8000-000000000002",
    "1a2b3c4d-0003-4000-8000-000000000003"
  ]
}
```

* **Validation:** `interestIds` is required and must be an array of 3 to 10 UUID strings. Duplicates are rejected, including different letter case. `400 VALIDATION_ERROR` covers a bad shape, a bad UUID, a duplicate, and a count outside 3–10. An unknown or inactive interest is `400 INVALID_INTEREST`. No rows are changed when validation fails. A database failure rolls the replacement back.
* **Success Response (`200 OK`):** Message: `Interests updated successfully`. Each item is `{ "id", "code", "name", "category" }`. `category` may be `null`.

#### Replace relationship intentions

* **Method & Path:** `PUT /api/v1/onboarding/relationship-intentions`
* **Request body:**

```json
{
  "relationshipIntentionIds": [
    "2a3b4c5d-0001-4000-8000-000000000001"
  ]
}
```

* **Validation:** `relationshipIntentionIds` is required and must be an array of at least 1 UUID string. There is no maximum. Duplicates are rejected, including different letter case. `400 VALIDATION_ERROR` covers a bad shape, a bad UUID, a duplicate, and an empty array. An unknown or inactive intention is `400 INVALID_RELATIONSHIP_INTENTION`. No rows are changed when validation fails. A database failure rolls the replacement back.
* **Success Response (`200 OK`):** Message: `Relationship intentions updated successfully`. Each item is `{ "id", "code", "name" }`.

---

## 12. Onboarding APIs

**Implemented** for the signed-in `USER`, except `PATCH /api/v1/onboarding/profile`, which is not mounted. The live basic profile API is section 11.14. Public catalog reads are section 11.13.

Live routes:

* `GET /api/v1/onboarding/status` — section 12.1
* `PUT /api/v1/onboarding/interests` — sections 11.15 and 12.3
* `PUT /api/v1/onboarding/relationship-intentions` — sections 11.15 and 12.4
* `PUT /api/v1/onboarding/dating-preferences` — section 12.5
* `PUT /api/v1/onboarding/location` — section 12.6
* `POST /api/v1/onboarding/complete` — section 12.7

`PUT /api/v1/location`, `PATCH /api/v1/onboarding/profile`, `PUT /api/v1/me/interests`, `PUT /api/v1/me/relationship-intentions`, `GET /api/v1/dating-preferences`, and `PUT /api/v1/dating-preferences` are not mounted.

These routes use `authenticate` and `requireRole('USER')`. `requireVerified` is not applied. `ADMIN` receives `403 FORBIDDEN`. The PUT and POST routes do not have to be called in order. Only completion requires every prerequisite.

### Account status and profile completion

These are different values.

* **Account status** is `users.status`. Verification is what moves an account to `ACTIVE`. Onboarding completion returns the caller's current account status and does not change it.
* **Profile completion** is the stored `profiles.is_profile_complete` flag. `GET /api/v1/onboarding/status` returns that stored flag. The status evaluator does not calculate it. `POST /api/v1/onboarding/complete` is the operation that sets the flag to `true`.

Saving a basic profile, photos, interests, relationship intentions, dating preferences, or location does not set `profiles.is_profile_complete` and does not update `users.status`. None of these routes issue a new JWT.

The status order is `VERIFICATION`, `BASIC_PROFILE`, `PHOTOS`, `INTERESTS`, `RELATIONSHIP_INTENTIONS`, `DATING_PREFERENCES`, `LOCATION`, then `COMPLETE`.

### 12.1 Get Onboarding Status
* **Status:** Implemented. This route is read-only. It does not write `profiles.is_profile_complete`. `POST /api/v1/onboarding/complete` is the route that sets the flag. Its contract is section 12.7.
* **Method & Path:** `GET /api/v1/onboarding/status`
* **Auth:** `Authorization: Bearer <accessToken>` and role `USER`. `requireVerified` is not applied. No body and no query parameters.
* **Missing profile:** `200 OK`. This is not `404 PROFILE_NOT_FOUND`.
* **Success Response (`200 OK`):** Message: `Onboarding status retrieved successfully`. `data` is only:
  ```json
  {
    "isVerified": true,
    "isProfileComplete": false,
    "completedSteps": ["VERIFICATION"],
    "nextStep": "BASIC_PROFILE"
  }
  ```
* **`isVerified`:** The authenticated user's current verification state (`req.user.isVerified`). A verified email or a verified phone is enough. This is not `users.status`.
* **`isProfileComplete`:** The stored `profiles.is_profile_complete` value, loaded for the authenticated user. A missing profile is `false`. This route does not recalculate or store it. See the account-status distinction at the start of section 12.
* **`completedSteps`:** Prerequisite steps that are currently satisfied, in this order: `VERIFICATION`, `BASIC_PROFILE`, `PHOTOS`, `INTERESTS`, `RELATIONSHIP_INTENTIONS`, `DATING_PREFERENCES`, `LOCATION`. `COMPLETE` is never included.
* **`nextStep`:** The first incomplete step in that order. When steps 1–7 are satisfied and the stored flag is still `false`, `nextStep` is `COMPLETE`. When the stored flag is `true`, `nextStep` is `null`.
* **Step rules:** `VERIFICATION` uses the authenticated verification state. `BASIC_PROFILE` is a profile row. `PHOTOS` is 1–5 active photos including one primary. `INTERESTS` is 3–10 of the user's own interests. `RELATIONSHIP_INTENTIONS` is at least one of the user's own relationship intentions, not discovery-preference intentions. `DATING_PREFERENCES` is a `dating_preferences` row, including a row with empty junction lists. `LOCATION` is a non-blank city and a non-null point. Coordinates, photos, interests, and preference records are not returned.

---

### 12.2 Save Basic Profile Info
* **Status:** The mounted routes are `GET`, `POST`, and `PATCH /api/v1/profile`. See section 11.14. `PATCH /api/v1/onboarding/profile` is not mounted.
* **Auth:** Authenticated `USER`. `requireVerified` is not applied. `ADMIN` is `403 FORBIDDEN`.
* **Completion:** Creating or updating the basic profile does not set `profiles.is_profile_complete` and does not change `users.status`. The client cannot send `isProfileComplete`.

---

### 12.3 Set Onboarding Interests
* **Status:** Implemented. See section 11.15. `PUT /api/v1/me/interests` is not implemented.
* **Method & Path:** `PUT /api/v1/onboarding/interests`
* **Auth:** Authenticated `USER`. `requireVerified` is not applied.
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
* **Validation:** Array of active interest UUIDs, **min 3, max 10 items**. Duplicates, unknown ids, and inactive ids are rejected. The call replaces `user_interests` for the authenticated user.
* **Success Response (`200 OK`):** Returns the selected interest list. See section 11.15.

---

### 12.4 Set Onboarding Relationship Intentions
* **Status:** Implemented. See section 11.15. `PUT /api/v1/me/relationship-intentions` is not implemented.
* **Method & Path:** `PUT /api/v1/onboarding/relationship-intentions`
* **Auth:** Authenticated `USER`. `requireVerified` is not applied.
* **Request Body:**
  ```json
  {
    "relationshipIntentionIds": [
      "2a3b4c5d-0001-4000-8000-000000000001"
    ]
  }
  ```
* **Validation:** Array of active intention UUIDs, **min 1 item**, no maximum. Duplicates, unknown ids, and inactive ids are rejected. The call replaces `user_relationship_intentions` for the authenticated user.
* **Success Response (`200 OK`):** Returns the selected intention list. See section 11.15.

---

### 12.5 Set Onboarding Dating Preferences
* **Status:** Implemented. This route replaces the caller's discovery preferences. It does not use `requireVerified`. `GET /api/v1/dating-preferences` and `PUT /api/v1/dating-preferences` in section 17 are not implemented.
* **Method & Path:** `PUT /api/v1/onboarding/dating-preferences`
* **Auth:** `Authorization: Bearer <accessToken>` and role `USER`.
* **Ownership:** `req.user.id` only. The body must not include `userId`. Any unexpected field is `400 VALIDATION_ERROR`.
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
* **Validation:** `minAge` and `maxAge` are integers. `minAge >= 18`, `maxAge <= 100`, and `maxAge >= minAge`. `maxDistanceKm` is an integer from 1 to 500. `interestedInGenderIds` and `preferredIntentionIds` are arrays of UUIDs. There is no minimum or maximum count. An empty array is valid. Duplicates are rejected, including different letter case. `400 VALIDATION_ERROR` covers a bad shape, a bad UUID, a duplicate, and a number outside the rules. An unknown or inactive gender is `400 INVALID_GENDER`. An unknown or inactive intention is `400 INVALID_RELATIONSHIP_INTENTION`. No rows are changed when validation fails.
* **Replace semantics:** One Sequelize transaction creates the caller's `dating_preferences` row, or updates it when it already exists, then replaces `user_dating_preference_genders` and `user_dating_preference_intentions` with the submitted ids. A later call does not append. Another user's rows are not changed. This route does not write `user_relationship_intentions`, `user_interests`, photos, city, location, or `profiles.is_profile_complete`.
* **Success Response (`200 OK`):** Message: `Dating preferences updated successfully`. `data` is the stored preference, not a raw junction row:
  ```json
  {
    "minAge": 22,
    "maxAge": 32,
    "maxDistanceKm": 40,
    "interestedInGenders": [
      { "id": "gender-uuid", "code": "WOMAN", "name": "Woman" }
    ],
    "preferredIntentions": [
      { "id": "intention-uuid", "code": "LONG_TERM_RELATIONSHIP", "name": "Long-term relationship" }
    ]
  }
  ```
  Catalog objects are ordered by `display_order` ascending, then `code` ascending. An empty submitted list is returned as `[]`. `userId`, timestamps, and junction row ids are omitted.

---

### 12.6 Set Onboarding Location
* **Status:** Implemented. `PUT /api/v1/location` is not mounted. This route does not use `requireVerified`. It does not set `profiles.is_profile_complete` and does not change `users.status`.
* **Method & Path:** `PUT /api/v1/onboarding/location`
* **Auth:** `Authorization: Bearer <accessToken>` and role `USER`.
* **Ownership:** `req.user.id` only. A profile row must already exist. No profile is `404 PROFILE_NOT_FOUND`, and no profile row is created. Any unexpected field is `400 VALIDATION_ERROR`.
* **Request Body:**
  ```json
  {
    "city": "Bengaluru",
    "latitude": 12.9716,
    "longitude": 77.5946
  }
  ```
* **Validation:** `city` is a string, trimmed, non-empty, and at most 100 characters. `latitude` is a finite number from -90 to 90. `longitude` is a finite number from -180 to 180. A later call replaces the stored city and point.
* **Storage:** The profile row is updated to the trimmed city and a PostGIS `geography` Point, SRID 4326: `ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography`.
* **Success Response (`200 OK`):** Message: `Location updated successfully`. `data` is only `{ "city": "Bengaluru", "updated": true }`. Latitude, longitude, and `location` are not returned. `GET /api/v1/profile` then returns the city and still omits coordinates.

---

### 12.7 Finalize Onboarding & Complete Profile
* **Status:** Implemented. `authenticate` and `requireRole('USER')` are applied. `requireVerified` is not applied. There is no request body and no query parameters. Ownership is `req.user.id`.
* **Method & Path:** `POST /api/v1/onboarding/complete`
* **Prerequisites:** The route uses the same seven steps as section 12.1. All of them must be satisfied: `VERIFICATION` (`req.user.isVerified`; a verified email or a verified phone is enough), `BASIC_PROFILE` (a profile row), `PHOTOS` (1–5 active photos, including one primary; soft-deleted photos and upload reservations do not count), `INTERESTS` (3–10 of the caller's own `user_interests`), `RELATIONSHIP_INTENTIONS` (at least one of the caller's own `user_relationship_intentions`, not `user_dating_preference_intentions`), `DATING_PREFERENCES` (a `dating_preferences` row, including a row with empty junction lists), and `LOCATION` (a non-blank city and a non-null point).
* **Incomplete (`400 PROFILE_INCOMPLETE`):** `details` lists every missing prerequisite step, in the section 12.1 order. Each item is `{ "field": "<STEP>", "message": "<STEP> is required" }`. Nothing is written. `profiles.is_profile_complete` stays unchanged.
* **Success Response (`200 OK`):** Message: `Onboarding complete! Welcome to Love Bite.`. `data` is only `isProfileComplete` (`true`) and `status` (the caller's current `users.status`). `status` is account status. `isProfileComplete` is the stored profile flag. Coordinates, profile fields, photos, and onboarding steps are not returned.
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
* **Write:** The only change is `profiles.is_profile_complete` set to `true` for the caller. `users.status` and every other profile column stay as they are. The route does not issue a new access token or refresh cookie. A client that needs the JWT `isProfileComplete` claim to match the stored flag must log in again or call refresh. Later authenticated calls already load the stored flag.
* **Idempotent:** A caller whose stored flag is already `true` receives the same `200` success body. The route does not write again and does not return `409`.

---

## 13. Profile APIs

**Not implemented.** The routes in this section are the planned fuller profile contract, including a combined private profile and public profiles. They are not mounted. The live basic profile API is `GET`, `POST`, and `PATCH /api/v1/profile` in section 11.14. Live photo routes are section 14. Live interest and intention selection is section 11.15.

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

**Status:** Implemented for the signed-in `USER`. All five routes use `authenticate` and `requireRole('USER')`. Ownership is `req.user.id`. A profile row is not required. These routes do not change `profiles.is_profile_complete`. Objects stay private. The API never accepts image bytes. There is no S3 delete in this slice.

Photo objects returned after confirm, list, and patch are `{ "id", "url", "displayOrder", "isPrimary" }`. `url` is a presigned `GetObject` URL valid for 3600 seconds. `storageKey` is returned only by the upload-url route.

### 14.1 Request Presigned S3 Upload Slot
* **Method & Path:** `POST /api/v1/profile-photos/upload-url`
* **Auth:** Authenticated `USER`
* **Purpose:** Generates a short-lived S3 `PutObject` presigned URL. The server stores a Redis reservation for 300 seconds and does not insert `profile_photos`.
* **Request Body:**
  ```json
  {
    "mimeType": "image/webp",
    "fileSizeBytes": 2048576,
    "originalFilename": "profile_pic.webp"
  }
  ```
* **Validation:** `mimeType` in `['image/jpeg', 'image/png', 'image/webp']`. `fileSizeBytes` is an integer from 1 to 10485760. `originalFilename` is optional, trimmed, and at most 255 characters. It is metadata only and is never part of the object key. Unknown fields are rejected.
* **Limit:** At most 5 active photos (`deleted_at IS NULL`). A sixth request is `409 PHOTO_LIMIT_REACHED`.
* **Object key:** Server-generated `photos/{userId}/{photoId}.webp`. The signed PUT `ContentType` is the validated MIME type. No public ACL. `expiresInSeconds` is 300.
* **Success Response (`200 OK`):** Message is `Upload URL created successfully`.
  ```json
  {
    "success": true,
    "data": {
      "photoId": "photo-uuid-1",
      "uploadUrl": "https://lovebite-private-photos.s3.amazonaws.com/photos/user-id/photo-uuid-1.webp?X-Amz-...",
      "storageKey": "photos/user-id/photo-uuid-1.webp",
      "expiresInSeconds": 300
    },
    "message": "Upload URL created successfully"
  }
  ```

---

### 14.2 Confirm Uploaded Photo Metadata
* **Method & Path:** `POST /api/v1/profile-photos/confirm`
* **Auth:** Authenticated `USER`
* **Request Body:**
  ```json
  {
    "photoId": "photo-uuid-1",
    "storageKey": "photos/user-id/photo-uuid-1.webp",
    "displayOrder": 1,
    "isPrimary": true
  }
  ```
* **Rules:** `displayOrder` is 1–5. `isPrimary` is boolean. The client `storageKey` must exactly match the Redis reservation for that `photoId` and the authenticated user. MIME type, file size, filename, and the stored key come from the reservation. A missing or expired reservation, or another user's reservation, is `404 RESOURCE_NOT_FOUND`. A mismatched key is `400 INVALID_STORAGE_KEY`. The row is inserted only after those checks, inside a transaction. The reservation is deleted only after commit. A failed transaction leaves the reservation in place.
* **Order collision:** If another active photo already uses `displayOrder`, that photo moves to the lowest unused order from 1 to 5. The new photo keeps the requested order.
* **Primary:** The first confirmed photo becomes primary even when `isPrimary` is `false`. When other active photos already exist, `isPrimary: true` clears the current primary and inserts this photo as primary. `isPrimary: false` leaves the existing primary in place. Active photos keep exactly one primary.
* **Limit:** The transaction rejects a sixth active photo with `409 PHOTO_LIMIT_REACHED`.
* **Success Response (`201 Created`):** Message is `Photo confirmed successfully`. `data` is `{ "id", "url", "displayOrder", "isPrimary" }`.

---

### 14.3 List Current User Photos
* **Method & Path:** `GET /api/v1/profile-photos`
* **Auth:** Authenticated `USER`
* **Success Response (`200 OK`):** Message is `Photos retrieved successfully`. `data` is the caller's active photos, `displayOrder` ascending. Deleted photos and other users' photos are omitted. Each item includes a fresh signed GET URL.

---

### 14.4 Update Photo Order or Primary Flag
* **Method & Path:** `PATCH /api/v1/profile-photos/:photoId`
* **Auth:** Authenticated `USER`
* **Request Body:** At least one of `displayOrder` (1–5) or `isPrimary` (boolean). Unknown fields are rejected. An empty body is `400 VALIDATION_ERROR`.
* **Ownership:** The photo must be an active row for `req.user.id`. Any other id is `404 RESOURCE_NOT_FOUND`.
* **Order collision:** The two photos exchange display orders inside one transaction. No order outside 1–5 is written.
* **Primary:** `isPrimary: true` clears the current primary and promotes this photo. `isPrimary: false` on the current primary promotes the other active photo with the lowest `displayOrder`. The only active photo stays primary.
* **Success Response (`200 OK`):** Message is `Photos updated successfully`. `data` is the full active photo list with fresh signed GET URLs.

---

### 14.5 Delete Photo
* **Method & Path:** `DELETE /api/v1/profile-photos/:photoId`
* **Auth:** Authenticated `USER`
* **Business Rules:**
  * Ownership matches patch. A missing or other-user photo is `404 RESOURCE_NOT_FOUND`.
  * The row is soft-deleted. The S3 object is not deleted.
  * If `profiles.is_profile_complete` is true and this is the only active photo, the delete is `409 PHOTO_REQUIRED`.
  * If the deleted photo is primary and other active photos remain, the one with the lowest `displayOrder` becomes primary.
  * `profiles.is_profile_complete` is not changed.
* **Success Response (`200 OK`):** Message is `Photo deleted successfully`. `data` is `{ "deleted": true }`.

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
* **Status:** Not implemented. The mounted route is `PUT /api/v1/onboarding/interests`. See section 11.15.
* **Method & Path:** `PUT /api/v1/me/interests`
* **Auth:** Authenticated
* **Request Body:** `{ "interestIds": ["uuid-1", "uuid-2", "uuid-3"] }` (min 3, max 10).
* **Success Response (`200 OK`):** Returns updated user interest list. This path is not mounted.

---

## 16. Relationship Intention APIs

### 16.1 List Active Relationship Intentions
* **Status:** Implemented. See section 11.13. Public, active rows only, `display_order` ascending.
* **Method & Path:** `GET /api/v1/relationship-intentions`
* **Auth:** Public
* **Success Response (`200 OK`):** Returns active intentions (`LONG_TERM_RELATIONSHIP`, `SOMETHING_CASUAL`, `FRIENDSHIP`, `NOT_SURE_YET`) as `{ "id", "code", "name" }`. Message: `Relationship intentions retrieved successfully`.

---

### 16.2 Update Current User Intentions
* **Status:** Not implemented. The mounted route is `PUT /api/v1/onboarding/relationship-intentions`. See section 11.15.
* **Method & Path:** `PUT /api/v1/me/relationship-intentions`
* **Auth:** Authenticated
* **Request Body:** `{ "relationshipIntentionIds": ["uuid-1", "uuid-2"] }` ($\ge 1$).
* **Success Response (`200 OK`):** Returns updated intentions list. This path is not mounted.

---

## 17. Dating Preference APIs

**Not implemented.** The mounted route is `PUT /api/v1/onboarding/dating-preferences`. See section 12.5. The routes in this section are a later preferences API and are not mounted.

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

**Not implemented.** `PUT /api/v1/location` is not mounted. The live location route is `PUT /api/v1/onboarding/location`. See section 12.6. That response does not include coordinates.

### 18.1 Update User Location
* **Status:** Not implemented. Do not call this path.
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

**Implemented.** Phase 4 is complete. `GET /api/v1/discovery` has no query string and no body. It does not accept cursor or offset pagination, and it does not record a seen-state. A repeat call can return the same candidate until eligibility or ranking changes. PASS, LIKE, SUPER LIKE, and UNDO are also mounted under `/api/v1/discovery`. See sections 20 and 21. `POST /api/v1/discovery/undo` is registered before `/:userId` so the word `undo` is not treated as a user id.

### 19.1 Get Next Discovery Candidate Card
* **Method & Path:** `GET /api/v1/discovery`
* **Auth:** Authenticated `USER`. The route uses `authenticate` and `requireRole('USER')`. `requireVerified` is not attached. The Discovery service checks the current authenticated verification state.
* **Caller results:**
  * Missing token: `401 AUTH_REQUIRED`.
  * Invalid token, or a deleted account: `401 INVALID_TOKEN`.
  * Any role other than `USER`, including `ADMIN`: `403 FORBIDDEN`.
  * Suspended: `403 ACCOUNT_SUSPENDED`. Banned: `403 ACCOUNT_BANNED`.
  * Unverified email account: `403 EMAIL_NOT_VERIFIED`. Unverified phone account: `403 PHONE_NOT_VERIFIED`.
  * Missing profile, a profile that is not marked complete, missing dating preferences, or a missing location: `400 PROFILE_INCOMPLETE`. An incomplete caller does not receive an empty stack.
* **Candidate eligibility:** The candidate is a different user with `users.status = 'ACTIVE'`, `users.deleted_at IS NULL`, `profiles.is_profile_complete = true`, a non-null location, and an active primary photo. The query excludes the candidate when the viewer has an active `LIKE`, `PASS`, or `SUPER_LIKE` (`likes.is_undone = false`), when the pair has a match with `status = 'ACTIVE'`, or when either user has blocked the other. An undone viewer action does not exclude the candidate. A candidate's incoming `PASS` does not exclude the candidate. `UNMATCHED` and `UNDONE` matches do not exclude the candidate. Reports are not part of this query.
* **Mutual filters:** PostGIS `ST_DWithin` requires the distance to fall within both users' `max_distance_km`. The boundary is inclusive. Age uses completed years, `EXTRACT(YEAR FROM AGE(date_of_birth))`, and both ages must fall inside the other user's `min_age` to `max_age`, inclusive. Each user's gender must appear in the other user's preferred genders. Each user's own relationship intentions must overlap the other user's preferred intentions. An empty preferred-gender list or an empty preferred-intention list produces no candidate. An empty list is not treated as "no preference".
* **Ranking:** One row. Highest currently active boost multiplier first, then `profiles.created_at DESC`. An active boost has `is_active = true` and `expires_at > CURRENT_TIMESTAMP`. Several active boosts use the highest multiplier. No active boost uses `1.0`.
* **Quota:** Browsing is unlimited. This route does not consume the combined LIKE and PASS quota and does not consume Super Like credits.
* **Success Response (`200 OK`):** Message: `Discovery candidate retrieved successfully`.
  ```json
  {
    "success": true,
    "data": {
      "candidate": {
        "id": "c3e7d81b-9932-4233-812c-6f5e39482130",
        "firstName": "Jordan",
        "age": 25,
        "gender": { "id": "gen-1", "code": "WOMAN", "name": "Woman" },
        "bio": "Designer & coffee enthusiast.",
        "occupation": "Product Designer",
        "education": "NID",
        "city": "Bengaluru",
        "distanceKm": 4.2,
        "photos": [
          { "id": "p-1", "url": "https://signed.example/photo-1", "displayOrder": 1, "isPrimary": true },
          { "id": "p-2", "url": "https://signed.example/photo-2", "displayOrder": 2, "isPrimary": false }
        ],
        "interests": [
          { "id": "int-1", "code": "DESIGN", "name": "Design", "category": "Creative" }
        ],
        "relationshipIntentions": [
          { "id": "rel-1", "code": "LONG_TERM_RELATIONSHIP", "name": "Long-term relationship" }
        ]
      }
    },
    "message": "Discovery candidate retrieved successfully"
  }
  ```
  `id` is the candidate user id. `age` is a number of completed years. `bio`, `occupation`, `education`, and `city` may be null. `distanceKm` is a number rounded to one decimal place, including values below 1, such as `0.7`. Photos are the candidate's active photos, ordered by `displayOrder`, with private signed download URLs valid for 3600 seconds. Interests are the candidate's own interests (`id`, `code`, `name`, `category`). `category` may be null. Relationship intentions are the candidate's own intentions (`id`, `code`, `name`). The response does not include `storageKey`, latitude, longitude, `location`, email, phone, password, or tokens.
* **Empty stack (`200 OK`):** The same message. `data` is `{ "candidate": null }`.

---

## 20. Like / Pass / Super Like APIs

**Implemented.** These routes are mounted on the discovery router. They share the caller checks below. None of them creates a notification or emits a Socket.IO event. There is no separate passes table. `LIKE`, `PASS`, and `SUPER_LIKE` are rows in `likes`.

### Shared caller and target rules

* **Auth:** `Authorization: Bearer <accessToken>` and role `USER`. `requireVerified` is not on the route. The service checks the current verification state.
* **Missing token:** `401 AUTH_REQUIRED`. Invalid token or a deleted account: `401 INVALID_TOKEN`.
* **Any role other than `USER`, including `ADMIN`:** `403 FORBIDDEN`.
* **Suspended:** `403 ACCOUNT_SUSPENDED`. **Banned:** `403 ACCOUNT_BANNED`.
* **Unverified email account:** `403 EMAIL_NOT_VERIFIED`. **Unverified phone account:** `403 PHONE_NOT_VERIFIED`.
* **Incomplete caller:** missing profile, `profiles.is_profile_complete` is false, missing dating preferences, or missing location: `400 PROFILE_INCOMPLETE`. Message: `Onboarding is incomplete.` `details` is empty.
* **Path `userId`:** required UUID. A bad value is `400 VALIDATION_ERROR` with field `userId` and message `User id must be a valid UUID.` The stored id is lower-cased.
* **Self target:** `400 SELF_INTERACTION`.
* **Unknown or deleted target:** `404 USER_NOT_FOUND`. Message: `Target user profile not found.`
* **Target is not `ACTIVE`, is incomplete, or has no active primary photo:** `404 INVALID_TARGET`.
* **Either user has blocked the other:** `409 BLOCKED_USER`. Message: `Interaction prohibited due to an active safety block.`
* **Caller already has an active action toward the target** (`likes.is_undone = false`, any of `LIKE`, `PASS`, or `SUPER_LIKE`): `409 ALREADY_SWIPED`. Message: `Target user has already been liked or permanently passed.` An undone row does not block a new action.
* **The pair already has a match with `status = 'ACTIVE'`:** `409 ACTIVE_MATCH_EXISTS`. Message: `Users are already in an active mutual match.` Historical `UNDONE` and `UNMATCHED` matches do not block a new action.
* **Premium:** an active subscription whose plan code is `PREMIUM_MONTHLY` or `PREMIUM_YEARLY`, whose status is `ACTIVE`, `PAST_DUE`, or `GRACE_PERIOD`, and whose `current_period_end` or `grace_period_end` is still in the future. There is no entitlement-feature lookup and no `entitlements` HTTP API.
* **Free LIKE and PASS quota:** metric `DAILY_LIKE_PASS` in `usage_records`. The window is the current UTC calendar day (`period_start` at UTC midnight, `period_end` 24 hours later). The increment is atomic and stops at 10. `remainingDailyActions` is `10 - usage_count`. Premium callers do not write `usage_records` for this metric, and `remainingDailyActions` is `null`. Exhausted free quota is `429 DAILY_LIMIT_REACHED`. Message: `You have reached your daily limit of 10 likes/passes.` A failed write rolls the quota increment back with the rest of the transaction.
* **SUPER LIKE credits** are separate. A Super Like does not increment `DAILY_LIKE_PASS`.

### 20.1 Pass a Profile
* **Method & Path:** `POST /api/v1/discovery/:userId/pass`
* **Body:** none. This route does not read `Idempotency-Key`.
* **Self message:** `You cannot pass your own profile.`
* **Invalid target message:** `This profile cannot be passed.`
* **Side effects:** Inserts one `likes` row with `action = 'PASS'` and `is_undone = false`. Does not create a match or a conversation. While that row stays active, Discovery excludes the target for the caller. Premium Undo can later set `is_undone = true`. The row is not deleted.
* **Success Response (`200 OK`):** Message: `Profile passed.`
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
  Premium success uses `"remainingDailyActions": null`.

### 20.2 Like a Profile
* **Method & Path:** `POST /api/v1/discovery/:userId/like`
* **Body:** none.
* **Idempotency:** optional header `Idempotency-Key`. When present it must be a UUID. A bad value is `400 VALIDATION_ERROR` on field `Idempotency-Key`. Redis key `idempotency:<callerId>:<key>`, TTL 120 seconds. A stored success is returned again and does not write again. A key still marked in progress returns `409 IDEMPOTENCY_CONFLICT`. Message: `A request with this Idempotency-Key is already in progress.` A failed attempt deletes the pending key. Omitting the header runs the action once with no Redis record.
* **Self message:** `You cannot like your own profile.`
* **Invalid target message:** `This profile cannot be liked.`
* **Transaction:** The two user rows are locked in canonical id order. The like is inserted with `action = 'LIKE'` and `is_undone = false`. If the target has an active `LIKE` or `SUPER_LIKE` toward the caller, the service inserts one `matches` row with `status = 'ACTIVE'` and one `conversations` row with `status = 'ACTIVE'`. Pair columns are `user_one_id = LEAST(caller, target)` and `user_two_id = GREATEST(caller, target)`. `unmatched_at` and `unmatched_by_user_id` stay null. A reciprocal `PASS` does not create a match. The target's reciprocal row stays active. A unique active-pair or active-match conflict returns `409 ALREADY_SWIPED` or `409 ACTIVE_MATCH_EXISTS`. The free quota increment runs in the same transaction after the like, so a quota failure does not leave a like behind. No notification row is written.
* **Success Response (`200 OK`):** Message is `It's a Match!` when `isMatch` is true, otherwise `Profile liked.`
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
  No match uses `"isMatch": false` and `"matchId": null`. Premium uses `"remainingDailyActions": null`.

### 20.3 Super Like a Profile
* **Method & Path:** `POST /api/v1/discovery/:userId/super-like`
* **Body:** none.
* **Auth extra:** Premium is required inside the transaction. A caller without the Premium subscription described above receives `403 PREMIUM_REQUIRED`. Message: `Feature requires an active Premium subscription.`
* **Idempotency:** optional `Idempotency-Key` UUID, same conflict and TTL rules as LIKE. Redis key is `idempotency:<callerId>:super-like:<key>`, so a LIKE key and a SUPER LIKE key do not collide.
* **Self message:** `You cannot super like your own profile.`
* **Invalid target message:** `This profile cannot be super liked.`
* **Credits:** Decrements `user_credit_balances.balance` by 1 where `credit_type = 'SUPER_LIKE'` and `balance >= 1`. A missing row or a zero balance is `409 INSUFFICIENT_SUPER_LIKE_CREDITS`. Message: `You do not have any Super Like credits.` The response `remainingSuperLikeCredits` is the balance after the decrement. The same transaction inserts `credit_transactions` with `credit_type = 'SUPER_LIKE'`, `delta = -1`, `reason = 'CONSUMPTION'`, and `reference_id` set to the new like id. This does not change `usage_records`.
* **Match:** Same reciprocal rule as LIKE. An active incoming `LIKE` or `SUPER_LIKE` creates an `ACTIVE` match and an `ACTIVE` conversation. A reciprocal `PASS` does not. Concurrent reciprocal likes are serialized by locking both users in canonical id order and by the partial unique indexes on active likes and active matches.
* **Success Response (`200 OK`):** Message is `It's a Match!` when `isMatch` is true, otherwise `Profile super liked.`
  ```json
  {
    "success": true,
    "data": {
      "action": "SUPER_LIKE",
      "targetUserId": "c3e7d81b-9932-4233-812c-6f5e39482130",
      "isMatch": false,
      "matchId": null,
      "remainingSuperLikeCredits": 4
    },
    "message": "Profile super liked."
  }
  ```

---

## 21. Undo APIs

**Implemented.** Undo is Premium only. It does not use Redis and does not read `Idempotency-Key`.

### 21.1 Undo the latest active outgoing LIKE or PASS
* **Method & Path:** `POST /api/v1/discovery/undo`
* **Auth:** `Authorization: Bearer <accessToken>` and role `USER`. `requireVerified` is not on the route. The service checks verification and returns `403 EMAIL_NOT_VERIFIED` or `403 PHONE_NOT_VERIFIED`. A non-`USER` role is `403 FORBIDDEN`.
* **Body:** none. No path parameter and no query string.
* **Incomplete caller:** `400 PROFILE_INCOMPLETE`, same rule as section 20.
* **Premium:** the same subscription rule as section 20. Anyone else receives `403 PREMIUM_REQUIRED`. Message: `Feature requires an active Premium subscription.`
* **Eligible row:** the caller's latest `likes` row with `is_undone = false` and `action IN ('LIKE', 'PASS')`, ordered by `created_at DESC`. Incoming actions are ignored. A `SUPER_LIKE` is never selected. An already undone row is ignored.
* **Five-minute window:** the selected row is inside the window when `created_at >= CURRENT_TIMESTAMP - INTERVAL '5 minutes'`. A timestamp exactly five minutes old is valid. If that latest eligible row is older, the response is `400 UNDO_WINDOW_EXPIRED`. Message: `The undo window for your last action has expired.` The service does not fall back to an older row.
* **No eligible row:** `400 NO_UNDOABLE_ACTION`. Message: `There is no action to undo.`
* **Persistence:** sets `is_undone = true` on that row. The row is not deleted. A repeated undo can then select the next older active `LIKE` or `PASS`, one action at a time, if that next row is itself inside the five-minute window.
* **Match:** when the undone action is `LIKE` and that pair's current match is `ACTIVE`, the match becomes `UNDONE`. `unmatched_at` and `unmatched_by_user_id` stay null. The associated conversation with `status = 'ACTIVE'` becomes `CLOSED` and `closed_at` is set. A `PASS` does not change matches or conversations. Historical `UNDONE` and `UNMATCHED` matches stay as they are. The other user's reciprocal `LIKE` or `SUPER_LIKE` stays active.
* **Quota:** Undo does not restore a LIKE or PASS, does not consume another action, and does not update `usage_records`.
* **Success Response (`200 OK`):** Message: `Previous action undone.`
  ```json
  {
    "success": true,
    "data": {
      "undoneAction": "LIKE",
      "targetUserId": "TARGET_USER_ID",
      "revertedMatch": true
    },
    "message": "Previous action undone."
  }
  ```
  `undoneAction` is `LIKE` or `PASS`. `revertedMatch` is `true` only when an `ACTIVE` match was moved to `UNDONE`.

---

## 22. Match APIs

`GET /api/v1/matches` is not mounted. `DELETE /api/v1/matches/:matchId` is implemented in section 22.2. LIKE and SUPER LIKE insert an `ACTIVE` match and an `ACTIVE` conversation when a reciprocal `LIKE` or `SUPER_LIKE` exists. UNDO of that LIKE moves the current `ACTIVE` match to `UNDONE` and closes its `ACTIVE` conversation. UNDO leaves `unmatched_at` and `unmatched_by_user_id` null. UNMATCH is a different action: it sets `UNMATCHED` and records who ended the match. It does not change `likes`. Rematch, which would insert a later `ACTIVE` row, is not implemented. Socket.IO `match:unmatch` is not emitted.

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
**Implemented.** Free for every verified `USER` with a complete profile. Premium is not required. The route does not read subscriptions, `usage_records`, credits, or Redis.

* **Method & Path:** `DELETE /api/v1/matches/:matchId`
* **Auth:** `Authorization: Bearer <accessToken>` and role `USER`. Middleware is `authenticate` and `requireRole('USER')`. `requireVerified` is not on the route. The service checks verification and returns `403 EMAIL_NOT_VERIFIED` or `403 PHONE_NOT_VERIFIED`. A non-`USER` role is `403 FORBIDDEN`.
* **Body:** none. No query string.
* **Path `matchId`:** required UUID. A bad value is `400 VALIDATION_ERROR`. Message: `Validation failed`. `details` is `[{ "field": "matchId", "message": "Match id must be a valid UUID." }]`.
* **Incomplete caller:** `400 PROFILE_INCOMPLETE`, same rule as section 20. Message: `Onboarding is incomplete.`
* **Who can unmatch:** either `user_one_id` or `user_two_id` on that row. The other participant does not have to be verified, complete, or `ACTIVE`.
* **Eligible row:** `matches.status` must be `ACTIVE`. `UNDONE` and `UNMATCHED` rows are not changed.
* **Not found:** `404 MATCH_NOT_FOUND`. Message: `Active match record does not exist.` This covers a missing id, a match belonging to two other users, a non-`ACTIVE` row, an already `UNMATCHED` row, an `UNDONE` row, and a concurrent request that already transitioned the row. A foreign match is not `403`, so the response does not reveal that the id exists. A repeated `DELETE` is this 404, not another `200`.
* **Transaction:** one Sequelize transaction. The service loads the match by id. If the caller is not a participant, or the status is not `ACTIVE`, it returns `404` without locking those users. Otherwise it locks both users with `lockLikeUsers` in canonical id order, re-reads the match `FOR UPDATE`, and updates only while `status = 'ACTIVE'` and the caller is still a participant.
* **Match:** `ACTIVE` becomes `UNMATCHED`. `unmatched_at` and `updated_at` are `CURRENT_TIMESTAMP`. `unmatched_by_user_id` is the caller. `matched_at`, `created_at`, `user_one_id`, and `user_two_id` stay unchanged. The row is kept. Other historical rows for the pair are not updated.
* **Conversation:** the `ACTIVE` conversation for that match becomes `CLOSED` and `closed_at` is set through `closeActiveConversation`. The conversation row stays. `last_message_at` stays. Messages stay, and `messages.deleted_at` is not set. An already `CLOSED` conversation is left as it is, including its existing `closed_at`. A match with no conversation row still unmatches.
* **Likes:** no `likes` row is inserted, deleted, or marked undone. Reciprocal `LIKE` and `SUPER_LIKE` rows stay, with `is_undone` unchanged. UNMATCH is not UNDO.
* **Discovery:** this route does not change the discovery query. An `UNMATCHED` match does not by itself exclude a candidate. An active outgoing `LIKE` or `SUPER_LIKE` still does. UNMATCH does not make the two users appear in discovery while those rows remain.
* **Rematch:** not implemented. The partial unique index still allows a later new `ACTIVE` row. This endpoint does not revive the old row.
* **Quota and Redis:** no `usage_records` write, no credit change, and no `credit_transactions` row. `Idempotency-Key` is ignored. No notification row is written and no Socket.IO event is emitted.
* **Success Response (`200 OK`):** Message: `Unmatched successfully.`
  ```json
  {
    "success": true,
    "data": { "unmatched": true },
    "message": "Unmatched successfully."
  }
  ```
  The body does not include match id, target user id, `unmatchedAt`, conversation status, quota, or credits.

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

**Phase 6 Slice 1 foundation is implemented.** Socket.IO is attached to the Express HTTP server with `@socket.io/redis-adapter`. Chat message HTTP routes, conversation rooms, and application chat events are still not implemented. `DELETE /api/v1/matches/:matchId` still does not emit `match:unmatch`.

### 32.0 Implemented foundation
* **Handshake:** Client connects with `auth: { token: "<access JWT>" }`. The token is the same access JWT used by HTTP `Authorization: Bearer`. Refresh tokens are not accepted.
* **Authentication:** Handshake verifies the JWT, reloads the user from PostgreSQL, and rejects missing/invalid/expired tokens (`AUTH_REQUIRED` / `INVALID_TOKEN`), deleted users (`INVALID_TOKEN`), suspended users (`ACCOUNT_SUSPENDED`), banned users (`ACCOUNT_BANNED`), and non-`USER` roles (`FORBIDDEN`).
* **Socket identity:** Successful handshakes store the live `AuthenticatedUser` on `socket.data.user`. Later chat slices must use `socket.data.user.id` as sender identity. Unverified or incomplete profiles are allowed to connect in Slice 1.
* **User room:** On connect the server joins exactly `user:{userId}` from `socket.data.user.id`. The client cannot choose the room. Conversation rooms are not joined.
* **Redis:** Socket.IO requires Redis for the adapter. Production fails startup if Redis or the adapter cannot initialize. Development can keep serving HTTP without Socket.IO when Redis is unavailable.
* **Not in Slice 1:** No message persistence, no chat send/receive events, no typing events, no read receipts, no conversation-room join, no media uploads, and no notification/match socket emissions.

### 32.1 Server $\rightarrow$ Client Events
| Event Name | Room / Target | Payload Structure | Trigger Condition | Status |
| :--- | :--- | :--- | :--- | :--- |
| `match:new` | `user:{userId}` | `{"matchId": "...", "matchedUser": { "id": "...", "firstName": "Jordan", "photos": [...] }, "matchedAt": "..."}` | Reciprocal like establishes active match. | Planned |
| `match:unmatch` | `user:{userId}` | `{"matchId": "...", "conversationId": "..."}` | Participant unmatches or block is triggered. | Planned |
| `chat:message:new` | `conversation:{id}`| `{"id": "msg-1", "conversationId": "...", "senderId": "...", "messageType": "TEXT", "content": "...", "createdAt": "..."}` | Message persisted in PostgreSQL. | Planned |
| `chat:message:read`| `conversation:{id}`| `{"conversationId": "...", "readerId": "...", "readAt": "..."}` | Participant opens active conversation. | Planned |
| `notification:new` | `user:{userId}` | `{"id": "notif-1", "type": "NEW_LIKE", "title": "New Like!", "message": "Someone liked you!"}` | System notification dispatched. | Planned |

### 32.2 Client $\rightarrow$ Server Events
| Event Name | Payload Structure | Description | Status |
| :--- | :--- | :--- | :--- |
| `chat:message:send` | `{"conversationId": "...", "messageType": "TEXT", "content": "..."}` | Client transmits chat message. | Planned |
| `chat:message:read` | `{"conversationId": "..."}` | Client marks incoming messages as read. | Planned |
| `chat:typing:start` | `{"conversationId": "..."}` | Client begins typing in active match. | Planned |
| `chat:typing:stop` | `{"conversationId": "..."}` | Client stops typing. | Planned |

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

1. **Implemented client mutating APIs** that accept an optional `Idempotency-Key: <UUIDv4>` header:
   * `POST /api/v1/discovery/:userId/like` — Redis key `idempotency:<callerId>:<key>`.
   * `POST /api/v1/discovery/:userId/super-like` — Redis key `idempotency:<callerId>:super-like:<key>`.
2. **Not used:** `POST /api/v1/discovery/:userId/pass`, `POST /api/v1/discovery/undo`, and `DELETE /api/v1/matches/:matchId` do not read `Idempotency-Key` and do not write an idempotency key. A second unmatch is `404 MATCH_NOT_FOUND`.
3. **Planned:** `POST /api/v1/payments/checkout`.
4. **Execution flow for LIKE and SUPER LIKE:**
   * A stored JSON success is returned without another write.
   * A key whose value is still the in-progress marker returns `409 IDEMPOTENCY_CONFLICT`.
   * The key expires after 120 seconds.
   * A failed attempt deletes the pending key so a retry with the same key can run.

---

## 35. Rate Limiting Strategy

Rate limits are enforced using Redis sliding-window algorithms:

| Endpoint Group | Rate Limit Window | Max Requests | Scope |
| :--- | :--- | :--- | :--- |
| **Auth register, login, forgot-password** | 1 minute | 5 requests | IP. Live. `429 RATE_LIMITED`. |
| **Verification resend** | 1 minute | 1 request | Identifier. Live. Registration consumes the same window. |
| **Discovery swipe actions** | 1 minute | 60 requests | User ID. Planned. PASS, LIKE, SUPER LIKE, UNDO, and UNMATCH do not use this limiter today. |
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
| **Discovery** (`GET /discovery`, implemented) | `profiles` (PostGIS GiST), `users`, `genders`, `dating_preferences`, `user_dating_preference_genders`, `user_dating_preference_intentions`, `user_relationship_intentions`, `relationship_intentions`, `user_interests`, `interests`, `profile_photos`, `likes`, `matches`, `blocks`, `boost_sessions` |
| **Pass** (`POST /discovery/:userId/pass`, implemented) | `likes`, `usage_records`, `subscriptions`, `plans`, `users`, `profiles`, `profile_photos`, `blocks`, `matches` |
| **Like** (`POST /discovery/:userId/like`, implemented) | `likes`, `matches`, `conversations`, `usage_records`, `subscriptions`, `plans`, `users`. Redis holds the optional idempotency record. No `notifications` row is written. |
| **Super Like** (`POST /discovery/:userId/super-like`, implemented) | `likes`, `matches`, `conversations`, `subscriptions`, `plans`, `user_credit_balances`, `credit_transactions`, `users`. Redis holds the optional idempotency record. `usage_records` is not changed. |
| **Undo** (`POST /discovery/undo`, implemented) | `likes`, `matches`, `conversations`, `subscriptions`, `plans`. Does not change `usage_records`. Does not use Redis. |
| **Unmatch** (`DELETE /matches/:matchId`, implemented) | `matches`, `conversations`. Does not change `likes`, `messages`, `usage_records`, credits, or Redis. |
| **Matches list** | `matches`, `conversations`. `GET /matches` is not mounted. |
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
