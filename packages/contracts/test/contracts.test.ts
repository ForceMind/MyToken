import { describe, expect, it } from "vitest";

import { openAiFunctionToolSchema, toDynamicTool } from "../src/index.js";

describe("OpenAI tool contract", () => {
  it("translates a client function without carrying unsupported strict mode", () => {
    const tool = openAiFunctionToolSchema.parse({
      type: "function",
      name: "get_weather",
      description: "Get current weather",
      parameters: {
        type: "object",
        properties: { city: { type: "string" } },
        required: ["city"],
        additionalProperties: false,
      },
      strict: true,
    });

    expect(toDynamicTool(tool)).toEqual({
      type: "function",
      name: "get_weather",
      description: "Get current weather",
      inputSchema: tool.parameters,
    });
  });

  it("rejects unsafe tool names", () => {
    expect(() =>
      openAiFunctionToolSchema.parse({
        type: "function",
        name: "../../shell",
      }),
    ).toThrow();
  });
});
