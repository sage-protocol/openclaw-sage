import { createHash, randomUUID } from "node:crypto";
import { link, mkdir, open, readFile, readdir, rename, unlink } from "node:fs/promises";
import { join } from "node:path";

export type PlanEffect =
  | "read" | "draft" | "chat" | "private_write" | "public_write" | "payment" | "governance";
export type PlanAuthority = "none" | "agent" | "lead" | "operator" | "dao";
export type ResumePolicy = "automatic" | "approval_required";

export type BehaviorPlanStep = {
  id: string;
  title: string;
  skill_key: string;
  instruction: string;
  uses?: string[];
  produces?: string[];
  effect?: PlanEffect;
  authority?: PlanAuthority;
  idempotency_key?: string;
  completion_evidence?: string[];
  approval_checkpoint?: boolean;
  resume_policy?: ResumePolicy;
  expires_after?: string;
  requires_checkpoint?: boolean;
};

export type BehaviorControllerPlan = {
  version: string;
  inputs?: Array<{ name: string; description?: string; required?: boolean }>;
  steps: BehaviorPlanStep[];
};

export type StepStatus =
  | "pending" | "ready" | "awaiting_approval" | "running" | "completed" | "failed" | "expired";

export type AuthorityReceipt = {
  receipt_id: string;
  step_id: string;
  actor: string;
  authority: PlanAuthority;
  step_digest: string;
  preview_digest: string;
  confirmation_message_id: string;
  granted_at: string;
  expires_at: string | null;
};

export type CoordinationStepState = {
  step: BehaviorPlanStep;
  status: StepStatus;
  step_digest: string;
  preview_digest: string | null;
  preview_preserved_at: string | null;
  idempotency_key: string | null;
  pause_reason: string | null;
  started_at: string | null;
  completed_at: string | null;
  attempts: number;
  artifacts: Array<Record<string, unknown>>;
  chat_identities: Array<Record<string, unknown>>;
  authority_receipts: AuthorityReceipt[];
  verification_results: Array<Record<string, unknown>>;
  evidence: Record<string, unknown>;
  error: string | null;
};

export type CoordinationCard = {
  schema_version: 1;
  coordination_id: string;
  objective: string;
  behavior: Record<string, unknown>;
  state: "active" | "awaiting_approval" | "completed" | "failed";
  created_at: string;
  updated_at: string;
  current_step_id: string | null;
  steps: CoordinationStepState[];
  produced_artifacts: Array<Record<string, unknown>>;
  chat_identities: Array<Record<string, unknown>>;
  authority_receipts: AuthorityReceipt[];
  verification_results: Array<Record<string, unknown>>;
  reward_governance_outcomes: Array<Record<string, unknown>>;
  event_chain_anchor: string | null;
  conversation_messages: Array<{
    channel: string;
    conversation_id: string;
    message_id: string;
    sender_id: string;
    sender_name: string | null;
    raw_wording: string;
    direction: "inbound" | "outbound";
    received_at: string;
    permitted_authority: PlanAuthority;
  }>;
  events: Array<{
    at: string;
    type: string;
    step_id?: string;
    previous_digest: string | null;
    digest: string;
  }>;
};

const SIDE_EFFECTS = new Set<PlanEffect>([
  "chat", "private_write", "public_write", "payment", "governance",
]);
const EFFECTS = new Set<PlanEffect>([
  "read", "draft", "chat", "private_write", "public_write", "payment", "governance",
]);
const AUTHORITIES = new Set<PlanAuthority>(["none", "agent", "lead", "operator", "dao"]);
const RESUME_POLICIES = new Set<ResumePolicy>(["automatic", "approval_required"]);

function digest(value: unknown): string {
  const canonicalize = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(canonicalize);
    if (input && typeof input === "object") {
      return Object.fromEntries(Object.entries(input as Record<string, unknown>)
        .filter(([, child]) => child !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalize(child)]));
    }
    return input;
  };
  return createHash("sha256").update(JSON.stringify(canonicalize(value)), "utf8").digest("hex");
}

