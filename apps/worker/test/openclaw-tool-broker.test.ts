import { describe, expect, it, vi } from "vitest";

import { OpenClawToolBroker } from "../src/tool-bridge/openclaw-tool-broker.js";

const params = {
  callId: "call-1",
  threadId: "thread-1",
  turnId: "turn-1",
  namespace: null,
  tool: "weather",
  arguments: { city: "Shanghai" },
};

describe("OpenClawToolBroker", () => {
  it("rejects a result from a stale worker generation", async () => {
    const broker = new OpenClawToolBroker({ resultTimeoutMs: 2_000 });
    const pending = broker.handle(params, { requestId: "rpc-1", generation: 4 });

    expect(() =>
      broker.resolve("call-1", 3, {
        success: true,
        contentItems: [{ type: "inputText", text: "wrong generation" }],
      }),
    ).toThrowError(/old worker generation/u);

    broker.resolve("call-1", 4, {
      success: true,
      contentItems: [{ type: "inputText", text: "ok" }],
    });
    await expect(pending).resolves.toMatchObject({ success: true });
  });

  it("fails a pending call safely when its timeout expires", async () => {
    vi.useFakeTimers();
    try {
      const broker = new OpenClawToolBroker({ resultTimeoutMs: 50 });
      const pending = broker.handle(params, { requestId: "rpc-1", generation: 1 });
      await vi.advanceTimersByTimeAsync(51);
      await expect(pending).resolves.toEqual({
        success: false,
        contentItems: [{ type: "inputText", text: "Client tool result timed out." }],
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
