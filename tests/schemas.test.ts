import { describe, expect, it } from "vitest";
import {
  resourceId,
  worldId,
  email,
  nonEmptyString,
  CreateWorldBodySchema,
  UpdateWorldBodySchema,
  PlatformTokenCreateRequestSchema,
  UsageRecordRequestSchema,
} from "../src/lib/schemas";

describe("resourceId", () => {
  it("accepts valid resource IDs", () => {
    expect(resourceId.safeParse("my-resource-id").success).toBe(true);
    expect(resourceId.safeParse("abc").success).toBe(true);
    expect(resourceId.safeParse("a".repeat(63)).success).toBe(true);
  });

  it("rejects IDs that are too short", () => {
    expect(resourceId.safeParse("ab").success).toBe(false);
    expect(resourceId.safeParse("").success).toBe(false);
  });

  it("rejects IDs that are too long", () => {
    expect(resourceId.safeParse("a".repeat(64)).success).toBe(false);
  });

  it("rejects IDs starting with non-lowercase letter", () => {
    expect(resourceId.safeParse("0abc").success).toBe(false);
    expect(resourceId.safeParse("-abc").success).toBe(false);
    expect(resourceId.safeParse("ABC").success).toBe(false);
  });

  it("rejects IDs with invalid characters", () => {
    expect(resourceId.safeParse("my_resource").success).toBe(false);
    expect(resourceId.safeParse("my resource").success).toBe(false);
    expect(resourceId.safeParse("my.resource").success).toBe(false);
  });
});

describe("email", () => {
  it("accepts valid emails", () => {
    expect(email.safeParse("user@example.com").success).toBe(true);
  });

  it("rejects invalid emails", () => {
    expect(email.safeParse("not-an-email").success).toBe(false);
    expect(email.safeParse("").success).toBe(false);
  });

  it("rejects non-string values", () => {
    expect(email.safeParse(123).success).toBe(false);
  });
});

describe("nonEmptyString", () => {
  it("accepts non-empty strings", () => {
    expect(nonEmptyString.safeParse("hello").success).toBe(true);
    expect(nonEmptyString.safeParse("a").success).toBe(true);
  });

  it("rejects empty strings", () => {
    expect(nonEmptyString.safeParse("").success).toBe(false);
  });
});

describe("worldId", () => {
  it("accepts only canonical Worlds API UUIDv4 identifiers", () => {
    expect(
      worldId.safeParse("w_00000000-0000-4000-8000-000000000001").success,
    ).toBe(true);
    expect(worldId.safeParse("w_created-123").success).toBe(false);
    expect(
      worldId.safeParse("w_00000000-0000-3000-8000-000000000001").success,
    ).toBe(false);
  });
});

describe("CreateWorldBodySchema", () => {
  it("accepts a display-name-only world request", () => {
    expect(
      CreateWorldBodySchema.safeParse({
        world: { displayName: "My World" },
      }).success,
    ).toBe(true);
  });

  it("accepts optional owner and region fields", () => {
    expect(
      CreateWorldBodySchema.safeParse({
        world: { displayName: "My World", region: "us-east" },
        ownerEmail: "user@example.com",
      }).success,
    ).toBe(true);
  });

  it("rejects caller-supplied slugs and IDs", () => {
    expect(
      CreateWorldBodySchema.safeParse({
        slug: "my-world",
        world: { displayName: "My World" },
      }).success,
    ).toBe(false);
    expect(
      CreateWorldBodySchema.safeParse({
        world: {
          displayName: "My World",
          id: "w_00000000-0000-4000-8000-000000000001",
        },
      }).success,
    ).toBe(false);
  });

  it("rejects missing world.displayName", () => {
    expect(
      CreateWorldBodySchema.safeParse({ world: { region: "us-east" } }).success,
    ).toBe(false);
  });

  it("rejects missing world object", () => {
    expect(CreateWorldBodySchema.safeParse({}).success).toBe(false);
  });

  it("rejects when world is not an object", () => {
    expect(
      CreateWorldBodySchema.safeParse({ world: "not-an-object" }).success,
    ).toBe(false);
  });
});