function nowIso(): string { return new Date().toISOString(); }

function normalizeConversationId(channel: string, value: string): string {
  const trimmed = value.trim();
  const prefix = `${channel.toLowerCase()}:`;
  return trimmed.toLowerCase().startsWith(prefix) ? trimmed.slice(prefix.length) : trimmed;
}

function validateId(value: string, label: string): string {
  const normalized = value.trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(normalized)) {
    throw new Error(`invalid_${label}`);
  }
  return normalized;
}

function parseExpiry(duration: string | undefined, from = Date.now()): string | null {
  if (!duration) return null;
  const match = duration.trim().match(/^(\d+)(s|m|h|d|w)$/);
  if (!match) throw new Error("invalid_expires_after");
  const amount = Number(match[1]);
  const unit = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 }[match[2]]!;
  const millis = amount * unit;
  if (!Number.isSafeInteger(millis) || millis <= 0 || millis > 365 * 86_400_000) {
    throw new Error("invalid_expires_after");
  }
  return new Date(from + millis).toISOString();
}

function validateStep(step: BehaviorPlanStep): void {
  validateId(step.id, "step_id");
  if (!step.skill_key?.trim()) throw new Error(`missing_skill_key:${step.id}`);
  if (step.effect && !EFFECTS.has(step.effect)) throw new Error(`invalid_effect:${step.id}`);
  if (step.authority && !AUTHORITIES.has(step.authority)) throw new Error(`invalid_authority:${step.id}`);
  if (step.resume_policy && !RESUME_POLICIES.has(step.resume_policy)) {
    throw new Error(`invalid_resume_policy:${step.id}`);
  }
  if (step.expires_after) parseExpiry(step.expires_after);
}

export function stepRequiresApproval(step: BehaviorPlanStep): { required: boolean; reason: string | null } {
  // Unannotated legacy plans remain readable, but execution fails closed.
  if (!step.effect) return { required: true, reason: "unannotated_effect" };
  if (step.requires_checkpoint === true) return { required: true, reason: "requires_checkpoint" };
  if (SIDE_EFFECTS.has(step.effect)) return { required: true, reason: `side_effect:${step.effect}` };
  if (step.approval_checkpoint === true) return { required: true, reason: "approval_checkpoint" };
  if (step.resume_policy === "approval_required") return { required: true, reason: "approval_required" };
  if (step.authority && !["none", "agent"].includes(step.authority)) {
    return { required: true, reason: `authority:${step.authority}` };
  }
  return { required: false, reason: null };
}

function authoritySatisfies(granted: PlanAuthority, required: PlanAuthority | undefined): boolean {
  if (!required || required === "none") return true;
  if (required === "dao") return granted === "dao";
  if (required === "operator") return granted === "operator";
  if (required === "lead") return granted === "lead" || granted === "operator";
  return granted !== "none";
}

function materializeIdempotencyKey(template: string | undefined, vars: Record<string, string>): string | null {
  if (!template) return null;
  const value = template.replace(/\{([a-zA-Z0-9_]+)\}/g, (_all, key: string) => vars[key] ?? `{${key}}`);
  if (/\{[a-zA-Z0-9_]+\}/.test(value)) return null;
  return value;
}

export class CoordinationController {
  private readonly cardsDir: string;
  private readonly queues = new Map<string, Promise<unknown>>();

  constructor(
    stateDir: string,
    private readonly operatorIds: ReadonlySet<string> = new Set(),
    private readonly diagnostic: (message: string) => void = () => undefined,
  ) {
    this.cardsDir = join(stateDir, "cards");
  }

  private cardPath(id: string): string { return join(this.cardsDir, `${validateId(id, "coordination_id")}.json`); }

  private async serialize<T>(id: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(id) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(operation);
    this.queues.set(id, current);
    try { return await current; } finally { if (this.queues.get(id) === current) this.queues.delete(id); }
  }

