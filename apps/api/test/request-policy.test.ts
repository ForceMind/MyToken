import { randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import { createMyTokenKey } from "@mytoken/key-auth";
import type { GatewayRequestLogRecord, KeyUsageSummary } from "@mytoken/shared";

import { PolicyError, RequestPolicyManager, assertIpAllowed } from "../src/request-policy.js";
import type { GatewayUsageStore } from "../src/usage-store.js";

function usage(overrides: Partial<KeyUsageSummary> = {}): KeyUsageSummary {
  return {
    totalRequests: 0,
    billableRequests: 0,
    todayRequests: 0,
    successfulRequests: 0,
    failedRequests: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    lastRequestAt: null,
    ...overrides,
  };
}

function store(summary: KeyUsageSummary): GatewayUsageStore {
  return {
    begin() {},
    complete() {},
    usage: () => summary,
    list: () => [] as GatewayRequestLogRecord[],
  };
}

describe("RequestPolicyManager", () => {
  it("enforces IPv4, IPv6 and CIDR allowlists", () => {
    expect(() => assertIpAllowed("203.0.113.8", ["203.0.113.0/24"])).not.toThrow();
    expect(() => assertIpAllowed("2001:db8::7", ["2001:db8::/48"])).not.toThrow();
    expect(() => assertIpAllowed("198.51.100.1", ["203.0.113.0/24"])).toThrowError(PolicyError);
  });

  it("enforces request balance, daily usage and concurrency", () => {
    const record = createMyTokenKey(randomBytes(32), {
      mode: "test",
      name: "policy",
      requestBudget: 2,
      dailyRequestLimit: 2,
      maxConcurrency: 1,
      rpmLimit: 10,
    }).record;
    const manager = new RequestPolicyManager(store(usage({ billableRequests: 1 })), {
      globalConcurrency: 1,
    });
    const lease = manager.acquire(record, "127.0.0.1", true);
    expect(() => manager.acquire(record, "127.0.0.1", true)).toThrowError(/concurrency limit/u);
    lease.release();

    const exhausted = new RequestPolicyManager(
      store(usage({ billableRequests: 2, todayRequests: 2 })),
    );
    expect(() => exhausted.acquire(record, "127.0.0.1", true)).toThrowError(PolicyError);
  });

  it("enforces RPM before a request reaches the worker", () => {
    const record = createMyTokenKey(randomBytes(32), {
      mode: "test",
      name: "rpm",
      rpmLimit: 1,
    }).record;
    const manager = new RequestPolicyManager(store(usage()), { globalConcurrency: 2 });
    manager.acquire(record, "127.0.0.1", false);
    expect(() => manager.acquire(record, "127.0.0.1", false)).toThrowError(/RPM/u);
  });
});
