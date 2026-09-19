import assert from "node:assert/strict";
import test from "node:test";
import {
  formatMemberSinceDate,
  resolveMemberSinceDate,
} from "../profile-member-since";

test("uses the Soflia Learning account date before the local Engine profile date", () => {
  assert.equal(
    resolveMemberSinceDate({
      sofliaCreatedAt: "2023-05-17T18:00:00.000Z",
      localCreatedAt: "2026-09-15T12:00:00.000Z",
    }),
    "2023-05-17T18:00:00.000Z",
  );
});

test("falls back to the local profile date when Soflia has no valid date", () => {
  assert.equal(
    resolveMemberSinceDate({
      sofliaCreatedAt: "not-a-date",
      localCreatedAt: "2025-01-08T18:00:00.000Z",
    }),
    "2025-01-08T18:00:00.000Z",
  );
});

test("does not invent the current date when no registration date exists", () => {
  assert.equal(resolveMemberSinceDate({}), null);
  assert.equal(formatMemberSinceDate(null), null);
  assert.equal(formatMemberSinceDate("not-a-date"), null);
});

test("formats the membership date in Spanish using the account timezone", () => {
  assert.equal(
    formatMemberSinceDate("2024-03-10T18:00:00.000Z"),
    "10 de marzo de 2024",
  );
});