  async create(input: {
    coordination_id?: string;
    objective: string;
    behavior: Record<string, unknown>;
    behavior_plan: BehaviorControllerPlan;
    variables?: Record<string, string>;
  }): Promise<CoordinationCard> {
    const id = validateId(input.coordination_id || `coord-${randomUUID()}`, "coordination_id");
    if (!input.objective?.trim()) throw new Error("objective_required");
    if (!input.behavior_plan || !Array.isArray(input.behavior_plan.steps) || !input.behavior_plan.steps.length) {
      throw new Error("behavior_plan_steps_required");
    }
    const ids = new Set<string>();
    for (const step of input.behavior_plan.steps) {
      validateStep(step);
      if (ids.has(step.id)) throw new Error(`duplicate_step_id:${step.id}`);
      for (const dependency of step.uses ?? []) {
        if (!ids.has(dependency)) throw new Error(`unknown_or_forward_dependency:${step.id}:${dependency}`);
      }
      ids.add(step.id);
    }

    return this.serialize(id, async () => {
      await mkdir(this.cardsDir, { recursive: true, mode: 0o700 });
      try { await this.get(id); throw new Error("coordination_already_exists"); }
      catch (error) { if ((error as Error).message !== "coordination_not_found") throw error; }

      const createdAt = nowIso();
      const variables = { coordination_id: id, ...(input.variables ?? {}) };
      const steps: CoordinationStepState[] = input.behavior_plan.steps.map((step, index) => {
        const approval = stepRequiresApproval(step);
        const ready = index === 0;
        return {
          step,
          status: ready ? (approval.required ? "awaiting_approval" : "ready") : "pending",
          step_digest: digest(step),
          preview_digest: null,
          preview_preserved_at: null,
          idempotency_key: materializeIdempotencyKey(step.idempotency_key, variables),
          pause_reason: ready ? approval.reason : null,
          started_at: null,
          completed_at: null,
          attempts: 0,
          artifacts: [],
          chat_identities: [],
          authority_receipts: [],
          verification_results: [],
          evidence: {},
          error: null,
        };
      });
      const card: CoordinationCard = {
        schema_version: 1,
        coordination_id: id,
        objective: input.objective.trim(),
        behavior: { ...input.behavior, plan_version: input.behavior_plan.version },
        state: steps[0].status === "awaiting_approval" ? "awaiting_approval" : "active",
        created_at: createdAt,
        updated_at: createdAt,
        current_step_id: steps[0].step.id,
        steps,
        produced_artifacts: [],
        chat_identities: [],
        authority_receipts: [],
        verification_results: [],
        reward_governance_outcomes: [],
        event_chain_anchor: null,
        conversation_messages: [],
        events: [],
      };
      this.event(card, "coordination_created", steps[0].step.id);
      await this.write(card, true);
      return card;
    });
  }

  async get(id: string): Promise<CoordinationCard> {
    try {
      const raw = await readFile(this.cardPath(id), "utf8");
      const card = JSON.parse(raw) as CoordinationCard;
      if (card?.schema_version !== 1 || card.coordination_id !== validateId(id, "coordination_id")) {
        throw new Error("invalid_coordination_card");
      }
      card.conversation_messages ??= [];
      card.event_chain_anchor ??= null;
      for (const state of card.steps) state.preview_preserved_at ??= null;
      return card;
    } catch (error: any) {
      if (error?.code === "ENOENT") throw new Error("coordination_not_found");
      throw error;
    }
  }

