import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

// ---------------------------------------------------------------------------
// SAFETY: @supabase/supabase-js is fully mocked below. No real network call
// and no real Supabase project is ever reachable from these tests. This
// suite's core purpose is proving, structurally, that no code path through
// the new tracked-items CRUD surface can ever set or influence the
// call-destination phone number -- TARGET_PHONE in app/api/check/route.ts
// remains the sole, fixed, env-configured source of that number.
// ---------------------------------------------------------------------------

const ORIGINAL_ENV = { ...process.env };

/**
 * A minimal chainable mock of the subset of the supabase-js query builder
 * this project uses (.from().select().order() / .insert().select().single()
 * / .update().eq().select().single()). Every call is recorded so tests can
 * assert on the exact payload sent to the database.
 */
function createMockSupabaseClient(result: { data?: unknown; error?: unknown } = { data: null, error: null }) {
  const calls: { insert?: unknown; update?: unknown; eqCol?: string; eqVal?: unknown } = {};
  const builder = {
    select: vi.fn(() => builder),
    order: vi.fn(() => Promise.resolve(result)),
    insert: vi.fn((row: unknown) => {
      calls.insert = row;
      return builder;
    }),
    update: vi.fn((patch: unknown) => {
      calls.update = patch;
      return builder;
    }),
    eq: vi.fn((col: string, val: unknown) => {
      calls.eqCol = col;
      calls.eqVal = val;
      return builder;
    }),
    single: vi.fn(() => Promise.resolve(result)),
  };
  const from = vi.fn(() => builder);
  return { client: { from }, calls, from };
}

beforeEach(() => {
  vi.resetModules();
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_ANON_KEY = "test-anon-key";
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.restoreAllMocks();
  vi.doUnmock("@supabase/supabase-js");
});

describe("buildCallTask - always template-generated, never phone-aware", () => {
  it("has no phone parameter and produces a script mentioning only name/category", async () => {
    const { buildCallTask } = await import("./tracked-items-store");
    const task = buildCallTask({ name: "Widget publish", category: "content-publishing" });
    expect(task).toContain("Widget publish");
    expect(task).toContain("content-publishing");
    expect(task.toLowerCase()).not.toMatch(/\+?\d{7,}/); // no embedded phone-shaped digit run
    // Structural: the function only accepts name/category (see the type
    // definition), so there is no argument slot to smuggle a phone through.
    expect(buildCallTask.length).toBe(1);
  });
});

describe("loadTrackedItems - not configured => fails safe (never throws, never fabricates data)", () => {
  it("returns ok:false when SUPABASE_URL/SUPABASE_ANON_KEY are missing", async () => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_ANON_KEY;
    const { loadTrackedItems } = await import("./tracked-items-store");
    const result = await loadTrackedItems();
    expect(result.ok).toBe(false);
  });
});

describe("loadTrackedItems - maps Supabase rows to TrackedItem, deriving call_task", () => {
  it("returns items with a generated call_task and no extraneous fields", async () => {
    const rows = [
      {
        id: "abc-123",
        name: "Test Item",
        category: "test-category",
        cooldown_hours: 24,
        last_action_at: "2026-08-01T00:00:00Z",
        source: "user-added",
      },
    ];
    const { client } = createMockSupabaseClient({ data: rows, error: null });
    vi.doMock("@supabase/supabase-js", () => ({ createClient: vi.fn(() => client) }));

    const { loadTrackedItems } = await import("./tracked-items-store");
    const result = await loadTrackedItems();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.items).toHaveLength(1);
    expect(result.items[0].id).toBe("abc-123");
    expect(result.items[0].call_task).toContain("Test Item");
    // Every key on the returned item is one of the known-safe TrackedItem
    // fields -- specifically, "phone" in any spelling is never present.
    const keys = Object.keys(result.items[0]);
    expect(keys.some((k) => k.toLowerCase().includes("phone"))).toBe(false);
    expect(keys.sort()).toEqual(
      ["call_task", "category", "cooldown_hours", "id", "last_action_at", "name", "source"].sort()
    );
  });

  it("returns ok:false (not a thrown error, not silently-empty-treated-as-fine) on a Supabase error", async () => {
    const { client } = createMockSupabaseClient({ data: null, error: { message: "connection refused" } });
    vi.doMock("@supabase/supabase-js", () => ({ createClient: vi.fn(() => client) }));
    const { loadTrackedItems } = await import("./tracked-items-store");
    const result = await loadTrackedItems();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("connection refused");
  });
});

