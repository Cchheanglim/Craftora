import { expect, test } from "bun:test";
import { fromAgentText, toAgentPrompt } from "../src/assistant/agentText";
import type { Request } from "../src/assistant/providers";
import type { Content, Part } from "../src/assistant/conversation";

const tools = [
  {
    functionDeclarations: [
      { name: "split_clip", description: "Split a clip.", parameters: { type: "object", properties: { clip_id: { type: "string" } } } },
      { name: "delete_clip", description: "Delete a clip.", parameters: { type: "object", properties: { clip_id: { type: "string" } } } },
    ],
  },
];
const request = (contents: Content[]): Request => ({ systemInstruction: { parts: [{ text: "You edit video." }] }, contents, tools });
const partsOf = (text: string): Part[] | undefined => fromAgentText(text).candidates![0].content?.parts;

test("the prompt has the system text, every tool, and the reply format", () => {
  const prompt = toAgentPrompt(request([{ role: "user", parts: [{ text: "Split it" }] }]));
  expect(prompt).toContain("You edit video.");
  expect(prompt).toContain("split_clip");
  expect(prompt).toContain("delete_clip");
  expect(prompt).toContain('{"say": "<words for the user, may be empty>", "calls": [{"name": "<tool name>", "args": { ... }}]}');
  expect(prompt).toContain("[User]\nSplit it");
});

test("a round trip: the agent's call goes back as [You] JSON with its tool result", () => {
  const answer = fromAgentText('{"say": "Splitting.", "calls": [{"name": "split_clip", "args": {"clip_id": "c1"}}]}');
  const content = answer.candidates![0].content!;
  expect(content.parts).toEqual([{ text: "Splitting." }, { functionCall: { id: "call_1", name: "split_clip", args: { clip_id: "c1" } } }]);

  const prompt = toAgentPrompt(request([
    { role: "user", parts: [{ text: "Split it" }] },
    { ...content, parts: [{ text: "hidden", thought: true }, ...content.parts] },
    { role: "user", parts: [{ functionResponse: { id: "call_1", name: "split_clip", response: { ok: true } } }] },
  ]));
  expect(prompt).toContain('[You]\n{"say":"Splitting.","calls":[{"name":"split_clip","args":{"clip_id":"c1"}}]}');
  expect(prompt).toContain('[Tool result: split_clip]\n{"ok":true}');
  expect(prompt).not.toContain("hidden");
});

test("fromAgentText finds the JSON bare, fenced, or after chatter", () => {
  const call = { functionCall: { id: "call_1", name: "split_clip", args: { clip_id: "c1" } } };
  const json = '{"say": "", "calls": [{"name": "split_clip", "args": {"clip_id": "c1"}}]}';
  expect(partsOf(json)).toEqual([call]);
  expect(partsOf("```json\n" + json + "\n```")).toEqual([call]);
  expect(partsOf("Sure, here you go:\n" + json)).toEqual([call]);
  expect(fromAgentText(json).candidates![0].finishReason).toBe("stop");
});

test("fromAgentText reads plain words and broken JSON as text, and empty as no content", () => {
  expect(partsOf("  All done.  ")).toEqual([{ text: "All done." }]);
  expect(partsOf('{"say": "oops", "calls": [')).toEqual([{ text: '{"say": "oops", "calls": [' }]);
  expect(partsOf('{"answer": 1}')).toEqual([{ text: '{"answer": 1}' }]);
  expect(fromAgentText("   ").candidates![0]).toEqual({ finishReason: "empty" });
  expect(partsOf('{"say": "", "calls": []}')).toEqual([{ text: "" }]);
});

test("fromAgentText ignores calls without a name and replaces non-object args with {}", () => {
  const parts = partsOf('{"say": "ok", "calls": [{"args": {"clip_id": "c1"}}, {"name": "delete_clip", "args": [1]}, {"name": "split_clip", "args": "c2"}]}');
  expect(parts).toEqual([
    { text: "ok" },
    { functionCall: { id: "call_1", name: "delete_clip", args: {} } },
    { functionCall: { id: "call_2", name: "split_clip", args: {} } },
  ]);
});