  async approve(id: string, input: {
    step_id: string; actor: string; authority: PlanAuthority; preview_digest: string;
    confirmation_message_id: string;
  }): Promise<CoordinationCard> {
    return this.serialize(id, async () => {
      const card = await this.get(id);
      const state = this.step(card, input.step_id);
      if (state.status !== "awaiting_approval") throw new Error("step_not_awaiting_approval");
      if (!input.actor?.trim()) throw new Error("approval_actor_required");
      if (!input.preview_digest?.trim()) throw new Error("preview_digest_required");
      if (!state.preview_digest) throw new Error("step_preview_required");
      const approvedPreviewDigest = input.preview_digest.trim().toLowerCase();
      if (approvedPreviewDigest !== state.preview_digest) throw new Error("preview_digest_mismatch");
      if (state.step.expires_after && state.preview_preserved_at) {
        const expiry = parseExpiry(state.step.expires_after, Date.parse(state.preview_preserved_at));
        if (expiry && Date.parse(expiry) <= Date.now()) {
          state.status = "expired";
          state.pause_reason = "preview_expired";
          card.state = "awaiting_approval";
          this.event(card, "preview_expired", state.step.id);
          await this.write(card);
          throw new Error("preview_expired");
        }
      }
      const confirmation = card.conversation_messages.find((message) =>
        message.direction === "inbound" && message.message_id === input.confirmation_message_id,
      );
      if (!confirmation) throw new Error("confirmation_message_required");
      if (state.preview_preserved_at
        && Date.parse(confirmation.received_at) < Date.parse(state.preview_preserved_at)) {
        throw new Error("confirmation_predates_preview");
      }
      const requiredAuthority = state.step.authority
        ?? (stepRequiresApproval(state.step).required ? "operator" : "none");
      if (confirmation.permitted_authority === "none"
        || !authoritySatisfies(confirmation.permitted_authority, requiredAuthority)) {
        throw new Error("confirmation_sender_not_authorized");
      }
      if (!authoritySatisfies(input.authority, requiredAuthority)) throw new Error("insufficient_authority");
      if (!authoritySatisfies(confirmation.permitted_authority, input.authority)) {
        throw new Error("claimed_authority_exceeds_sender");
      }
      if (input.actor.trim() !== confirmation.sender_id) throw new Error("approval_actor_mismatch");
      const receiptExpiry = state.step.expires_after && state.preview_preserved_at
        ? parseExpiry(state.step.expires_after, Date.parse(state.preview_preserved_at))
        : null;
      const receipt: AuthorityReceipt = {
        receipt_id: randomUUID(),
        step_id: state.step.id,
        actor: input.actor.trim(),
        authority: input.authority,
        step_digest: state.step_digest,
        preview_digest: approvedPreviewDigest,
        confirmation_message_id: input.confirmation_message_id,
        granted_at: nowIso(),
        expires_at: receiptExpiry,
      };
      state.authority_receipts.push(receipt);
      card.authority_receipts.push(receipt);
      state.status = "ready";
      state.pause_reason = null;
      card.state = "active";
      this.event(card, "authority_granted", state.step.id);
      await this.write(card);
      return card;
    });
  }

  async setPreview(id: string, stepId: string, input: {
    preview_digest?: string;
    preview?: unknown;
    variables?: Record<string, string>;
    artifact?: Record<string, unknown>;
  }): Promise<CoordinationCard> {
    return this.serialize(id, async () => {
      const card = await this.get(id);
      const state = this.step(card, stepId);
      if (!["awaiting_approval", "ready", "expired"].includes(state.status)) {
        throw new Error(`step_preview_not_allowed:${state.status}`);
      }
      const computedDigest = input.preview === undefined ? "" : digest(input.preview);
      if (stepRequiresApproval(state.step).required && input.preview === undefined) {
        throw new Error("concrete_preview_required");
      }
      const suppliedDigest = input.preview_digest?.trim() ?? "";
      if (computedDigest && suppliedDigest && computedDigest !== suppliedDigest.toLowerCase()) {
        throw new Error("preview_digest_mismatch");
      }
      const previewDigest = computedDigest || suppliedDigest;
      if (!/^[a-fA-F0-9]{64}$/.test(previewDigest)) throw new Error("invalid_preview_digest");
      state.preview_digest = previewDigest.toLowerCase();
      state.preview_preserved_at = nowIso();
      state.authority_receipts = [];
      card.authority_receipts = card.authority_receipts.filter((receipt) => receipt.step_id !== stepId);
      state.idempotency_key = materializeIdempotencyKey(state.step.idempotency_key, {
        coordination_id: card.coordination_id,
        preview_digest: state.preview_digest,
        ...(input.variables ?? {}),
      });
      if (input.artifact) {
        state.artifacts.push(input.artifact);
        card.produced_artifacts.push(input.artifact);
      }
      if (stepRequiresApproval(state.step).required) {
        state.status = "awaiting_approval";
        card.state = "awaiting_approval";
      }
      this.event(card, "preview_preserved", stepId);
      await this.write(card);
      return card;
    });
  }

