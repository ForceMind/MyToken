import type {
  AdminAuthStore,
  AdminSessionRecord,
  AdminUserRecord,
  AuthenticatedAdminSession,
} from "@mytoken/admin-auth";

import type { MyTokenDatabase } from "./database.js";

export class AdminAuthRepository implements AdminAuthStore {
  constructor(readonly database: MyTokenDatabase) {}

  isInitialized(): boolean {
    return Boolean(this.database.sqlite.prepare("SELECT 1 FROM admin_users LIMIT 1").get());
  }

  setBootstrapToken(tokenDigest: string, now: number): boolean {
    const admin = this.database.sqlite.prepare("SELECT 1 FROM admin_users LIMIT 1").get();
    if (admin) return false;
    const result = this.database.sqlite
      .prepare(
        `INSERT OR IGNORE INTO bootstrap_state
          (singleton_id, token_digest, created_at, consumed_at)
         VALUES (1, ?, ?, NULL)`,
      )
      .run(tokenDigest, now);
    return result.changes === 1;
  }

  canConsumeBootstrap(tokenDigest: string): boolean {
    const row = this.database.sqlite
      .prepare(
        `SELECT 1 FROM bootstrap_state
         WHERE singleton_id = 1 AND token_digest = ? AND consumed_at IS NULL
           AND NOT EXISTS (SELECT 1 FROM admin_users LIMIT 1)`,
      )
      .get(tokenDigest);
    return Boolean(row);
  }

  consumeBootstrap(input: { tokenDigest: string; user: AdminUserRecord; now: number }): boolean {
    this.database.sqlite.exec("BEGIN IMMEDIATE");
    try {
      const state = this.database.sqlite
        .prepare(
          `SELECT token_digest AS tokenDigest, consumed_at AS consumedAt
           FROM bootstrap_state WHERE singleton_id = 1`,
        )
        .get() as { tokenDigest: string; consumedAt: number | null } | undefined;
      const admin = this.database.sqlite.prepare("SELECT 1 FROM admin_users LIMIT 1").get();
      if (!state || state.consumedAt !== null || state.tokenDigest !== input.tokenDigest || admin) {
        this.database.sqlite.exec("ROLLBACK");
        return false;
      }

      this.database.sqlite
        .prepare(
          `INSERT INTO admin_users
            (id, username, password_hash, created_at, updated_at, password_changed_at, disabled_at)
           VALUES (?, ?, ?, ?, ?, ?, NULL)`,
        )
        .run(
          input.user.id,
          input.user.username,
          input.user.passwordHash,
          input.user.createdAt,
          input.user.updatedAt,
          input.user.passwordChangedAt,
        );
      this.database.sqlite
        .prepare("UPDATE bootstrap_state SET consumed_at = ? WHERE singleton_id = 1")
        .run(input.now);
      this.database.sqlite.exec("COMMIT");
      return true;
    } catch (error) {
      this.database.sqlite.exec("ROLLBACK");
      throw error;
    }
  }

  findUserByUsername(username: string): AdminUserRecord | undefined {
    return this.database.sqlite
      .prepare(
        `SELECT id, username, password_hash AS passwordHash, created_at AS createdAt,
                updated_at AS updatedAt, password_changed_at AS passwordChangedAt,
                disabled_at AS disabledAt
         FROM admin_users WHERE username = ?`,
      )
      .get(username) as AdminUserRecord | undefined;
  }

  createSession(session: AdminSessionRecord): void {
    this.database.sqlite
      .prepare(
        `INSERT INTO admin_sessions
          (id, user_id, token_digest, csrf_digest, created_at, last_seen_at, expires_at,
           revoked_at, user_agent_hash, ip_fingerprint)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        session.id,
        session.userId,
        session.tokenDigest,
        session.csrfDigest,
        session.createdAt,
        session.lastSeenAt,
        session.expiresAt,
        session.revokedAt,
        session.userAgentHash,
        session.ipFingerprint,
      );
  }

  findSessionByTokenDigest(tokenDigest: string): AuthenticatedAdminSession | undefined {
    const row = this.database.sqlite
      .prepare(
        `SELECT
           s.id AS sessionId, s.user_id AS sessionUserId, s.token_digest AS sessionTokenDigest,
           s.csrf_digest AS sessionCsrfDigest, s.created_at AS sessionCreatedAt,
           s.last_seen_at AS sessionLastSeenAt, s.expires_at AS sessionExpiresAt,
           s.revoked_at AS sessionRevokedAt, s.user_agent_hash AS sessionUserAgentHash,
           s.ip_fingerprint AS sessionIpFingerprint,
           u.id AS userId, u.username AS username, u.password_hash AS passwordHash,
           u.created_at AS userCreatedAt, u.updated_at AS userUpdatedAt,
           u.password_changed_at AS passwordChangedAt, u.disabled_at AS userDisabledAt
         FROM admin_sessions s
         JOIN admin_users u ON u.id = s.user_id
         WHERE s.token_digest = ?`,
      )
      .get(tokenDigest) as SessionJoinRow | undefined;
    if (!row) return undefined;
    return {
      session: {
        id: row.sessionId,
        userId: row.sessionUserId,
        tokenDigest: row.sessionTokenDigest,
        csrfDigest: row.sessionCsrfDigest,
        createdAt: row.sessionCreatedAt,
        lastSeenAt: row.sessionLastSeenAt,
        expiresAt: row.sessionExpiresAt,
        revokedAt: row.sessionRevokedAt,
        userAgentHash: row.sessionUserAgentHash,
        ipFingerprint: row.sessionIpFingerprint,
      },
      user: {
        id: row.userId,
        username: row.username,
        passwordHash: row.passwordHash,
        createdAt: row.userCreatedAt,
        updatedAt: row.userUpdatedAt,
        passwordChangedAt: row.passwordChangedAt,
        disabledAt: row.userDisabledAt,
      },
    };
  }

  touchSession(sessionId: string, now: number): void {
    this.database.sqlite
      .prepare("UPDATE admin_sessions SET last_seen_at = ? WHERE id = ?")
      .run(now, sessionId);
  }

  revokeSession(sessionId: string, now: number): void {
    this.database.sqlite
      .prepare("UPDATE admin_sessions SET revoked_at = COALESCE(revoked_at, ?) WHERE id = ?")
      .run(now, sessionId);
  }

  revokeAllUserSessions(userId: string, now: number): void {
    this.database.sqlite
      .prepare("UPDATE admin_sessions SET revoked_at = COALESCE(revoked_at, ?) WHERE user_id = ?")
      .run(now, userId);
  }
}

interface SessionJoinRow {
  sessionId: string;
  sessionUserId: string;
  sessionTokenDigest: string;
  sessionCsrfDigest: string;
  sessionCreatedAt: number;
  sessionLastSeenAt: number;
  sessionExpiresAt: number;
  sessionRevokedAt: number | null;
  sessionUserAgentHash: string | null;
  sessionIpFingerprint: string | null;
  userId: string;
  username: string;
  passwordHash: string;
  userCreatedAt: number;
  userUpdatedAt: number;
  passwordChangedAt: number;
  userDisabledAt: number | null;
}
