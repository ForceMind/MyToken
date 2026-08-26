import ipaddr from "ipaddr.js";

import type { MyTokenKeyRecord } from "@mytoken/key-auth";
import { MyTokenError } from "@mytoken/shared";

import type { GatewayUsageStore } from "./usage-store.js";

export interface AdmissionLease {
  release(): void;
}

export class RequestPolicyManager {
  readonly #usage: GatewayUsageStore;
  readonly #now: () => number;
  readonly #rpmWindows = new Map<string, number[]>();
  readonly #active = new Map<string, number>();
  #globalActive = 0;
  readonly #globalConcurrency: number;

  constructor(
    usage: GatewayUsageStore,
    options: { now?: () => number; globalConcurrency?: number } = {},
  ) {
    this.#usage = usage;
    this.#now = options.now ?? Date.now;
    this.#globalConcurrency = options.globalConcurrency ?? 1;
  }

  acquire(record: MyTokenKeyRecord, ip: string, billable: boolean): AdmissionLease {
    assertIpAllowed(ip, record.ipAllowlist);
    const now = this.#now();
    const rpm = (this.#rpmWindows.get(record.id) ?? []).filter((seen) => seen > now - 60_000);
    if (rpm.length >= record.rpmLimit) {
      throw new PolicyError(429, "key_rpm_limit_exceeded", "API Key RPM limit exceeded", 60);
    }
    rpm.push(now);
    this.#rpmWindows.set(record.id, rpm);

    if (!billable) return { release() {} };

    const current = this.#active.get(record.id) ?? 0;
    if (current >= record.maxConcurrency) {
      throw new PolicyError(
        429,
        "key_concurrency_limit_exceeded",
        "API Key concurrency limit exceeded",
        1,
      );
    }
    if (this.#globalActive >= this.#globalConcurrency) {
      throw new PolicyError(
        429,
        "gateway_concurrency_limit_exceeded",
        "Gateway concurrency limit exceeded",
        1,
      );
    }

    const usage = this.#usage.usage(record.id, now);
    if (usage.todayRequests >= record.dailyRequestLimit) {
      throw new PolicyError(
        429,
        "key_daily_limit_exceeded",
        "API Key daily request limit exceeded",
        secondsUntilTomorrow(now),
      );
    }
    if (record.requestBudget !== null && usage.billableRequests >= record.requestBudget) {
      throw new PolicyError(
        429,
        "key_request_budget_exhausted",
        "API Key request balance exhausted",
      );
    }
    if (record.tokenBudget !== null && usage.totalTokens >= record.tokenBudget) {
      throw new PolicyError(429, "key_token_budget_exhausted", "API Key token budget exhausted");
    }

    this.#active.set(record.id, current + 1);
    this.#globalActive += 1;
    let released = false;
    return {
      release: () => {
        if (released) return;
        released = true;
        const next = Math.max(0, (this.#active.get(record.id) ?? 1) - 1);
        if (next === 0) this.#active.delete(record.id);
        else this.#active.set(record.id, next);
        this.#globalActive = Math.max(0, this.#globalActive - 1);
      },
    };
  }

  activeForKey(keyId: string): number {
    return this.#active.get(keyId) ?? 0;
  }

  get globalActive(): number {
    return this.#globalActive;
  }
}

export class PolicyError extends MyTokenError {
  constructor(
    readonly statusCode: number,
    code: string,
    message: string,
    readonly retryAfter?: number,
  ) {
    super(code, message);
    this.name = "PolicyError";
  }
}

export function validateIpAllowlist(values: readonly string[]): void {
  for (const value of values) parseRule(value);
}

export function assertIpAllowed(ip: string, rules: readonly string[]): void {
  if (rules.length === 0) return;
  let address: ipaddr.IPv4 | ipaddr.IPv6;
  try {
    address = ipaddr.process(ip);
  } catch {
    throw new PolicyError(403, "source_ip_invalid", "Source IP could not be validated");
  }
  const allowed = rules.some((rule) => {
    const parsed = parseRule(rule);
    if (Array.isArray(parsed)) {
      const [network, prefix] = parsed;
      return network.kind() === address.kind() && address.match(network, prefix);
    }
    return parsed.kind() === address.kind() && parsed.toString() === address.toString();
  });
  if (!allowed) throw new PolicyError(403, "source_ip_not_allowed", "Source IP is not allowed");
}

function parseRule(value: string): ipaddr.IPv4 | ipaddr.IPv6 | [ipaddr.IPv4 | ipaddr.IPv6, number] {
  const normalized = value.trim();
  try {
    if (normalized.includes("/")) {
      const [address, prefix] = ipaddr.parseCIDR(normalized);
      return [normalizeAddress(address), prefix];
    }
    return ipaddr.process(normalized);
  } catch (error) {
    throw new MyTokenError("invalid_ip_allowlist", `Invalid IP or CIDR rule: ${normalized}`, error);
  }
}

function normalizeAddress(address: ipaddr.IPv4 | ipaddr.IPv6): ipaddr.IPv4 | ipaddr.IPv6 {
  if (address.kind() !== "ipv6") return address;
  const ipv6 = address as ipaddr.IPv6;
  return ipv6.isIPv4MappedAddress() ? ipv6.toIPv4Address() : ipv6;
}

function secondsUntilTomorrow(now: number): number {
  const date = new Date(now);
  const tomorrow = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1);
  return Math.max(1, Math.ceil((tomorrow - now) / 1000));
}
