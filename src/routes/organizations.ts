import { Hono, type Context } from "hono";
import type { AppEnv } from "../env";
import { all, db, first, id, now } from "../lib/db";
import { isAdmin, jsonBody, requireResourceId, requireScope, requireString, resolveOrg } from "../lib/http";
import { quotaStatus } from "../lib/quota";

type OrganizationRow = { id: string; slug: string; name: string; state: string; billing_provider?: string; billing_state?: string; stripe_customer_id?: string | null; created_at?: string; updated_at?: string };

async function organizationResource(c: Context<AppEnv>, row: OrganizationRow) {
  return {
    name: `organizations/${row.slug}`,
    uid: row.id,
    displayName: row.name,
    state: row.state,
    quota: await quotaStatus(c, row.id, row.state),
    billing: {
      state: row.billing_state ?? "BETA_FREE",
      provider: row.billing_provider ?? "STRIPE",
      customerConfigured: Boolean(row.stripe_customer_id),
      paymentRequired: false,
    },
    createTime: row.created_at,
    updateTime: row.updated_at
  };
}

export const organizations = new Hono<AppEnv>()
  .get("/organizations", async (c) => {
    requireScope(c, "organizations.read");
    const auth = c.get("auth");
    const database = db(c.env);
    const rows = auth.organizationId
      ? await all(database.prepare("SELECT * FROM organizations WHERE id = ? ORDER BY created_at DESC").bind(auth.organizationId))
      : await all(database.prepare("SELECT * FROM organizations ORDER BY created_at DESC"));
    return c.json({ organizations: await Promise.all(rows.map((row) => organizationResource(c, row as OrganizationRow))) });
  })
  .post("/organizations", async (c) => {
    requireScope(c, "organizations.write");
    const body = await jsonBody(c);
    const organizationBody = body.organization;
    if (!organizationBody || typeof organizationBody !== "object" || Array.isArray(organizationBody)) {
      return c.json({ error: { code: "INVALID_ARGUMENT", message: "organization is required" } }, 400);
    }
    const organization = { id: `org_${id()}`, slug: requireResourceId(body, "organizationId"), name: requireString(organizationBody as Record<string, unknown>, "displayName"), now: now() };
    await db(c.env).prepare("INSERT INTO organizations (id, slug, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
      .bind(organization.id, organization.slug, organization.name, organization.now, organization.now)
      .run();
    return c.json({ organization: await organizationResource(c, { ...organization, state: "ACTIVE", billing_provider: "STRIPE", billing_state: "BETA_FREE", created_at: organization.now, updated_at: organization.now }) }, 201);
  })
  .get("/organizations/:organizationId", async (c) => {
    requireScope(c, "organizations.read");
    const organization = await resolveOrg(c, c.req.param("organizationId"));
    const row = await first<OrganizationRow>(db(c.env).prepare("SELECT * FROM organizations WHERE id = ?").bind(organization.id));
    return c.json({ organization: row ? await organizationResource(c, row) : null });
  })
  .patch("/organizations/:organizationId", async (c) => {
    requireScope(c, "organizations.write");
    const organization = await resolveOrg(c, c.req.param("organizationId"));
    const body = await jsonBody(c);
    const updateMask = requireString(body, "updateMask").split(",").map((field) => field.trim()).filter(Boolean);
    const allowed = new Set(["displayName", "state"]);
    if (updateMask.some((field) => !allowed.has(field))) {
      return c.json({ error: { code: "INVALID_ARGUMENT", message: "updateMask contains unknown fields" } }, 400);
    }
    const organizationBody = body.organization;
    if (!organizationBody || typeof organizationBody !== "object" || Array.isArray(organizationBody)) {
      return c.json({ error: { code: "INVALID_ARGUMENT", message: "organization is required" } }, 400);
    }
    const patch = organizationBody as Record<string, unknown>;
    const nextState = updateMask.includes("state") ? requireString(patch, "state").toUpperCase() : null;
    if (nextState && nextState !== "ACTIVE" && nextState !== "SUSPENDED") {
      return c.json({ error: { code: "INVALID_ARGUMENT", message: "state must be ACTIVE or SUSPENDED" } }, 400);
    }
    if (nextState && !isAdmin(c)) {
      return c.json({ error: { code: "PERMISSION_DENIED", message: "Organization state changes require admin" } }, 403);
    }
    await db(c.env).prepare("UPDATE organizations SET name = COALESCE(?, name), state = COALESCE(?, state), updated_at = ? WHERE id = ?")
      .bind(updateMask.includes("displayName") ? requireString(patch, "displayName") : null, nextState, now(), organization.id)
      .run();
    if (nextState) {
      await db(c.env).prepare("INSERT INTO admin_audit_events (id, actor_token_id, action, target_resource_name, outcome) VALUES (?, ?, ?, ?, ?)")
        .bind(id(), c.get("auth").tokenId, "organizations.patch_state", `organizations/${organization.slug}`, "SUCCESS")
        .run();
    }
    const row = await first<OrganizationRow>(db(c.env).prepare("SELECT * FROM organizations WHERE id = ?").bind(organization.id));
    return c.json({ organization: row ? await organizationResource(c, row) : null });
  })
  .delete("/organizations/:organizationId", async (c) => {
    requireScope(c, "organizations.write");
    const organization = await resolveOrg(c, c.req.param("organizationId"));
    await db(c.env).prepare("DELETE FROM organizations WHERE id = ?").bind(organization.id).run();
    return c.body(null, 204);
  });