  async recordChatIdentity(id: string, identity: Record<string, unknown>): Promise<CoordinationCard> {
    return this.serialize(id, async () => {
      const card = await this.get(id);
      const channel = String(identity.channel || "").trim().toLowerCase();
      const conversationId = normalizeConversationId(channel, String(identity.conversation_id || ""));
      const messageId = String(identity.message_id || "").trim();
      if (!channel || !conversationId || !messageId) throw new Error("chat_identity_incomplete");
      const normalized = { ...identity, channel, conversation_id: conversationId, message_id: messageId };
      if (!card.chat_identities.some((entry) =>
        entry.channel === channel && entry.conversation_id === conversationId && entry.message_id === messageId,
      )) card.chat_identities.push(normalized);
      this.event(card, "chat_identity_recorded", card.current_step_id ?? undefined);
      await this.write(card);
      return card;
    });
  }

  async recordInboundMessage(input: {
    channel: string;
    conversation_id: string;
    message_id: string;
    sender_id: string;
    sender_name?: string;
    raw_wording: string;
  }): Promise<CoordinationCard | null> {
    const cards = await this.listPending();
    const channel = input.channel.trim().toLowerCase();
    const conversationId = normalizeConversationId(channel, input.conversation_id);
    const matches = cards.filter((card) => card.chat_identities.some((identity) =>
      String(identity.channel || "").toLowerCase() === channel
        && String(identity.conversation_id || "") === conversationId,
    ));
    const awaiting = matches.filter((card) => card.state === "awaiting_approval");
    const candidate = awaiting.length === 1 ? awaiting[0] : matches.length === 1 ? matches[0] : null;
    if (!candidate && matches.length > 1) {
      this.diagnostic(
        `ambiguous Telegram coordination reply for ${channel}:${conversationId}; ${matches.length} pending cards`,
      );
    }
    if (!candidate) return null;
    return this.serialize(candidate.coordination_id, async () => {
      const card = await this.get(candidate.coordination_id);
      if (card.conversation_messages.some((message) =>
        message.channel === channel
          && message.conversation_id === conversationId
          && message.message_id === input.message_id,
      )) return card;
      const permittedAuthority: PlanAuthority = this.operatorIds.has(input.sender_id)
        ? "operator"
        : "none";
      card.conversation_messages.push({
        channel,
        conversation_id: conversationId,
        message_id: input.message_id,
        sender_id: input.sender_id,
        sender_name: input.sender_name?.trim() || null,
        raw_wording: input.raw_wording,
        direction: "inbound",
        received_at: nowIso(),
        permitted_authority: permittedAuthority,
      });
      this.event(card, "operator_wording_appended", card.current_step_id ?? undefined);
      await this.write(card);
      return card;
    });
  }

  async listPending(): Promise<CoordinationCard[]> {
    try {
      const names = (await readdir(this.cardsDir)).filter((name) => name.endsWith(".json"));
      const cards = await Promise.all(names.map((name) => this.get(name.slice(0, -5)).catch(() => null)));
      return cards.filter((card): card is CoordinationCard =>
        card !== null && card.state !== "completed" && card.state !== "failed",
      ).sort((a, b) => b.updated_at.localeCompare(a.updated_at));
    } catch (error: any) {
      if (error?.code === "ENOENT") return [];
      throw error;
    }
  }

