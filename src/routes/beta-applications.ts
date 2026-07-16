import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { AppEnv } from "../env";
import { recordAdminAudit } from "../lib/audit";
import { all, db, first, id, now } from "../lib/db";
import { jsonBody, optionalString, requireResourceId, requireScope, requireString } from "../lib/http";
import { privateBetaQuota, quotaError } from "../lib/quota";
import { verifyTurnstile } from "../lib/turnstile";

type BetaApplicationRow = {
  uid: string;
  email: string;
  applicant_name: string;
  company: string | null;
  use_case: string;
  state: "PENDING" | "APPROVED" | "REJECTED";
  organization_uid: string | null;
  reviewer_token_uid: string | null;
  review_note: string | null;
  create_time: string;
  update_time: string;
  review_time: string | null;
};

function betaApplicationResource(row: BetaApplicationRow) {
  return {
    name: `betaApplications/${row.uid}`,
    uid: row.uid,
    email: row.email,
    applicantName: row.applicant_name,
    company: row.company ?? undefined,
    useCase: row.use_case,
    state: row.state,
    organizationUid: row.organization_uid ?? undefined,
    reviewerTokenUid: row.reviewer_token_uid ?? undefined,
    reviewNote: row.review_note ?? undefined,
    createTime: row.create_time,
    updateTime: row.update_time,
    reviewTime: row.review_time ?? undefined,
  };
}

export const betaApplicationsPublic = new Hono<AppEnv>()
  .post("/betaApplications", async (c) => {
    const body = await jsonBody(c);
    const turnstileToken = requireString(body, "turnstileToken");
    await verifyTurnstile(c.env, turnstileToken, c.req.header("CF-Connecting-IP"));

    const database = db(c.env);
    const pending = await first<{ count: number }>(database.prepare("SELECT COUNT(*) AS count FROM beta_applications WHERE state = 'PENDING'").bind());
    if ((pending?.count ?? 0) >= privateBetaQuota.maxPendingApplications) {
      return quotaError(c, "Private beta application queue is full", { state: "THROTTLED", reason: "MAX_PENDING_APPLICATIONS_EXCEEDED", usagePercent: 100 });
    }

    const email = requireString(body, "email").toLowerCase();
    const existing = await first<BetaApplicationRow>(database.prepare("SELECT * FROM beta_applications WHERE lower(email) = ? AND state IN ('PENDING', 'APPROVED')").bind(email));
    if (existing) {
      return c.json({ application: betaApplicationResource(existing) }, 200);
    }

    const created = now();
    const uid = `ba_${id()}`;
    const applicantName = requireString(body, "applicantName");
    const company = optionalString(body, "company");
    const useCase = requireString(body, "useCase");
    await database.prepare("INSERT INTO beta_applications (uid, email, applicant_name, company, use_case, create_time, update_time) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind(uid, email, applicantName, company, useCase, created, created)
      .run();

    return c.json({ application: betaApplicationResource({ uid, email, applicant_name: applicantName, company, use_case: useCase, state: "PENDING", organization_uid: null, reviewer_token_uid: null, review_note: null, create_time: created, update_time: created, review_time: null }) }, 201);
  });

export const betaApplicationsAdmin = new Hono<AppEnv>()
  .get("/betaApplications", async (c) => {
    requireScope(c, "admin");
    const state = c.req.query("state")?.toUpperCase();
    if (state && !["PENDING", "APPROVED", "REJECTED"].includes(state)) {
      throw new HTTPException(400, { message: "state must be PENDING, APPROVED, or REJECTED" });
    }
    const rows = state
      ? await all<BetaApplicationRow>(db(c.env).prepare("SELECT * FROM beta_applications WHERE state = ? ORDER BY create_time DESC").bind(state))
      : await all<BetaApplicationRow>(db(c.env).prepare("SELECT * FROM beta_applications ORDER BY create_time DESC").bind());
    return c.json({ applications: rows.map(betaApplicationResource) });
  })
  .post("/betaApplications/:applicationUid\\:approve", async (c) => {
    requireScope(c, "admin");
    const database = db(c.env);
    const application = await first<BetaApplicationRow>(database.prepare("SELECT * FROM beta_applications WHERE uid = ?").bind(c.req.param("applicationUid")));
    if (!application) return c.notFound();
    if (application.state !== "PENDING") {
      throw new HTTPException(400, { message: "Application is not pending" });
    }

    const body = await jsonBody(c);
    const organizationId = requireResourceId(body, "organizationId");
    const displayName = optionalString(body, "displayName") ?? application.company ?? application.applicant_name;
    const reviewed = now();
    const organizationUid = `org_${id()}`;
    await database.batch([
      { sql: "INSERT INTO organizations (uid, organization_id, display_name, create_time, update_time) VALUES (?, ?, ?, ?, ?)", args: [organizationUid, organizationId, displayName, reviewed, reviewed] },
      { sql: "UPDATE beta_applications SET state = 'APPROVED', organization_uid = ?, reviewer_token_uid = ?, review_note = ?, review_time = ?, update_time = ? WHERE uid = ?", args: [organizationUid, c.get("auth").tokenId, optionalString(body, "reviewNote"), reviewed, reviewed, application.uid] },
    ]);
    await recordAdminAudit(c, { action: "beta_applications.approve", targetResourceName: `betaApplications/${application.uid}` });
    return c.json({ organization: { name: `organizations/${organizationId}`, uid: organizationUid, displayName, state: "ACTIVE" }, application: { ...betaApplicationResource(application), state: "APPROVED", organizationUid, reviewerTokenUid: c.get("auth").tokenId, reviewTime: reviewed, updateTime: reviewed } });
  })
  .post("/betaApplications/:applicationUid\\:reject", async (c) => {
    requireScope(c, "admin");
    const body = await jsonBody(c).catch(() => ({}));
    const reviewed = now();
    await db(c.env).prepare("UPDATE beta_applications SET state = 'REJECTED', reviewer_token_uid = ?, review_note = ?, review_time = ?, update_time = ? WHERE uid = ? AND state = 'PENDING'")
      .bind(c.get("auth").tokenId, optionalString(body, "reviewNote"), reviewed, reviewed, c.req.param("applicationUid"))
      .run();
    await recordAdminAudit(c, { action: "beta_applications.reject", targetResourceName: `betaApplications/${c.req.param("applicationUid")}` });
    return c.body(null, 204);
  });
