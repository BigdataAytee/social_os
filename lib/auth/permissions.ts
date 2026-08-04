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
  | "campaign.manage"
  | "brandVoice.edit"
  | "member.manage"
  | "integration.manage"
  | "org.settings"
  | "org.delete";

const MATRIX: Record<Role, Action[] | "*"> = {
  OWNER: "*",
  ADMIN: [
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
  ],
  VIEWER: ["comment.write"],
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
