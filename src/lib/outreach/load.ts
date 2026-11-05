import * as repo from "../db/repo";
import { badNewsHold } from "../pipeline/sensitive";
import { prospectLabel } from "../ui/format";
import { computeOutreach, type OutreachRow, type OutreachStats } from "./stats";

/** Reads every run into Outreach rows. Fine for a single rep's few hundred runs. */
export function loadOutreachRows(): OutreachRow[] {
  return repo.listRuns({ limit: 500 }).map((summary) => {
    const run = repo.getRun(summary.id)!;
    const drafts = repo.listDrafts(summary.id);
    const latest = drafts.at(-1) ?? null;
    const sentDraft = run.sent ? drafts.find((d) => d.version === run.sent!.version) : undefined;
    return {
      runId: summary.id,
      label: prospectLabel(summary.prospect, summary.resolvedLabel),
      status: summary.status,
      createdAt: summary.createdAt,
      error: summary.error,
      hookType: latest?.kind === "role_based" ? null : summary.hookType,
      hold: run.hold,
      badNews: summary.status === "awaiting_review" && badNewsHold(repo.listSignals(summary.id)).length > 0,
      draft: latest ? { version: latest.version, subject: latest.subject, expiresAt: latest.notes?.expiresAt ?? null } : null,
      sent: run.sent ? { ...run.sent, subject: sentDraft?.subject ?? null } : null,
    };
  });
}

export function outreachStats(now = new Date()): OutreachStats {
  return computeOutreach(loadOutreachRows(), now);
}
