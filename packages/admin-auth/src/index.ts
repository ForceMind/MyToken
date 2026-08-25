import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { hash, verify, type Algorithm } from "@node-rs/argon2";

import { MyTokenError } from "@mytoken/shared";

export interface AdminUserRecord {
  id: string;
  username: string;
  passwordHash: string;
  createdAt: number;
  updatedAt: number;
  passwordChangedAt: number;
  disabledAt: number | null;
}

export interface AdminSessionRecord {
  id: string;
  userId: string;
  tokenDigest: string;
  csrfDigest: string;
  createdAt: number;
  lastSeenAt: number;
  expiresAt: number;
  revokedAt: number | null;
  userAgentHash: string | null;
  ipFingerprint: string | null;
}

export interface AuthenticatedAdminSession {
  session: AdminSessionRecord;
  user: AdminUserRecord;
}

export interface AdminAuthStore {
  isInitialized(): boolean;
  setBootstrapToken(tokenDigest: string, now: number): boolean;
  consumeBootstrap(input: { tokenDigest: string; user: AdminUserRecord; now: number }): boolean;
  findUserByUsername(username: string): AdminUserRecord | undefined;
  createSession(session: AdminSessionRecord): void;
  findSessionByTokenDigest(tokenDigest: string): AuthenticatedAdminSession | undefined;
  touchSession(sessionId: string, now: number): void;
  revokeSession(sessionId: string, now: number): void;
  revokeAllUserSessions(userId: string, now: number): void;
}

export interface AdminAuthServiceOptions {
  sessionTtlMs?: number;
  now?: () => number;
}

export interface BootstrapToken {
  plaintext: string;
  digest: string;
}

export function bootstrapTokenFromPlaintext(plaintext: string): BootstrapToken {
  if (!/^myb_[A-Za-z0-9_-]{43}$/u.test(plaintext)) {
    throw new MyTokenError("invalid_bootstrap_format", "Bootstrap token format is invalid");
  }
  return { plaintext, digest: sha256(plaintext) };
}

export interface AdminLoginResult {
  sessionToken: string;
  csrfToken: string;
  expiresAt: number;
  user: { id: string; username: string };
}

const argonOptions = {
  algorithm: 2 as Algorithm,
  memoryCost: 65_536,
  timeCost: 3,
  parallelism: 1,
  outputLen: 32,
} as const;

export class AdminAuthService {
  readonly #store: AdminAuthStore;
  readonly #sessionSecret: Uint8Array;
  readonly #sessionTtlMs: number;
  readonly #now: () => number;
  readonly #dummyHash: Promise<string>;

  constructor(
    store: AdminAuthStore,
    sessionSecret: Uint8Array,
    options: AdminAuthServiceOptions = {},
  ) {
    if (sessionSecret.byteLength < 32) {
      throw new MyTokenError("weak_session_secret", "Session secret must be at least 32 bytes");
    }
    this.#store = store;
    this.#sessionSecret = sessionSecret;
    this.#sessionTtlMs = options.sessionTtlMs ?? 12 * 60 * 60_000;
    this.#now = options.now ?? Date.now;
    this.#dummyHash = hash("mytoken-dummy-password-not-used", argonOptions);
  }

  createBootstrapToken(): BootstrapToken {
    const plaintext = `myb_${randomBytes(32).toString("base64url")}`;
    return { plaintext, digest: sha256(plaintext) };
  }

  isInitialized(): boolean {
    return this.#store.isInitialized();
  }

  installBootstrapToken(token: BootstrapToken): boolean {
    return this.#store.setBootstrapToken(token.digest, this.#now());
  }

  async bootstrap(input: {
    bootstrapToken: string;
    username: string;
    password: string;
  }): Promise<{ id: string; username: string }> {
    validateUsername(input.username);
    validatePassword(input.password);
    const now = this.#now();
    const user: AdminUserRecord = {
      id: randomBytes(16).toString("hex"),
      username: input.username,
      passwordHash: await hash(input.password, argonOptions),
      createdAt: now,
      updatedAt: now,
      passwordChangedAt: now,
      disabledAt: null,
    };
    const consumed = this.#store.consumeBootstrap({
      tokenDigest: sha256(input.bootstrapToken),
      user,
      now,
    });
    if (!consumed) {
      throw new MyTokenError("invalid_bootstrap", "Bootstrap token is invalid or already consumed");
    }
    return { id: user.id, username: user.username };
  }

  async login(input: {
    username: string;
    password: string;
    userAgentHash?: string | null;
    ipFingerprint?: string | null;
  }): Promise<AdminLoginResult> {
    const user = this.#store.findUserByUsername(input.username);
    const passwordHash = user?.passwordHash ?? (await this.#dummyHash);
    const valid = await verify(passwordHash, input.password, argonOptions);
    if (!user || user.disabledAt !== null || !valid) {
      throw new MyTokenError("invalid_admin_credentials", "Invalid username or password");
    }

    const now = this.#now();
    const sessionToken = `mys_${randomBytes(32).toString("base64url")}`;
    const csrfToken = `myc_${randomBytes(32).toString("base64url")}`;
    const session: AdminSessionRecord = {
      id: randomBytes(16).toString("hex"),
      userId: user.id,
      tokenDigest: digest(this.#sessionSecret, sessionToken),
      csrfDigest: digest(this.#sessionSecret, csrfToken),
      createdAt: now,
      lastSeenAt: now,
      expiresAt: now + this.#sessionTtlMs,
      revokedAt: null,
      userAgentHash: input.userAgentHash ?? null,
      ipFingerprint: input.ipFingerprint ?? null,
    };
    this.#store.createSession(session);
    return {
      sessionToken,
      csrfToken,
      expiresAt: session.expiresAt,
      user: { id: user.id, username: user.username },
    };
  }

  authenticate(sessionToken: string): AuthenticatedAdminSession {
    const found = this.#store.findSessionByTokenDigest(digest(this.#sessionSecret, sessionToken));
    const now = this.#now();
    if (
      !found ||
      found.session.revokedAt !== null ||
      found.session.expiresAt <= now ||
      found.user.disabledAt !== null
    ) {
      throw new MyTokenError("invalid_admin_session", "Administrator session is invalid");
    }
    this.#store.touchSession(found.session.id, now);
    return found;
  }

  verifyCsrf(session: AdminSessionRecord, csrfToken: string): void {
    const actual = Buffer.from(digest(this.#sessionSecret, csrfToken), "base64url");
    const expected = Buffer.from(session.csrfDigest, "base64url");
    if (actual.byteLength !== expected.byteLength || !timingSafeEqual(actual, expected)) {
      throw new MyTokenError("invalid_csrf", "CSRF token is invalid");
    }
  }

  logout(sessionId: string): void {
    this.#store.revokeSession(sessionId, this.#now());
  }
}

function validateUsername(username: string): void {
  if (!/^[A-Za-z0-9_.-]{3,64}$/u.test(username)) {
    throw new MyTokenError("invalid_admin_username", "Username must be 3-64 safe characters");
  }
}

function validatePassword(password: string): void {
  if (password.length < 12 || password.length > 1024) {
    throw new MyTokenError("invalid_admin_password", "Password must be 12-1024 characters");
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("base64url");
}

function digest(secret: Uint8Array, value: string): string {
  return createHmac("sha256", secret).update(value).digest("base64url");
}
