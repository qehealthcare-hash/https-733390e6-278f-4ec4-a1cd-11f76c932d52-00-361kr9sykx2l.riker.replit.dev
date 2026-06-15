/** Canonical audit row fixture for route / contract tests. */
export function auditRowFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: "AUD2026050001",
    module: "patient",
    entity_id: "PAT2026050001",
    action: "create",
    actor: "admin@example.com",
    user_id: null,
    stamp: "Created patient",
    before: null,
    after: null,
    payload: {},
    created_at: "2026-05-01T05:00:00.000Z",
    ...overrides
  };
}
