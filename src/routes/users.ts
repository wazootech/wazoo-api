import { Hono } from "hono";
import type { AppEnv } from "../env";
import { db } from "../lib/db";
import { requireScope } from "../lib/http";

export const users = new Hono<AppEnv>()
  .get("/users/me", async (c) => {
    requireScope(c, "organizations.read");
    const email = c.req.query("email");
    if (!email) {
      return c.json({ error: { code: "INVALID_ARGUMENT", message: "email query parameter is required" } }, 400);
    }
    const database = db(c.env);
    const existing = await database.prepare("SELECT uid, email, display_name, create_time FROM users WHERE email = ?")
      .bind(email.toLowerCase()).first<{ uid: string; email: string; display_name: string | null; create_time: string }>();
    if (existing) {
      return c.json({ user: { uid: existing.uid, email: existing.email, displayName: existing.display_name, createTime: existing.create_time } });
    }
    const uid = crypto.randomUUID();
    await database.prepare("INSERT INTO users (uid, email) VALUES (?, ?)").bind(uid, email.toLowerCase()).run();
    const row = await database.prepare("SELECT uid, email, display_name, create_time FROM users WHERE uid = ?")
      .bind(uid).first<{ uid: string; email: string; display_name: string | null; create_time: string }>();
    return c.json({ user: { uid: row!.uid, email: row!.email, displayName: row!.display_name, createTime: row!.create_time } }, 201);
  });
