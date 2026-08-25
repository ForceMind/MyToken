import { z } from "zod";

export const jsonRpcIdSchema = z.union([z.string(), z.number().int()]);
export type JsonRpcId = z.infer<typeof jsonRpcIdSchema>;

export const openAiFunctionToolSchema = z
  .object({
    type: z.literal("function"),
    name: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
    description: z.string().max(4096).optional(),
    parameters: z.record(z.string(), z.unknown()).optional(),
    strict: z.boolean().optional(),
  })
  .strict();

export type OpenAiFunctionTool = z.infer<typeof openAiFunctionToolSchema>;

export const dynamicToolSpecSchema = z
  .object({
    type: z.literal("function"),
    name: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
    description: z.string().max(4096),
    inputSchema: z.unknown(),
    deferLoading: z.boolean().optional(),
  })
  .strict();

export type DynamicToolSpec = z.infer<typeof dynamicToolSpecSchema>;

export const dynamicToolCallParamsSchema = z
  .object({
    callId: z.string().min(1).max(256),
    threadId: z.string().min(1).max(256),
    turnId: z.string().min(1).max(256),
    namespace: z.string().max(64).nullable().optional(),
    tool: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
    arguments: z.unknown(),
  })
  .strict();

export type DynamicToolCallParams = z.infer<typeof dynamicToolCallParamsSchema>;

export const dynamicToolCallResponseSchema = z
  .object({
    success: z.boolean(),
    contentItems: z.array(
      z.discriminatedUnion("type", [
        z.object({ type: z.literal("inputText"), text: z.string() }).strict(),
        z.object({ type: z.literal("inputImage"), imageUrl: z.string() }).strict(),
        z.object({ type: z.literal("inputAudio"), audioUrl: z.string() }).strict(),
      ]),
    ),
  })
  .strict();

export type DynamicToolCallResponse = z.infer<typeof dynamicToolCallResponseSchema>;

export const workerStateSchema = z.enum([
  "stopped",
  "starting",
  "ready",
  "degraded",
  "restarting",
  "unsupported_version",
  "auth_required",
]);

export type WorkerState = z.infer<typeof workerStateSchema>;

export function toDynamicTool(tool: OpenAiFunctionTool): DynamicToolSpec {
  return {
    type: "function",
    name: tool.name,
    description: tool.description ?? "Client-provided function tool",
    inputSchema: tool.parameters ?? { type: "object", properties: {} },
  };
}