describe("UpdateWorldBodySchema", () => {
  it("accepts valid update with displayName", () => {
    const result = UpdateWorldBodySchema.safeParse({
      updateMask: "displayName",
      world: { displayName: "New Name" },
    });
    expect(result.success).toBe(true);
  });

  it("accepts valid update with state", () => {
    const result = UpdateWorldBodySchema.safeParse({
      updateMask: "state",
      world: { state: "ACTIVE" },
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing updateMask", () => {
    const result = UpdateWorldBodySchema.safeParse({
      world: { displayName: "New Name" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing world object", () => {
    const result = UpdateWorldBodySchema.safeParse({
      updateMask: "displayName",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid state value", () => {
    const result = UpdateWorldBodySchema.safeParse({
      updateMask: "state",
      world: { state: "INVALID" },
    });
    expect(result.success).toBe(false);
  });

  it("accepts ACTIVE and SUSPENDED states", () => {
    expect(
      UpdateWorldBodySchema.safeParse({
        updateMask: "state",
        world: { state: "ACTIVE" },
      }).success,
    ).toBe(true);

    expect(
      UpdateWorldBodySchema.safeParse({
        updateMask: "state",
        world: { state: "SUSPENDED" },
      }).success,
    ).toBe(true);
  });
});

describe("PlatformTokenCreateRequestSchema", () => {
  it("accepts request with name", () => {
    const result = PlatformTokenCreateRequestSchema.safeParse({
      name: "my-token",
    });
    expect(result.success).toBe(true);
  });

  it("accepts request with tokenName", () => {
    const result = PlatformTokenCreateRequestSchema.safeParse({
      tokenName: "my-token",
    });
    expect(result.success).toBe(true);
  });

  it("accepts request with optional scope and expiresAt", () => {
    const result = PlatformTokenCreateRequestSchema.safeParse({
      name: "my-token",
      scope: "worlds.read",
      expiresAt: "2027-01-01T00:00:00.000Z",
    });
    expect(result.success).toBe(true);
  });

  it("accepts empty body (both name and tokenName optional)", () => {
    const result = PlatformTokenCreateRequestSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("rejects invalid expiresAt format", () => {
    const result = PlatformTokenCreateRequestSchema.safeParse({
      name: "my-token",
      expiresAt: "not-a-date",
    });
    expect(result.success).toBe(false);
  });
});

describe("UsageRecordRequestSchema", () => {
  it("accepts valid usage record", () => {
    const result = UsageRecordRequestSchema.safeParse({
      metric: "api_calls",
      quantity: 100,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.unit).toBe("count");
      expect(result.data.wazooMarkupMicrocents).toBe(0);
      expect(result.data.billingSource).toBe("BETA_FREE");
    }
  });

  it("accepts with all optional fields", () => {
    const result = UsageRecordRequestSchema.safeParse({
      metric: "storage_bytes",
      quantity: 1024,
      unit: "bytes",
      providerCostMicrocents: 50,
      wazooMarkupMicrocents: 10,
      estimatedCostMicrocents: 60,
      billingSource: "STRIPE",
      createTime: "2026-01-01T00:00:00.000Z",
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing metric", () => {
    const result = UsageRecordRequestSchema.safeParse({
      quantity: 100,
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing quantity", () => {
    const result = UsageRecordRequestSchema.safeParse({
      metric: "api_calls",
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty metric string", () => {
    const result = UsageRecordRequestSchema.safeParse({
      metric: "",
      quantity: 100,
    });
    expect(result.success).toBe(false);
  });

  it("rejects negative quantity", () => {
    const result = UsageRecordRequestSchema.safeParse({
      metric: "api_calls",
      quantity: -1,
    });
    expect(result.success).toBe(false);
  });

  it("rejects zero quantity", () => {
    const result = UsageRecordRequestSchema.safeParse({
      metric: "api_calls",
      quantity: 0,
    });
    expect(result.success).toBe(false);
  });

  it("rejects non-integer quantity", () => {
    const result = UsageRecordRequestSchema.safeParse({
      metric: "api_calls",
      quantity: 1.5,
    });
    expect(result.success).toBe(false);
  });

  it("applies defaults for optional fields", () => {
    const result = UsageRecordRequestSchema.safeParse({
      metric: "api_calls",
      quantity: 100,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.unit).toBe("count");
      expect(result.data.wazooMarkupMicrocents).toBe(0);
      expect(result.data.billingSource).toBe("BETA_FREE");
    }
  });
});