  async start(id: string, stepId: string): Promise<CoordinationCard> {
    return this.serialize(id, async () => {
      const card = await this.get(id);
      const state = this.step(card, stepId);
      if (state.status === "completed") return card;
      if (state.status !== "ready") throw new Error(`step_not_ready:${state.status}`);
      if (stepRequiresApproval(state.step).required) {
        const valid = state.authority_receipts.some((receipt) =>
          receipt.step_digest === state.step_digest &&
          receipt.preview_digest === state.preview_digest &&
          (!receipt.expires_at || Date.parse(receipt.expires_at) > Date.now()),
        );
        if (!valid) {
          if (state.authority_receipts.some((receipt) =>
            receipt.expires_at && Date.parse(receipt.expires_at) <= Date.now(),
          )) {
            state.status = "expired";
            state.pause_reason = "authority_receipt_expired";
            card.state = "awaiting_approval";
            this.event(card, "authority_receipt_expired", state.step.id);
            await this.write(card);
            throw new Error("authority_receipt_expired");
          }
          throw new Error("valid_authority_receipt_required");
        }
      }
      if (state.step.idempotency_key && !state.idempotency_key) throw new Error("unresolved_idempotency_key");
      state.status = "running";
      state.started_at = nowIso();
      state.attempts += 1;
      this.event(card, "step_started", state.step.id);
      await this.write(card);
      return card;
    });
  }

  async complete(id: string, stepId: string, receipt: {
    evidence?: Record<string, unknown>;
    artifacts?: Array<Record<string, unknown>>;
    chat_identities?: Array<Record<string, unknown>>;
    verification_results?: Array<Record<string, unknown>>;
    reward_governance_outcomes?: Array<Record<string, unknown>>;
  }): Promise<CoordinationCard> {
    return this.serialize(id, async () => {
      const card = await this.get(id);
      const state = this.step(card, stepId);
      if (state.status === "completed") return card;
      if (state.status !== "running") throw new Error("step_not_running");
      const evidence = receipt.evidence ?? {};
      const missing = (state.step.completion_evidence ?? []).filter((key) => {
        if (!(key in evidence)) return true;
        const value = evidence[key];
        return value == null || (typeof value === "string" && !value.trim());
      });
      if (missing.length) throw new Error(`completion_evidence_missing:${missing.join(",")}`);
      state.evidence = { ...evidence };
      state.artifacts.push(...(receipt.artifacts ?? []));
      state.chat_identities.push(...(receipt.chat_identities ?? []));
      state.verification_results.push(...(receipt.verification_results ?? []));
      card.produced_artifacts.push(...(receipt.artifacts ?? []));
      card.chat_identities.push(...(receipt.chat_identities ?? []));
      card.verification_results.push(...(receipt.verification_results ?? []));
      card.reward_governance_outcomes.push(...(receipt.reward_governance_outcomes ?? []));
      state.status = "completed";
      state.completed_at = nowIso();
      this.event(card, "step_completed", state.step.id);
      this.advance(card, state.step.id);
      await this.write(card);
      return card;
    });
  }

  async fail(id: string, stepId: string, message: string): Promise<CoordinationCard> {
    return this.serialize(id, async () => {
      const card = await this.get(id);
      const state = this.step(card, stepId);
      if (state.status !== "running") throw new Error("step_not_running");
      state.status = "failed";
      state.error = message.slice(0, 2_000);
      card.state = "failed";
      this.event(card, "step_failed", state.step.id);
      await this.write(card);
      return card;
    });
  }

  async retry(id: string, stepId: string): Promise<CoordinationCard> {
    return this.serialize(id, async () => {
      const card = await this.get(id);
      const state = this.step(card, stepId);
      if (state.status !== "failed") throw new Error("step_not_failed");
      const approval = stepRequiresApproval(state.step);
      if (approval.required) {
        state.authority_receipts = [];
        card.authority_receipts = card.authority_receipts.filter((receipt) => receipt.step_id !== stepId);
      }
      state.status = approval.required ? "awaiting_approval" : "ready";
      state.pause_reason = approval.required ? "retry_requires_fresh_approval" : null;
      state.error = null;
      card.state = approval.required ? "awaiting_approval" : "active";
      this.event(card, "step_retry_prepared", stepId);
      await this.write(card);
      return card;
    });
  }

