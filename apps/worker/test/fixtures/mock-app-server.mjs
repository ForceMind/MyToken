import { createInterface } from "node:readline";

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
const toolRequests = new Map();
const threads = new Map();

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

lines.on("line", (line) => {
  const message = JSON.parse(line);

  if (message.method === "initialize") {
    send({
      id: message.id,
      result: {
        userAgent: "mock-app-server/1.0",
        platformFamily: "unix",
        platformOs: "linux",
      },
    });
    return;
  }

  if (message.method === "initialized") return;

  if (message.method === "test/echo") {
    send({ id: message.id, result: message.params });
    return;
  }

  if (message.method === "test/toolRoundTrip") {
    const serverRequestId = `server-${String(message.id)}`;
    toolRequests.set(serverRequestId, { kind: "test", originalRequestId: message.id });
    send({
      id: serverRequestId,
      method: "item/tool/call",
      params: {
        callId: `call-${String(message.id)}`,
        threadId: "thread-fixture",
        turnId: "turn-fixture",
        namespace: null,
        tool: "fixture_weather",
        arguments: { city: "Shanghai" },
      },
    });
    return;
  }

  if (message.method === "model/list") {
    send({
      id: message.id,
      result: {
        data: [
          {
            id: "gpt-fixture",
            displayName: "GPT Fixture",
            hidden: false,
            defaultReasoningEffort: "medium",
            supportedReasoningEfforts: [],
            isDefault: true,
          },
        ],
      },
    });
    return;
  }

  if (message.method === "thread/start") {
    const threadId = `thread-${String(message.id)}`;
    threads.set(threadId, { dynamicTools: message.params?.dynamicTools ?? [] });
    send({ id: message.id, result: { thread: { id: threadId } } });
    return;
  }

  if (message.method === "thread/inject_items") {
    send({ id: message.id, result: {} });
    return;
  }

  if (message.method === "turn/start") {
    const threadId = message.params.threadId;
    const turnId = `turn-${String(message.id)}`;
    send({ id: message.id, result: { turn: { id: turnId, status: "inProgress" } } });
    const dynamicTools = threads.get(threadId)?.dynamicTools ?? [];
    if (dynamicTools.length > 0) {
      const serverRequestId = `openclaw-${String(message.id)}`;
      toolRequests.set(serverRequestId, { kind: "openclaw", threadId, turnId });
      setTimeout(() => {
        send({
          id: serverRequestId,
          method: "item/tool/call",
          params: {
            callId: `call-${String(message.id)}`,
            threadId,
            turnId,
            namespace: null,
            tool: dynamicTools[0].name,
            arguments: { city: "Shanghai" },
          },
        });
      }, 0);
    } else {
      setTimeout(() => completeTurn(threadId, turnId, "Fixture answer"), 0);
    }
    return;
  }

  if (message.method === "thread/delete" || message.method === "turn/interrupt") {
    send({ id: message.id, result: {} });
    return;
  }

  if (message.id !== undefined && message.method === undefined) {
    const request = toolRequests.get(message.id);
    if (request?.kind === "test") {
      toolRequests.delete(message.id);
      send({ id: request.originalRequestId, result: { toolResult: message.result } });
    } else if (request?.kind === "openclaw") {
      toolRequests.delete(message.id);
      completeTurn(request.threadId, request.turnId, "Weather is 25 C");
    }
    return;
  }

  if (message.id !== undefined) {
    send({ id: message.id, error: { code: -32601, message: "Method not found" } });
  }
});

function completeTurn(threadId, turnId, text) {
  send({
    method: "item/agentMessage/delta",
    params: { threadId, turnId, itemId: `message-${turnId}`, delta: text },
  });
  send({
    method: "thread/tokenUsage/updated",
    params: {
      threadId,
      turnId,
      tokenUsage: {
        total: { inputTokens: 12, outputTokens: 5, totalTokens: 17 },
        last: { inputTokens: 12, outputTokens: 5, totalTokens: 17 },
        modelContextWindow: 128000,
      },
    },
  });
  send({
    method: "turn/completed",
    params: {
      threadId,
      turn: { id: turnId, status: "completed", error: null },
    },
  });
}
