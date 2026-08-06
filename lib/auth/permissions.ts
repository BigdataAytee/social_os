import type { Role } from "@prisma/client";

/**
 * Role → capability matrix (ARCHITECTURE.md §5).
 *
 * Enforced in the service layer. UI may use `can()` to hide affordances, but
 * hiding is a courtesy — never the control.
 */
export type Action =
  | "post.create"
  | "post.edit"
  | "post.submitForApproval"
  | "post.approve"
  | "post.publish"
  | "post.delete"
  | "idea.write"
  | "asset.upload"
  | "ai.generate"
  | "comment.write"
  // Replying to the outside world under the brand's name. Deliberately not
  // `comment.write`, which is an internal note on a draft — a public reply is a
  // published statement and belongs behind the same kind of gate. A CREATOR is
  // a contractor: they may write drafts, not speak as the brand.
  | "inbox.reply"
  // Assigning, snoozing and closing threads.
  | "inbox.manage"
  | "campaign.manage"
  | "brandVoice.edit"
  | "member.manage"
  | "integration.manage"
  | "org.settings"
  | "org.delete"
  | "workspace.create"
  | "workspace.switch";

const MATRIX: Record<Role, Action[] | "*"> = {
  OWNER: "*",
  ADMIN: [
    "workspace.create",
    "workspace.switch",
    "post.create",
    "post.edit",
    "post.submitForApproval",
    "post.approve",
    "post.publish",
    "post.delete",
    "idea.write",
    "asset.upload",
    "ai.generate",
    "comment.write",
    "inbox.reply",
    "inbox.manage",
    "campaign.manage",
    "brandVoice.edit",
    "member.manage",
    "integration.manage",
    "org.settings",
  ],
  EDITOR: [
    "post.create",
    "post.edit",
    "post.submitForApproval",
    "idea.write",
    "asset.upload",
    "ai.generate",
    "comment.write",
    "inbox.reply",
    "inbox.manage",
    "workspace.switch",
  ],
  // A contractor: writes and edits, but never pushes work into the approval
  // queue itself. Someone accountable shepherds it through the gate.
  CREATOR: [
    "post.create",
    "post.edit",
    "idea.write",
    "asset.upload",
    "ai.generate",
    "comment.write",
  ],
  VIEWER: ["comment.write"],
  // Deny-by-default, listed explicitly rather than inherited (§9). A client
  // approves their own workspace's work and comments on it. Everything else —
  // including seeing that other workspaces exist — is absent by construction,
  // because a client seeing another client's data is the one failure an agency
  // cannot survive.
  CLIENT: ["post.approve", "comment.write"],
};

export function can(role: Role, action: Action): boolean {
  const allowed = MATRIX[role];
  return allowed === "*" || allowed.includes(action);
}

export function assertCan(role: Role, action: Action): void {
  if (!can(role, action)) {
    throw new Error(`Role ${role} is not permitted to ${action}`);
  }
}

/** One-line description of each role, shown on the Team screen. */
export const ROLE_SUMMARY: Record<Role, string> = {
  OWNER: "Full access, including org settings and deletion",
  ADMIN: "Manages members, integrations and approvals",
  EDITOR: "Creates and edits content; can't publish or approve",
  CREATOR: "Writes and edits; can't submit for approval",
  VIEWER: "Read-only; can comment",
  CLIENT: "Reviews and approves this workspace only",
};
