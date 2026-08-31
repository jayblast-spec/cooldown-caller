import type { ItemStatus } from "@/lib/cooldown";

export type CallDecision = {
  item_id: string;
  decision: "CALL" | "WAIT" | "BLOCK";
  agents: Array<{ agent: "watcher" | "permission" | "briefing"; finding: string }>;
  briefing: string;
};

/** Interwoven safety pipeline: observe → authorize → brief. */
export function buildCallDecision(status: ItemStatus, targetConfigured: boolean): CallDecision {
  const agents: CallDecision["agents"] = [
    { agent: "watcher", finding: status.state === "actionable" ? "Cooldown cleared." : "Cooldown still active." },
  ];
  if (!targetConfigured) {
    agents.push({ agent: "permission", finding: "No authorized destination is configured; fail closed." });
    return { item_id: status.id, decision: "BLOCK", agents, briefing: "No call may be placed." };
  }
  agents.push({ agent: "permission", finding: "Server-owned authorized destination is configured; user data cannot change it." });
  const briefing = `${status.name}: ${status.call_task}`;
  agents.push({ agent: "briefing", finding: `Prepared a bounded call objective (${briefing.length} chars).` });
  return { item_id: status.id, decision: status.state === "actionable" ? "CALL" : "WAIT", agents, briefing };
}
