import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CoordinationController, stepRequiresApproval, type BehaviorControllerPlan } from "./coordination-controller.js";

const stateDir = await mkdtemp(join(tmpdir(), "sage-coordination-test-"));
const controller = new CoordinationController(stateDir, new Set(["operator-1"]));
let preview = "a".repeat(64);

const plan: BehaviorControllerPlan = {
  version: "2",
  steps: [
    {
      id: "step-1", title: "Discover", skill_key: "discover", instruction: "inspect",
      effect: "draft", authority: "none", resume_policy: "automatic",
      idempotency_key: "coordination:{coordination_id}:discover",
      completion_evidence: ["coordination_card"],
    },
    {
      id: "step-2", title: "Chat", skill_key: "collaborate", instruction: "post",
      uses: ["step-1"], effect: "chat", authority: "lead", approval_checkpoint: true,
      resume_policy: "approval_required", expires_after: "24h",
      idempotency_key: "coordination:{coordination_id}:chat:{preview_digest}",
      completion_evidence: ["chat_message_id"],
    },
  ],
};

let card = await controller.create({
  coordination_id: "test-coordination",
  objective: "test safe coordination",
  behavior: { key: "test" },
  behavior_plan: plan,
});
assert.equal(card.steps[0].status, "ready");
assert.equal(card.steps[1].status, "pending");

card = await controller.start(card.coordination_id, "step-1");
assert.equal(card.steps[0].status, "running");
await assert.rejects(
  controller.complete(card.coordination_id, "step-1", { evidence: {} }),
  /completion_evidence_missing/,
);
card = await controller.complete(card.coordination_id, "step-1", {
  evidence: { coordination_card: "cid-1" },
  artifacts: [{ type: "coordination_card", digest: "cid-1" }],
});
assert.equal(card.current_step_id, "step-2");
assert.equal(card.steps[1].status, "awaiting_approval");
assert.equal(card.steps[1].pause_reason, "side_effect:chat");

await assert.rejects(
  controller.setPreview(card.coordination_id, "step-2", { preview_digest: "a".repeat(64) }),
  /concrete_preview_required/,
);

await assert.rejects(
  controller.approve(card.coordination_id, {
    step_id: "step-2", actor: "lead-1", authority: "lead", preview_digest: preview,
    confirmation_message_id: "missing",
  }),
  /step_preview_required/,
);
card = await controller.setPreview(card.coordination_id, "step-2", {
  preview: { message: "invite", audience: "coalition" },
  artifact: { type: "chat_preview" },
});
preview = card.steps[1].preview_digest!;
card = await controller.setPreview(card.coordination_id, "step-2", {
  preview: { audience: "coalition", message: "invite" },
});
assert.equal(card.steps[1].preview_digest, preview, "preview digest must use canonical key order");
card = await controller.recordChatIdentity(card.coordination_id, {
  channel: "telegram", conversation_id: "chat-7", message_id: "proposal-41", direction: "outbound",
});
card = (await controller.recordInboundMessage({
  channel: "telegram", conversation_id: "chat-7", message_id: "reply-42",
  sender_id: "operator-1", sender_name: "Operator", raw_wording: "Yes, use this exact preview.",
}))!;
await assert.rejects(
  controller.approve(card.coordination_id, {
    step_id: "step-2", actor: "agent-1", authority: "agent", preview_digest: preview,
    confirmation_message_id: "reply-42",
  }),
  /insufficient_authority/,
);
await assert.rejects(
  controller.approve(card.coordination_id, {
    step_id: "step-2", actor: "lead-1", authority: "lead", preview_digest: "b".repeat(64),
    confirmation_message_id: "reply-42",
  }),
  /preview_digest_mismatch/,
);
card = await controller.approve(card.coordination_id, {
  step_id: "step-2", actor: "operator-1", authority: "lead", preview_digest: preview,
  confirmation_message_id: "reply-42",
});
assert.equal(card.steps[1].status, "ready");
assert.equal(card.steps[1].authority_receipts[0].preview_digest, preview);
assert.equal(card.steps[1].authority_receipts[0].confirmation_message_id, "reply-42");
card = await controller.start(card.coordination_id, "step-2");
card = await controller.complete(card.coordination_id, "step-2", {
  evidence: { chat_message_id: "tg-42" },
  chat_identities: [{ channel: "telegram", message_id: "42" }],
  verification_results: [{ ok: true, check: "telegram_delivery" }],
});
assert.equal(card.state, "completed");
assert.ok(card.chat_identities.some((identity) => identity.message_id === "42"));

