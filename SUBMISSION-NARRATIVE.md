# Cooldown Caller — Winning Submission Narrative

Cooldown Caller solves phone work people should not have to remember: it watches recurring cooldowns and places a real CALL-E call only when action becomes possible. The new **Call Decision Mesh** interweaves a Watcher, Permission Gate, and Briefing specialist before the CALL-E request is allowed to run.

The Watcher performs deterministic timestamp evaluation. The Permission Gate fails closed unless the server-owned, authorized destination exists and confirms that public input cannot change it. The Briefing specialist creates a bounded objective from the tracked item. Only a unanimous `CALL` decision reaches CALL-E; otherwise the result is `WAIT` or `BLOCK`. Idempotency, Supabase-backed call-slot claims, a global manual-trigger throttle, and lifetime demo caps protect against duplicate or abusive calls.

CALL-E is not decorative: the production route calls its API, persists the real call ID and status, retrieves the summary and transcript, and shows the call lifecycle in the dashboard. The product’s moat is the reusable watch → authorize → brief → call → reconcile loop, applicable to filing deadlines, quota recovery, publishing windows, and other high-attention recurring work.

Judge path: inspect an actionable item, run the check, inspect the three-stage decision trace, and watch the resulting CALL-E lifecycle appear without exposing the destination or transcript publicly.

