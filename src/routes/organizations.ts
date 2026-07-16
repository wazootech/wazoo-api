import { Hono, type Context } from "hono";
import type { AppEnv } from "../env";
import { recordAdminAudit } from "../lib/audit";
import { all, db, first, id, now } from "../lib/db";
import { isAdmin, jsonBody, requireResourceId, requireScope, requireString, resolveOrg } from "../lib/http";
import { quotaStatus } from "../lib/quota";

type OrganizationRow = { uid: string; organization_id: string; display_name: string; state: string; billing_provider?: string; billing_state?: string; stripe_customer_id?: string | null; create_time?: string; update_time?: string; delete_time?: string | null; expire_time?: string | null };

async function organizationResource(c: Context<AppEnv>, row: OrganizationRow) {
  return {
    name: `organizations/${row.organization_id}`,
    uid: row.uid,
    displayName: row.display_name,
    state: row.state,
    quota: await quotaStatus(c, row.uid, row.state),
    billing: {
      state: row.billing_state ?? "BETA_FREE",
      provider: row.billing_provider ?? "STRIPE",
      customerConfigured: Boolean(row.stripe_customer_id),
      paymentRequired: false,
    },
    createTime: row.create_time,
    updateTime: row.update_time,
    deleteTime: row.delete_time ?? undefined,
    expireTime: row.expire_time ?? undefined,
  };
}

export const organizations = new Hono<AppEnv>()
  .get("/organizations", async (c) => {
    requireScope(c, "organizations.read");
    const auth = c.get("auth");
    const database = db(c.env);
    const rows = auth.organizationUid
      ? await all(database.prepare("SELECT * FROM organizations WHERE uid = ? AND state != 'DELETED' ORDER BY create_time DESC").bind(auth.organizationUid))
      : await all(database.prepare("SELECT * FROM organizations WHERE state != 'DELETED' ORDER BY create_time DESC"));
    return c.json({ organizations: await Promise.all(rows.map((row) => organizationResource(c, row as OrganizationRow))) });
  })
  .post("/organizations", async (c) => {
    requireScope(c, "organizations.write");
    const body = await jsonBody(c);
    const organizationBody = body.organization;
    if (!organizationBody || typeof organizationBody !== "object" || Array.isArray(organizationBody)) {
      return c.json({ error: { code: "INVALID_ARGUMENT", message: "organization is required" } }, 400);
    }
    const organization = { uid: `org_${id()}`, organizationId: requireResourceId(body, "organizationId"), displayName: requireString(organizationBody as Record<string, unknown>, "displayName"), now: now() };
    await db(c.env).prepare("INSERT INTO organizations (uid, organization_id, display_name, create_time, update_time) VALUES (?, ?, ?, ?, ?)")
      .bind(organization.uid, organization.organizationId, organization.displayName, organization.now, organization.now)
      .run();
    return c.json({ organization: await organizationResource(c, { uid: organization.uid, organization_id: organization.organizationId, display_name: organization.displayName, state: "ACTIVE", billing_provider: "STRIPE", billing_state: "BETA_FREE", create_time: organization.now, update_time: organization.now }) }, 201);
  })
  .get("/organizations/:organizationId", async (c) => {
    requireScope(c, "organizations.read");
    const organization = await resolveOrg(c, c.req.param("organizationId"));
    const row = await first<OrganizationRow>(db(c.env).prepare("SELECT * FROM organizations WHERE uid = ?").bind(organization.uid));
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
    await db(c.env).prepare("UPDATE organizations SET display_name = COALESCE(?, display_name), state = COALESCE(?, state), update_time = ? WHERE uid = ?")
      .bind(updateMask.includes("displayName") ? requireString(patch, "displayName") : null, nextState, now(), organization.uid)
      .run();
    if (nextState) {
      await recordAdminAudit(c, { action: "organizations.patch_state", targetResourceName: `organizations/${organization.organizationId}` });
    }
    const row = await first<OrganizationRow>(db(c.env).prepare("SELECT * FROM organizations WHERE uid = ?").bind(organization.uid));
    return c.json({ organization: row ? await organizationResource(c, row) : null });
  })
  .delete("/organizations/:organizationId", async (c) => {
    requireScope(c, "organizations.write");
    const organization = await resolveOrg(c, c.req.param("organizationId"));
    const deleteTime = now();
    const expireTime = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    await db(c.env).prepare("UPDATE organizations SET state = 'DELETED', delete_time = ?, expire_time = ?, purge_status = 'pending', update_time = ? WHERE uid = ?")
      .bind(deleteTime, expireTime, deleteTime, organization.uid)
      .run();
    const row = await first<OrganizationRow>(db(c.env).prepare("SELECT * FROM organizations WHERE uid = ?").bind(organization.uid));
    return c.json({ organization: row ? await organizationResource(c, row) : null });
  });
