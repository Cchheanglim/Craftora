import { expect, test } from "bun:test";
import { fromAnthropic, fromOpenAI, toAnthropic, toOpenAI, type Request } from "../src/assistant/providers";
import type { Content } from "../src/assistant/conversation";

const tools = [{ functionDeclarations: [{ name: "split_clip", description: "Split a clip.", parameters: { type: "object", properties: { clip_id: { type: "string" } } } }] }];
const request = (contents: Content[]): Request => ({ systemInstruction: { parts: [{ text: "You edit video." }] }, contents, tools });

test("a ChatGPT tool call goes back with its id, as a tool message", () => {
  const answer = fromOpenAI({
    choices: [{ finish_reason: "tool_calls", message: { content: null, tool_calls: [{ id: "call_1", function: { name: "split_clip", arguments: '{"clip_id":"c1"}' } }] } }],
  });
  const call = answer.candidates![0].content!.parts[0].functionCall!;
  expect(call).toEqual({ id: "call_1", name: "split_clip", args: { clip_id: "c1" } });

  const body = toOpenAI("gpt-5", request([
    { role: "user", parts: [{ text: "Split it" }] },
    answer.candidates![0].content!,
    { role: "user", parts: [{ functionResponse: { id: "call_1", name: "split_clip", response: { ok: true } } }] },
  ])) as { messages: { role: string; tool_call_id?: string; tool_calls?: unknown[] }[]; tools: { type: string }[] };
  expect(body.messages.map((m) => m.role)).toEqual(["system", "user", "assistant", "tool"]);
  expect(body.messages[2].tool_calls).toHaveLength(1);
  expect(body.messages[3].tool_call_id).toBe("call_1");
  expect(body.tools[0].type).toBe("function");
});

test("Claude's turn goes back unchanged (thinking too), with tool results in one message", () => {
  const thinking = { type: "thinking", thinking: "", signature: "sig" };
  const use = { type: "tool_use", id: "toolu_1", name: "split_clip", input: { clip_id: "c1" } };
  const answer = fromAnthropic({ stop_reason: "tool_use", content: [thinking, use] });
  const parts = answer.candidates![0].content!.parts;
  expect(parts[0].thought).toBe(true);
  expect(parts[1].functionCall).toEqual({ id: "toolu_1", name: "split_clip", args: { clip_id: "c1" } });

  const body = toAnthropic("claude-opus-5", request([
    { role: "user", parts: [{ text: "Split it" }] },
    answer.candidates![0].content!,
    { role: "user", parts: [{ functionResponse: { id: "toolu_1", name: "split_clip", response: { ok: true } } }] },
  ])) as { system: string; max_tokens: number; fallbacks?: string; messages: { role: string; content: { type: string; tool_use_id?: string }[] }[]; tools: { input_schema: unknown }[] };
  expect(body.system).toBe("You edit video.");
  expect(body.max_tokens).toBeGreaterThan(0);
  expect(body.fallbacks).toBe("default");
  expect(body.messages[1].content).toEqual([thinking, use]);
  expect(body.messages[2].content[0]).toMatchObject({ type: "tool_result", tool_use_id: "toolu_1" });
  expect(body.tools[0].input_schema).toEqual(tools[0].functionDeclarations[0].parameters);
  // Older models don't take the fallback beta.
  expect((toAnthropic("claude-haiku-4-5", request([])) as { fallbacks?: string }).fallbacks).toBeUndefined();
});

test("a refusal from Claude is reported, not read as an empty answer", () => {
  expect(fromAnthropic({ stop_reason: "refusal", content: [] }).candidates![0]).toEqual({ finishReason: "refusal" });
});
