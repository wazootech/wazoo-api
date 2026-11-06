import { describe, expect, it } from "vitest";

import {
  state,
  sign,
  WEBHOOK_SECRET,
  useCheckoutHarness,
} from "./helpers/checkout-harness";

describe("checkout, portal and subscription webhooks", () => {
  const h = useCheckoutHarness();
  const { api, rows, run, userRow, webhook, budgetPuts } = h;

  describe("webhook", () => {
    it("moves the user to Pro and applies the Pro budget when checkout completes", async () => {
      const res = await webhook("checkout.session.completed", {
        mode: "subscription",
        client_reference_id: h.userUid,
        customer: "cus_new",
        subscription: "sub_new",
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ received: true, handled: true });
      expect(userRow()).toEqual({
        plan: "pro",
        stripe_customer_id: "cus_new",
        stripe_subscription_id: "sub_new",
      });
      expect(budgetPuts().at(-1)).toMatchObject({
        path: `/admin/namespaces/${h.userUid}/write-budget`,
        body: { dailyRows: 1_000_000 },
      });
    });

    it("ignores a redelivered event", async () => {
      const object = {
        mode: "subscription",
        client_reference_id: h.userUid,
        customer: "cus_d",
        subscription: "sub_d",
      };
      await webhook("checkout.session.completed", object, "evt_dup");
      state.worldsCalls = [];
      run("UPDATE users SET plan = 'free' WHERE uid = ?", h.userUid);
      const again = await webhook(
        "checkout.session.completed",
        object,
        "evt_dup",
      );
      expect(again.status).toBe(200);
      expect(await again.json()).toEqual({ received: true, duplicate: true });
      expect(state.worldsCalls).toHaveLength(0);
      expect(userRow().plan).toBe("free");
    });

    it("keeps Pro while a payment is past due, and drops to free once cancelled", async () => {
      run(
        "UPDATE users SET plan = 'pro', stripe_customer_id = 'cus_p', stripe_subscription_id = 'sub_p' WHERE uid = ?",
        h.userUid,
      );
      await webhook("customer.subscription.updated", {
        id: "sub_p",
        customer: "cus_p",
        status: "past_due",
      });
      expect(userRow().plan).toBe("pro");

      await webhook("customer.subscription.updated", {
        id: "sub_p",
        customer: "cus_p",
        status: "canceled",
      });
      expect(userRow()).toEqual({
        plan: "free",
        stripe_customer_id: "cus_p",
        stripe_subscription_id: null,
      });
      expect(budgetPuts().at(-1)?.body).toEqual({ dailyRows: 50_000 });
    });

    it("returns the user to free when the subscription is deleted", async () => {
      run(
        "UPDATE users SET plan = 'pro', stripe_customer_id = 'cus_q', stripe_subscription_id = 'sub_q' WHERE uid = ?",
        h.userUid,
      );
      const res = await webhook("customer.subscription.deleted", {
        id: "sub_q",
        customer: "cus_q",
        status: "canceled",
      });
      expect(await res.json()).toEqual({ received: true, handled: true });
      expect(userRow().plan).toBe("free");
    });

    it("does not downgrade for a late event about an old subscription", async () => {
      run(
        "UPDATE users SET plan = 'pro', stripe_customer_id = 'cus_r', stripe_subscription_id = 'sub_new' WHERE uid = ?",
        h.userUid,
      );
      const res = await webhook("customer.subscription.deleted", {
        id: "sub_old",
        customer: "cus_r",
        status: "canceled",
      });
      expect(await res.json()).toEqual({ received: true, handled: false });
      expect(userRow()).toMatchObject({
        plan: "pro",
        stripe_subscription_id: "sub_new",
      });
    });

    it("finds the user from subscription metadata when the customer is not stored yet", async () => {
      await webhook("customer.subscription.created", {
        id: "sub_m",
        customer: "cus_m",
        status: "active",
        metadata: { user_uid: h.userUid },
      });
      expect(userRow()).toEqual({
        plan: "pro",
        stripe_customer_id: "cus_m",
        stripe_subscription_id: "sub_m",
      });
    });

    it("acknowledges events for unknown users and other event types without changing anything", async () => {
      const unknown = await webhook("customer.subscription.updated", {
        id: "sub_x",
        customer: "cus_nobody",
        status: "active",
      });
      expect(unknown.status).toBe(200);
      expect(await unknown.json()).toEqual({ received: true, handled: false });
      const other = await webhook("invoice.paid", { id: "in_1" });
      expect(await other.json()).toEqual({ received: true, handled: false });
      const payment = await webhook("checkout.session.completed", {
        mode: "payment",
        client_reference_id: h.userUid,
      });
      expect(await payment.json()).toEqual({ received: true, handled: false });
      expect(userRow().plan).toBe("free");
    });

    it("answers 500 so Stripe retries when the data plane refuses the budget, then succeeds on retry", async () => {
      state.worldsBudgetStatus = 500;
      const object = {
        mode: "subscription",
        client_reference_id: h.userUid,
        customer: "cus_f",
        subscription: "sub_f",
      };
      const failed = await webhook(
        "checkout.session.completed",
        object,
        "evt_retry",
      );
      expect(failed.status).toBe(500);
      expect(
        rows("SELECT 1 FROM stripe_events WHERE event_id = 'evt_retry'"),
      ).toHaveLength(0);

      state.worldsBudgetStatus = 200;
      const retried = await webhook(
        "checkout.session.completed",
        object,
        "evt_retry",
      );
      expect(retried.status).toBe(200);
      expect(await retried.json()).toEqual({ received: true, handled: true });
      expect(
        rows("SELECT 1 FROM stripe_events WHERE event_id = 'evt_retry'"),
      ).toHaveLength(1);
    });

    it("rejects a bad signature, a stale timestamp, and a body that is not an event", async () => {
      const payload = JSON.stringify({
        id: "evt_s",
        type: "checkout.session.completed",
        data: { object: {} },
      });
      const forged = await api("/v1/stripe/webhook", {
        method: "POST",
        headers: { "stripe-signature": await sign(payload, "whsec_other") },
        body: payload,
      });
      expect(forged.status).toBe(401);
      const stale = await api("/v1/stripe/webhook", {
        method: "POST",
        headers: {
          "stripe-signature": await sign(
            payload,
            WEBHOOK_SECRET,
            Math.floor(Date.now() / 1000) - 3600,
          ),
        },
        body: payload,
      });
      expect(stale.status).toBe(401);

      for (const body of ["not json", JSON.stringify({ hello: "world" })]) {
        const res = await api("/v1/stripe/webhook", {
          method: "POST",
          headers: { "stripe-signature": await sign(body) },
          body,
        });
        expect(res.status, body).toBe(400);
      }
    });
  });
});