const persisted = JSON.parse(await readFile(join(stateDir, "cards", "test-coordination.json"), "utf8"));
assert.equal(persisted.state, "completed");
assert.equal(persisted.authority_receipts.length, 1);
assert.equal(persisted.events[1].previous_digest, persisted.events[0].digest);

assert.deepEqual(stepRequiresApproval({
  id: "legacy", title: "Legacy", skill_key: "legacy", instruction: "legacy",
}), { required: true, reason: "unannotated_effect" });

let retryCard = await controller.create({
  coordination_id: "retry-draft",
  objective: "retry a draft safely",
  behavior: { key: "retry" },
  behavior_plan: {
    version: "2",
    steps: [{
      id: "step-1", title: "Draft", skill_key: "draft", instruction: "draft",
      effect: "draft", authority: "agent", resume_policy: "automatic",
    }],
  },
});
retryCard = await controller.start(retryCard.coordination_id, "step-1");
retryCard = await controller.fail(retryCard.coordination_id, "step-1", "transient model failure");
retryCard = await controller.retry(retryCard.coordination_id, "step-1");
assert.equal(retryCard.steps[0].status, "ready");
assert.equal(retryCard.steps[0].attempts, 1);

let expiryCard = await controller.create({
  coordination_id: "expiry-check",
  objective: "expire an exact preview",
  behavior: { key: "expiry" },
  behavior_plan: {
    version: "2",
    steps: [{
      id: "step-1", title: "Write", skill_key: "write", instruction: "write",
      effect: "private_write", authority: "operator", expires_after: "1s",
    }],
  },
});
expiryCard = await controller.setPreview(expiryCard.coordination_id, "step-1", {
  preview: { exact: "artifact" },
});
expiryCard = await controller.recordChatIdentity(expiryCard.coordination_id, {
  channel: "telegram", conversation_id: "expiry-chat", message_id: "proposal-expiry",
});
expiryCard = (await controller.recordInboundMessage({
  channel: "telegram", conversation_id: "expiry-chat", message_id: "confirm-expiry",
  sender_id: "operator-1", raw_wording: "I confirm this exact preview.",
}))!;
expiryCard = await controller.approve(expiryCard.coordination_id, {
  step_id: "step-1", actor: "operator-1", authority: "operator",
  preview_digest: expiryCard.steps[0].preview_digest!, confirmation_message_id: "confirm-expiry",
});
await new Promise((resolve) => setTimeout(resolve, 1_050));
await assert.rejects(
  controller.start(expiryCard.coordination_id, "step-1"),
  /authority_receipt_expired/,
);
expiryCard = await controller.get(expiryCard.coordination_id);
assert.equal(expiryCard.steps[0].status, "expired");

const noAuthorityDir = await mkdtemp(join(tmpdir(), "sage-coordination-no-authority-"));
const noAuthorityController = new CoordinationController(noAuthorityDir);
let noAuthorityCard = await noAuthorityController.create({
  coordination_id: "missing-authority-floor",
  objective: "prove an unannotated authority cannot approve chat",
  behavior: { key: "authority-floor" },
  behavior_plan: {
    version: "2",
    steps: [{
      id: "step-1", title: "Chat", skill_key: "chat", instruction: "post",
      effect: "chat",
    }],
  },
});
noAuthorityCard = await noAuthorityController.setPreview(noAuthorityCard.coordination_id, "step-1", {
  preview: { message: "coalition invitation" },
});
noAuthorityCard = await noAuthorityController.recordChatIdentity(noAuthorityCard.coordination_id, {
  channel: "telegram", conversation_id: "untrusted-chat", message_id: "proposal-untrusted",
});
await noAuthorityController.recordInboundMessage({
  channel: "telegram", conversation_id: "untrusted-chat", message_id: "reply-untrusted",
  sender_id: "outsider", raw_wording: "I approve",
});
await assert.rejects(
  noAuthorityController.approve(noAuthorityCard.coordination_id, {
    step_id: "step-1", actor: "outsider", authority: "none",
    preview_digest: noAuthorityCard.steps[0].preview_digest!,
    confirmation_message_id: "reply-untrusted",
  }),
  /confirmation_sender_not_authorized/,
);

console.log("coordination-controller tests passed");