describe("createTrackedItem - cooldown floor enforced BEFORE any database write is attempted", () => {
  it("rejects cooldown_hours below MIN_COOLDOWN_HOURS without ever calling insert", async () => {
    const { client, calls } = createMockSupabaseClient();
    vi.doMock("@supabase/supabase-js", () => ({ createClient: vi.fn(() => client) }));
    const { createTrackedItem } = await import("./tracked-items-store");

    const result = await createTrackedItem({
      name: "Too fast",
      category: "test",
      cooldown_hours: 0.5,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
      expect(result.error).toContain("safety floor");
    }
    expect(calls.insert).toBeUndefined();
  });

  it("rejects non-finite cooldown_hours (NaN from a malformed request) without writing", async () => {
    const { client, calls } = createMockSupabaseClient();
    vi.doMock("@supabase/supabase-js", () => ({ createClient: vi.fn(() => client) }));
    const { createTrackedItem } = await import("./tracked-items-store");

    const result = await createTrackedItem({
      name: "Bad number",
      category: "test",
      cooldown_hours: Number("not-a-number"),
    });

    expect(result.ok).toBe(false);
    expect(calls.insert).toBeUndefined();
  });

  it("accepts cooldown_hours exactly at the floor and writes a row shaped with ONLY the whitelisted columns", async () => {
    const insertedRow = {
      id: "new-id",
      name: "Fine item",
      category: "test",
      cooldown_hours: 1,
      last_action_at: "2026-08-25T00:00:00Z",
      source: "user-added",
    };
    const { client, calls } = createMockSupabaseClient({ data: insertedRow, error: null });
    vi.doMock("@supabase/supabase-js", () => ({ createClient: vi.fn(() => client) }));
    const { createTrackedItem } = await import("./tracked-items-store");

    const result = await createTrackedItem({
      name: "Fine item",
      category: "test",
      cooldown_hours: 1,
      last_action_at: "2026-08-25T00:00:00Z",
    });

    expect(result.ok).toBe(true);
    expect(calls.insert).toBeDefined();
    const insertKeys = Object.keys(calls.insert as Record<string, unknown>).sort();
    expect(insertKeys).toEqual(["category", "cooldown_hours", "id", "last_action_at", "name", "source"].sort());
    expect(insertKeys.some((k) => k.toLowerCase().includes("phone"))).toBe(false);
  });

  it("SAFETY: a phone/destination field anywhere on the caller's input is never forwarded to the database", async () => {
    const insertedRow = {
      id: "new-id",
      name: "Malicious-shaped item",
      category: "test",
      cooldown_hours: 2,
      last_action_at: "2026-08-25T00:00:00Z",
      source: "user-added",
    };
    const { client, calls } = createMockSupabaseClient({ data: insertedRow, error: null });
    vi.doMock("@supabase/supabase-js", () => ({ createClient: vi.fn(() => client) }));
    const { createTrackedItem } = await import("./tracked-items-store");

    // Cast through `unknown` to simulate a caller (e.g. a route that forgot
    // to whitelist fields, or a directly-crafted malicious payload) trying
    // to smuggle a phone number in via extra properties. createTrackedItem's
    // parameter type has no such field -- this proves that even if such a
    // value reaches this function at runtime (TypeScript's structural typing
    // does not strip excess properties on an object built like this), it is
    // never read or persisted.
    const maliciousInput = {
      name: "Malicious-shaped item",
      category: "test",
      cooldown_hours: 2,
      phone: "REDACTED_DESTINATION",
      phone_number: "REDACTED_DESTINATION",
      target_phone: "REDACTED_DESTINATION",
      destination_number: "REDACTED_DESTINATION",
      TARGET_PHONE: "REDACTED_DESTINATION",
    };
    const result = await createTrackedItem(maliciousInput as unknown as Parameters<typeof createTrackedItem>[0]);

    expect(result.ok).toBe(true);
    const insertPayload = calls.insert as Record<string, unknown>;
    for (const key of Object.keys(insertPayload)) {
      expect(key.toLowerCase()).not.toContain("phone");
    }
    expect(insertPayload).not.toHaveProperty("phone");
    expect(insertPayload).not.toHaveProperty("phone_number");
    expect(insertPayload).not.toHaveProperty("target_phone");
    expect(insertPayload).not.toHaveProperty("destination_number");
    expect(insertPayload).not.toHaveProperty("TARGET_PHONE");
    expect(Object.keys(insertPayload).sort()).toEqual(
      ["category", "cooldown_hours", "id", "last_action_at", "name", "source"].sort()
    );
  });

  it("rejects a missing name/category before writing", async () => {
    const { client, calls } = createMockSupabaseClient();
    vi.doMock("@supabase/supabase-js", () => ({ createClient: vi.fn(() => client) }));
    const { createTrackedItem } = await import("./tracked-items-store");

    const result = await createTrackedItem({ name: "", category: "test", cooldown_hours: 5 });
    expect(result.ok).toBe(false);
    expect(calls.insert).toBeUndefined();
  });
});

describe("markItemDone - writes ONLY last_action_at, identified ONLY by id", () => {
  it("updates last_action_at and nothing else, and the update payload can never contain a phone field", async () => {
    const updatedRow = {
      id: "item-1",
      name: "X",
      category: "test",
      cooldown_hours: 24,
      last_action_at: "2026-08-25T12:00:00Z",
      source: "user-added",
    };
    const { client, calls } = createMockSupabaseClient({ data: updatedRow, error: null });
    vi.doMock("@supabase/supabase-js", () => ({ createClient: vi.fn(() => client) }));
    const { markItemDone } = await import("./tracked-items-store");

    const result = await markItemDone("item-1");

    expect(result.ok).toBe(true);
    expect(calls.eqCol).toBe("id");
    expect(calls.eqVal).toBe("item-1");
    const updatePayload = calls.update as Record<string, unknown>;
    expect(Object.keys(updatePayload)).toEqual(["last_action_at"]);
  });

  it("markItemDone's signature accepts only a string id -- structurally cannot carry a phone field", async () => {
    const { markItemDone } = await import("./tracked-items-store");
    // A single string parameter; there is no object shape here at all for
    // a phone field to hide in.
    expect(markItemDone.length).toBe(1);
  });

  it("rejects an empty id without attempting a write", async () => {
    const { client, calls } = createMockSupabaseClient();
    vi.doMock("@supabase/supabase-js", () => ({ createClient: vi.fn(() => client) }));
    const { markItemDone } = await import("./tracked-items-store");

    const result = await markItemDone("");
    expect(result.ok).toBe(false);
    expect(calls.update).toBeUndefined();
  });
});

/**
 * Strips // line comments and /* block comments *\/ so the static checks
 * below assert on actual code, not on explanatory prose (which legitimately
 * uses the word "phone" to document that no such field exists).
 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

describe("STATIC SAFETY CHECK - the new CRUD route CODE (comments excluded) contains no phone-shaped field", () => {
  it("app/api/items/route.ts has no phone-shaped identifier in actual code", () => {
    const src = readFileSync(join(__dirname, "..", "app", "api", "items", "route.ts"), "utf8");
    expect(stripComments(src).toLowerCase()).not.toContain("phone");
  });

  it("app/api/items/[id]/mark-done/route.ts has no phone-shaped identifier in actual code", () => {
    const src = readFileSync(join(__dirname, "..", "app", "api", "items", "[id]", "mark-done", "route.ts"), "utf8");
    expect(stripComments(src).toLowerCase()).not.toContain("phone");
  });

  it("app/api/check/route.ts still reads TARGET_PHONE from env only, not from tracked-item data", () => {
    const src = readFileSync(join(__dirname, "..", "app", "api", "check", "route.ts"), "utf8");
    expect(src).toContain('process.env.TARGET_PHONE');
    // The phone passed to placeCall must be the module-level TARGET_PHONE
    // constant, never a per-item/per-request value.
    expect(src).toMatch(/phone:\s*TARGET_PHONE/);
  });
});