  async recover(id: string, input: {
    step_id: string;
    actor: string;
    confirmation_message_id: string;
    reason: string;
  }): Promise<CoordinationCard> {
    return this.serialize(id, async () => {
      const card = await this.get(id);
      const state = this.step(card, input.step_id);
      if (state.status !== "running") throw new Error("step_not_running");
      const confirmation = card.conversation_messages.find((message) =>
        message.direction === "inbound" && message.message_id === input.confirmation_message_id,
      );
      if (!confirmation || confirmation.permitted_authority !== "operator") {
        throw new Error("operator_recovery_confirmation_required");
      }
      if (input.actor.trim() !== confirmation.sender_id) throw new Error("recovery_actor_mismatch");
      if (state.started_at && Date.parse(confirmation.received_at) < Date.parse(state.started_at)) {
        throw new Error("recovery_confirmation_predates_run");
      }
      const approval = stepRequiresApproval(state.step);
      state.authority_receipts = [];
      card.authority_receipts = card.authority_receipts.filter(
        (receipt) => receipt.step_id !== state.step.id,
      );
      state.status = approval.required ? "awaiting_approval" : "ready";
      state.pause_reason = approval.required ? "recovered_step_requires_fresh_approval" : null;
      state.error = null;
      state.verification_results.push({
        type: "operator_recovery",
        actor: confirmation.sender_id,
        confirmation_message_id: confirmation.message_id,
        reason: input.reason.slice(0, 2_000),
        recovered_at: nowIso(),
      });
      card.state = approval.required ? "awaiting_approval" : "active";
      this.event(card, "running_step_recovered", state.step.id);
      await this.write(card);
      return card;
    });
  }

  private advance(card: CoordinationCard, completedId: string): void {
    const completedIndex = card.steps.findIndex((step) => step.step.id === completedId);
    const next = card.steps[completedIndex + 1];
    if (!next) {
      card.current_step_id = null;
      card.state = "completed";
      this.event(card, "coordination_completed");
      return;
    }
    const unmet = (next.step.uses ?? []).filter((id) =>
      card.steps.find((candidate) => candidate.step.id === id)?.status !== "completed",
    );
    if (unmet.length) throw new Error(`dependency_not_completed:${unmet.join(",")}`);
    const approval = stepRequiresApproval(next.step);
    next.status = approval.required ? "awaiting_approval" : "ready";
    next.pause_reason = approval.reason;
    card.current_step_id = next.step.id;
    card.state = approval.required ? "awaiting_approval" : "active";
    this.event(card, approval.required ? "approval_requested" : "step_ready", next.step.id);
  }

  private step(card: CoordinationCard, id: string): CoordinationStepState {
    const state = card.steps.find((candidate) => candidate.step.id === id);
    if (!state) throw new Error("step_not_found");
    if (card.current_step_id !== id) throw new Error("step_not_current");
    return state;
  }

  private event(card: CoordinationCard, type: string, stepId?: string): void {
    const at = nowIso();
    const previousDigest = card.events.at(-1)?.digest ?? card.event_chain_anchor;
    card.updated_at = at;
    card.events.push({
      at,
      type,
      ...(stepId ? { step_id: stepId } : {}),
      previous_digest: previousDigest,
      digest: digest({ type, stepId, at, previousDigest }),
    });
    if (card.events.length > 500) {
      const removed = card.events.splice(0, card.events.length - 500);
      card.event_chain_anchor = removed.at(-1)?.digest ?? card.event_chain_anchor;
    }
  }

  private async write(card: CoordinationCard, createOnly = false): Promise<void> {
    await mkdir(this.cardsDir, { recursive: true, mode: 0o700 });
    const path = this.cardPath(card.coordination_id);
    const temp = `${path}.${randomUUID()}.tmp`;
    const handle = await open(temp, "wx", 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(card, null, 2)}\n`, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      if (createOnly) {
        await link(temp, path);
        await unlink(temp).catch(() => undefined);
      } else {
        await rename(temp, path);
      }
      const directory = await open(this.cardsDir, "r").catch(() => null);
      if (directory) {
        try { await directory.sync(); } finally { await directory.close(); }
      }
    } catch (error) {
      await unlink(temp).catch(() => undefined);
      throw error;
    }
  }
}
