import { randomBytes } from "node:crypto";

import { afterEach, describe, expect, it } from "vitest";

import { AdminAuthService } from "@mytoken/admin-auth";

import { AdminAuthRepository } from "../src/admin-auth-repository.js";
import { MyTokenDatabase } from "../src/database.js";

const databases: MyTokenDatabase[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

describe("administrator authentication", () => {
  it("consumes bootstrap once and creates a server-side session", async () => {
    let now = 1_000;
    const database = new MyTokenDatabase(":memory:");
    databases.push(database);
    database.migrate();
    const repository = new AdminAuthRepository(database);
    const auth = new AdminAuthService(repository, randomBytes(32), {
      now: () => now,
      sessionTtlMs: 10_000,
    });
    const bootstrap = auth.createBootstrapToken();
    expect(auth.installBootstrapToken(bootstrap)).toBe(true);

    await expect(
      auth.bootstrap({
        bootstrapToken: "wrong",
        username: "admin",
        password: "correct horse battery staple",
      }),
    ).rejects.toThrowError(/invalid or already consumed/u);

    const user = await auth.bootstrap({
      bootstrapToken: bootstrap.plaintext,
      username: "admin",
      password: "correct horse battery staple",
    });
    expect(user.username).toBe("admin");
    await expect(
      auth.bootstrap({
        bootstrapToken: bootstrap.plaintext,
        username: "admin2",
        password: "another correct horse password",
      }),
    ).rejects.toThrowError(/invalid or already consumed/u);

    const login = await auth.login({ username: "admin", password: "correct horse battery staple" });
    expect(login.sessionToken).toMatch(/^mys_/u);
    expect(login.csrfToken).toMatch(/^myc_/u);
    const session = auth.authenticate(login.sessionToken);
    expect(session.user.id).toBe(user.id);
    expect(() => auth.verifyCsrf(session.session, "wrong")).toThrowError(/CSRF/u);
    expect(() => auth.verifyCsrf(session.session, login.csrfToken)).not.toThrow();

    now += 1;
    auth.logout(session.session.id);
    expect(() => auth.authenticate(login.sessionToken)).toThrowError(/session is invalid/u);
  });

  it("returns the same public error for unknown users and bad passwords", async () => {
    const database = new MyTokenDatabase(":memory:");
    databases.push(database);
    database.migrate();
    const auth = new AdminAuthService(new AdminAuthRepository(database), randomBytes(32));

    await expect(
      auth.login({ username: "missing", password: "some password" }),
    ).rejects.toMatchObject({
      code: "invalid_admin_credentials",
      message: "Invalid username or password",
    });
  });
});
