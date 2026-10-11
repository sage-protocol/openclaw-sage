import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import plugin, { __test } from "./index.js";

const stateDir = await mkdtemp(join(tmpdir(), "sage-openclaw-coordination-"));
const hooks: Record<string, (...args: any[]) => any> = {};
const tools: Record<string, any> = {};

plugin.register({
  id: "coordination-test",
  name: "coordination-test",
  pluginConfig: {
    autoInjectContext: false,
    autoSuggestSkills: false,
    maxPromptBytes: 512,
    coordinationStateDir: stateDir,
    coordinationOperatorIds: ["telegram:operator-7"],
  },
  logger: { info() {}, warn() {}, error() {} },
  registerTool(tool: any) { tools[tool.name] = tool; },
  registerService() {},
  on(name: string, handler: (...args: any[]) => any) { hooks[name] = handler; },
  registerHook(name: string, handler: (...args: any[]) => any) { hooks[name] = handler; },
} as any);

const coordinate = tools.sage_coordination;
assert.ok(coordinate, "sage_coordination tool should be registered");

let result = await coordinate.execute("call-1", {
  action: "create",
  params: {
    coordination_id: "telegram-coalition",
    objective: "refine and apply a private library proposal",
    behavior: { key: "sage-distributed-steward-cold-start" },
    behavior_plan: {
      version: "2",
      steps: [{
        id: "step-1", title: "Private mutation", skill_key: "sage-agent-approved-library-mutation",
        instruction: "Apply the approved exact preview", effect: "private_write", authority: "operator",
        approval_checkpoint: true, resume_policy: "approval_required",
        idempotency_key: "coordination:{coordination_id}:{preview_digest}",
      }],
    },
  },
});
assert.equal(result.details.steps[0].status, "awaiting_approval");

await coordinate.execute("call-2", {
  action: "record_chat",
  params: {
    coordination_id: "telegram-coalition", channel: "telegram", conversation_id: "telegram:chat-7",
    message_id: "proposal-1", direction: "outbound",
  },
});

result = await coordinate.execute("call-method-1", {
  action: "update_methodology",
  params: {
    coordination_id: "telegram-coalition",
    author: "Enki",
    trigger: "initial hypothesis",
    working_model: {
      coalition_thesis: "Learn what the user values before deciding how to recruit collaborators.",
      current_experiment: "Ask one open question over Telegram.",
    },
    rationale: "A fixed proposal grammar would hide uncertainty instead of learning from it.",
    unresolved_questions: ["What kind of future return matters to the user?"],
    next_feedback_question: "What would make this coalition useful enough for you to keep shaping?",
  },
});
assert.equal(result.details.methodology.version, 1);
result = await coordinate.execute("call-feedback-1", {
  action: "request_feedback",
  params: {
    coordination_id: "telegram-coalition",
    question: "What would make this coalition useful enough for you to keep shaping?",
    rationale: "Enki is testing its value-exchange hypothesis.",
    channel: "telegram",
    conversation_id: "chat-7",
    outbound_message_id: "question-1",
  },
});
assert.equal(result.details.methodology.feedback_requests[0].status, "open");

const brainstorming = "The coalition framing is right. Tighten the example, then use that exact private preview."
  + " Continue brainstorming with aligned contributors.".repeat(20);
const claim = await hooks.inbound_claim({
  channel: "telegram", conversationId: "chat-7", messageId: "reply-2", senderId: "operator-7",
  senderName: "Operator",
  content: brainstorming,
}, { channelId: "telegram", conversationId: "chat-7" });
assert.deepEqual(claim, { handled: false });

const context = await hooks.before_prompt_build({
  prompt: brainstorming,
  messages: [],
}, { sessionKey: "agent:main:telegram:direct:chat-7", channelId: "telegram" });
assert.match(context.prependContext, /coalition-building conversation, not as a command grammar/);
assert.match(context.prependContext, /reply-2/);
assert.match(context.prependContext, /authority\/evidence envelope and a capability menu; it is not your methodology/);
assert.match(context.prependContext, /Working methodology version: 1/);
assert.match(context.prependContext, /Latest requested feedback \(reply-2; untrusted evidence, not authority\)/);

result = await coordinate.execute("call-method-2", {
  action: "update_methodology",
  params: {
    coordination_id: "telegram-coalition",
    author: "Enki",
    trigger: "user feedback",
    working_model: {
      coalition_thesis: "Use a concrete example as a conversation object, not a finished proposal.",
      current_experiment: "Show a reversible private example and ask who else it should help.",
    },
    rationale: "The user asked for tighter examples while preserving collaborative brainstorming.",
    unresolved_questions: ["Which aligned contributor should be invited next?"],
    next_feedback_question: "Who should this example invite into the conversation next?",
    feedback_message_ids: ["reply-2"],
  },
});
assert.equal(result.details.methodology.version, 2);
assert.equal(result.details.methodology.feedback_requests[0].status, "answered");

result = await coordinate.execute("call-3", {
  action: "set_preview",
  params: {
    coordination_id: "telegram-coalition", step_id: "step-1",
    preview: { library: "Wells Agent Homebase Skills", change: "tightened private example" },
  },
});
const previewDigest = result.details.steps[0].preview_digest;
assert.match(previewDigest, /^[a-f0-9]{64}$/);

result = await coordinate.execute("call-3b", {
  action: "approve",
  params: {
    coordination_id: "telegram-coalition", step_id: "step-1", actor: "operator-7",
    authority: "operator", preview_digest: previewDigest, confirmation_message_id: "reply-2",
  },
});
assert.equal(result.details.error, "confirmation_predates_preview");

