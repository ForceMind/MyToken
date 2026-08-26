import type { BeginRequestLogInput, CompleteRequestLogInput } from "@mytoken/database";
import type { GatewayRequestLogRecord, KeyUsageSummary } from "@mytoken/shared";

export interface GatewayUsageStore {
  begin(input: BeginRequestLogInput): void;
  complete(id: string, input: CompleteRequestLogInput): void;
  usage(apiKeyId: string, now?: number): KeyUsageSummary;
  list(options?: { apiKeyId?: string; limit?: number; offset?: number }): GatewayRequestLogRecord[];
}
