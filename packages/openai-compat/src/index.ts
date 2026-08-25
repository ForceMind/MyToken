import { z } from "zod";

import { openAiFunctionToolSchema } from "@mytoken/contracts";

const inputTextSchema = z.object({ type: z.literal("input_text"), text: z.string() }).strict();
const outputTextSchema = z.object({ type: z.literal("output_text"), text: z.string() }).strict();

const messageSchema = z
  .object({
    type: z.literal("message").optional(),
    role: z.enum(["system", "developer", "user", "assistant"]),
    content: z.union([z.string(), z.array(z.union([inputTextSchema, outputTextSchema])).max(128)]),
  })
  .strict();

const functionCallSchema = z
  .object({
    type: z.literal("function_call"),
    id: z.string().optional(),
    call_id: z.string().min(1).max(256),
    name: z.string().min(1).max(64),
    arguments: z.string().max(1024 * 1024),
  })
  .strict();

export const functionCallOutputSchema = z
  .object({
    type: z.literal("function_call_output"),
    call_id: z.string().min(1).max(256),
    output: z.string().max(1024 * 1024),
  })
  .strict();

export const responsesInputItemSchema = z.union([
  messageSchema,
  functionCallSchema,
  functionCallOutputSchema,
]);

const toolChoiceSchema = z.union([
  z.enum(["auto", "none", "required"]),
  z.object({ type: z.literal("function"), name: z.string().min(1).max(64) }).strict(),
]);

export const createResponseRequestSchema = z
  .object({
    model: z.string().min(1).max(256),
    input: z.union([z.string().max(200_000), z.array(responsesInputItemSchema).max(512)]),
    instructions: z.string().max(20_000).optional(),
    tools: z.array(openAiFunctionToolSchema).max(64).optional(),
    tool_choice: toolChoiceSchema.optional(),
    parallel_tool_calls: z.boolean().optional(),
    stream: z.boolean().optional(),
    store: z.boolean().optional(),
    previous_response_id: z.string().min(1).max(256).optional(),
    reasoning: z
      .object({ effort: z.string().min(1).max(32).optional() })
      .strict()
      .optional(),
    max_output_tokens: z.number().int().positive().max(128_000).optional(),
    metadata: z.record(z.string().max(64), z.string().max(512)).optional(),
  })
  .strict();

export type CreateResponseRequest = z.infer<typeof createResponseRequestSchema>;

export interface ResponseFunctionCallItem {
  type: "function_call";
  id: string;
  call_id: string;
  name: string;
  arguments: string;
  status: "completed";
}

export interface ResponseMessageItem {
  type: "message";
  id: string;
  role: "assistant";
  status: "completed";
  content: Array<{ type: "output_text"; text: string; annotations: [] }>;
}

export type ResponseOutputItem = ResponseFunctionCallItem | ResponseMessageItem;

export interface GatewayResponse {
  id: string;
  object: "response";
  created_at: number;
  status: "completed" | "failed" | "incomplete";
  model: string;
  output: ResponseOutputItem[];
  output_text: string;
  error: null | { message: string; type: string; code: string; param: string | null };
  usage: null | { input_tokens: number; output_tokens: number; total_tokens: number };
  metadata: Record<string, string>;
}

export function createGatewayResponse(options: {
  id: string;
  model: string;
  output: ResponseOutputItem[];
  createdAt?: number;
  metadata?: Record<string, string>;
  usage?: GatewayResponse["usage"];
}): GatewayResponse {
  const outputText = options.output
    .filter((item): item is ResponseMessageItem => item.type === "message")
    .flatMap((item) => item.content)
    .map((content) => content.text)
    .join("");

  return {
    id: options.id,
    object: "response",
    created_at: Math.floor((options.createdAt ?? Date.now()) / 1000),
    status: "completed",
    model: options.model,
    output: options.output,
    output_text: outputText,
    error: null,
    usage: options.usage ?? null,
    metadata: options.metadata ?? {},
  };
}

export function openAiError(
  message: string,
  code: string,
  type = "invalid_request_error",
  param: string | null = null,
): { error: { message: string; type: string; param: string | null; code: string } } {
  return { error: { message, type, param, code } };
}