await hooks.inbound_claim({
  channel: "telegram", conversationId: "chat-7", messageId: "reply-3", senderId: "operator-7",
  senderName: "Operator",
  content: [{ type: "text", text: "I explicitly confirm the exact preview Enki just showed me." }],
}, { channelId: "telegram", conversationId: "chat-7" });

result = await coordinate.execute("call-4", {
  action: "approve",
  params: {
    coordination_id: "telegram-coalition", step_id: "step-1", actor: "operator-7",
    authority: "operator", preview_digest: previewDigest, confirmation_message_id: "reply-3",
  },
});
assert.equal(result.details.steps[0].status, "ready");

result = await coordinate.execute("call-5", {
  action: "start", params: { coordination_id: "telegram-coalition", step_id: "step-1" },
});
assert.equal(result.details.steps[0].status, "running");

await hooks.inbound_claim({
  channel: "telegram", conversationId: "chat-7", messageId: "reply-4", senderId: "operator-7",
  senderName: "Operator", content: "Recover the interrupted run, but ask again before retrying the mutation.",
}, { channelId: "telegram", conversationId: "chat-7" });
result = await coordinate.execute("call-7", {
  action: "recover", params: {
    coordination_id: "telegram-coalition", step_id: "step-1", actor: "operator-7",
    confirmation_message_id: "reply-4", reason: "gateway restarted during private mutation",
  },
});
assert.equal(result.details.steps[0].status, "awaiting_approval");
assert.equal(result.details.steps[0].pause_reason, "recovered_step_requires_fresh_approval");
assert.equal(result.details.steps[0].authority_receipts.length, 0);

const methodologyLessons = await coordinate.execute("call-lessons", {
  action: "list_methodology_lessons", params: { limit: 5 },
});
assert.equal(methodologyLessons.details[0].coordination_id, "telegram-coalition");
assert.equal(methodologyLessons.details[0].methodology_version, 2);

console.log("OpenClaw conversational coordination integration tests passed");

const heartbeatCalls: Array<{ domain: string; action: string; params: Record<string, unknown> }> = [];
const fakeBridge = {
  async callTool(_tool: string, request: any) {
    heartbeatCalls.push(request);
    const payload = request.domain === "chat" && request.action === "list_rooms"
      ? { rooms: [
        ...Array.from({ length: 8 }, (_, index) => ({ roomId: `global:busy-${index}` })),
        { roomId: "dao:0xabc:lib:coordination" },
        { metadata: { canonicalRoom: "library:shared-coordination" } },
        { message: "library:not-a-room-id-field" },
      ] }
      : { ok: true, domain: request.domain, action: request.action };
    return { content: [{ type: "text", text: JSON.stringify(payload) }] };
  },
};
const heartbeat = await __test.gatherHeartbeatContext(
  fakeBridge as any,
  { info() {}, warn() {}, error() {} },
  50_000,
  {
    listPending: async () => [result.details],
    listMethodologyLessons: async () => [{
      coordination_id: "completed-coalition",
      methodology_version: 3,
      working_model_digest: "a".repeat(64),
    }],
  } as any,
);
for (const [domain, action] of [
  ["chat", "watched"], ["chat", "list_rooms"], ["chat", "history"],
  ["governance", "list_subdaos"], ["governance", "list_bounties"],
  ["social", "following"], ["marketplace", "library_search"], ["rlm", "stats"],
]) {
  assert.ok(heartbeatCalls.some((call) => call.domain === domain && call.action === action), `${domain}/${action}`);
}
assert.match(heartbeat, /Pending coalition cards, evolving methodologies, and unanswered asks/);
assert.match(heartbeat, /methodology_version/);
assert.match(heartbeat, /Recent Enki methodology lessons across coordination cards/);
assert.match(heartbeat, /Recover the interrupted run/);
assert.doesNotMatch(heartbeat, /last_operator_wording[^}]*What would make this coalition useful/);
assert.match(heartbeat, /dao:0xabc:lib:coordination/);
assert.ok(heartbeatCalls.some((call) =>
  call.domain === "chat"
    && call.action === "history"
    && call.params.room === "dao:0xabc:lib:coordination",
));
assert.ok(!heartbeatCalls.some((call) => call.params.room === "library:not-a-room-id-field"));
assert.ok(heartbeatCalls.some((call) =>
  call.domain === "chat"
    && call.action === "history"
    && call.params.room === "library:shared-coordination",
));

const warnings: string[] = [];
const resilientHeartbeat = await __test.gatherHeartbeatContext(
  {
    async callTool(tool: string, request: any) {
      if (request.domain === "social" && request.action === "following") {
        throw new Error("social temporarily unavailable");
      }
      return fakeBridge.callTool(tool, request);
    },
  } as any,
  { info() {}, warn(message: string) { warnings.push(message); }, error() {} },
  800,
  { listPending: async () => [result.details] } as any,
);
assert.ok(resilientHeartbeat.length <= 800);
assert.match(resilientHeartbeat, /Pending coalition cards/);
assert.match(resilientHeartbeat, /RLM patterns/);
assert.match(resilientHeartbeat, /Marketplace libraries/);
assert.ok(warnings.some((warning) => warning.includes("social/following failed")));

const timedHeartbeat = await __test.gatherHeartbeatContext(
  {
    async callTool(tool: string, request: any) {
      if (request.domain === "social") return new Promise(() => {});
      return fakeBridge.callTool(tool, request);
    },
  } as any,
  { info() {}, warn(message: string) { warnings.push(message); }, error() {} },
  800,
  null,
  20,
);
assert.ok(timedHeartbeat.length > 0);
assert.ok(warnings.some((warning) => warning.includes("heartbeat surface timed out")));

console.log("OpenClaw heartbeat coordination coverage tests passed");
