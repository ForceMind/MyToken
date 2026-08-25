import { describe, expect, it } from "vitest";

import {
  chatCompletionRequestSchema,
  chatCompletionToResponse,
  createGatewayResponse,
  createResponseRequestSchema,
  responseToChatCompletion,
} from "../src/index.js";

describe("Responses compatibility contract", () => {
  it("accepts an OpenClaw function tool and tool output", () => {
    const request = createResponseRequestSchema.parse({
      model: "gpt-test",
      input: [
        { role: "user", content: "What is the weather?" },
        { type: "function_call_output", call_id: "call-1", output: "25 C" },
      ],
      tools: [
        {
          type: "function",
          name: "weather",
          description: "Get weather",
          parameters: {
            type: "object",
            properties: { city: { type: "string" } },
            required: ["city"],
          },
        },
      ],
      tool_choice: "auto",
      parallel_tool_calls: true,
    });

    expect(request.tools?.[0]?.name).toBe("weather");
  });

  it("does not fake token usage", () => {
    const response = createGatewayResponse({
      id: "resp_myt_test",
      model: "gpt-test",
      output: [
        {
          type: "message",
          id: "msg-test",
          role: "assistant",
          status: "completed",
          content: [{ type: "output_text", text: "Hello", annotations: [] }],
        },
      ],
      createdAt: 1_000,
    });

    expect(response.output_text).toBe("Hello");
    expect(response.usage).toBeNull();
  });

  it("maps the text-only Chat Completions subset without inventing usage", () => {
    const request = chatCompletionRequestSchema.parse({
      model: "gpt-test",
      messages: [
        { role: "system", content: "Be concise" },
        { role: "user", content: "Hello" },
      ],
      stream: false,
    });
    expect(chatCompletionToResponse(request).input).toHaveLength(2);
    const completion = responseToChatCompletion(
      createGatewayResponse({
        id: "resp_myt_chat",
        model: "gpt-test",
        output: [
          {
            type: "message",
            id: "msg-chat",
            role: "assistant",
            status: "completed",
            content: [{ type: "output_text", text: "Hi", annotations: [] }],
          },
        ],
      }),
    );
    expect(completion).toMatchObject({
      object: "chat.completion",
      choices: [{ message: { content: "Hi" }, finish_reason: "stop" }],
      usage: null,
    });
  });
});
