import assert from "node:assert/strict";
import { test } from "node:test";
import { validateShoppingItemPayload } from "../../functions/_lib/shopping.js";

const ID = "343f41d4-d168-48b9-818c-ceec725676a7";
const CREATED = "2026-10-04T08:00:00.000Z";
const item = (patch = {}) => ({
  id: ID, name: "Piim", quantity: "", category: "food", note: "",
  checkedAt: null, createdAt: CREATED, ...patch,
});

// Public seam authorized by SHARED_SHOPPING_V1: canonical server payload validation.
test("shopping canonicalizes the required name and supplies the optional defaults", () => {
  assert.deepEqual(validateShoppingItemPayload({ id: ID, name: "  Piim  ", createdAt: CREATED }, ID), item());
  assert.deepEqual(validateShoppingItemPayload(item(), ID), item());
});

test("shopping strictly rejects invalid identity, unknown fields, credentials and malformed values", () => {
  for (const patch of [
    { id: "item_1" }, { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
    { name: " " }, { name: "a".repeat(161) }, { name: null },
    { quantity: null }, { quantity: 2 }, { quantity: "a".repeat(41) },
    { category: "calendar" }, { category: null }, { note: null }, { note: "a".repeat(501) },
    { checkedAt: "2026-02-30T00:00:00.000Z" }, { checkedAt: CREATED.replace(".000Z", "Z") },
    { checkedAt: 1 }, { createdAt: null }, { createdAt: "2026-02-30T00:00:00.000Z" },
    { householdId: null }, { userId: "usr_a" }, { token: "private" },
    { deviceToken: "private" }, { password: "private" }, { extra: true },
  ]) assert.throws(() => validateShoppingItemPayload(item(patch), ID), TypeError, JSON.stringify(patch));
  for (const value of [null, [], "Piim", {}, Object.create({ name: "Piim" })]) {
    assert.throws(() => validateShoppingItemPayload(value, ID), TypeError);
  }
});

test("shopping bounds strings in UTF-16 units and preserves every supported category", () => {
  for (const category of ["food", "home", "pharmacy", "other"]) {
    const payload = item({ name: "😀".repeat(80), quantity: "😀".repeat(20), note: "😀".repeat(250), category, checkedAt: CREATED });
    assert.deepEqual(validateShoppingItemPayload(payload, ID), payload);
  }
  for (const patch of [{ name: "😀".repeat(81) }, { quantity: "😀".repeat(21) }, { note: "😀".repeat(251) }]) {
    assert.throws(() => validateShoppingItemPayload(item(patch), ID), TypeError);
  }
});
