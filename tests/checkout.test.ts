import { describe, expect, it } from "vitest";
import { encodeStripeParams, verifyStripeSignature } from "../src/lib/stripe";
import {
  state,
  stripeUrl,
  sign,
  WEBHOOK_SECRET,
  useCheckoutHarness,
} from "./helpers/checkout-harness";

describe("stripe helpers", () => {
  it("form-encodes nested params the way Stripe expects", () => {
    expect(
      encodeStripeParams({
        mode: "subscription",
        line_items: [{ price: "price_1", quantity: 1 }],
        metadata: { user_uid: "u 1" },
        skip: undefined,
        none: null,
      }).sort(),
    ).toEqual(
      [
        "line_items%5B0%5D%5Bprice%5D=price_1",
        "line_items%5B0%5D%5Bquantity%5D=1",
        "metadata%5Buser_uid%5D=u%201",
        "mode=subscription",
      ].sort(),
    );
  });

  describe("verifyStripeSignature", () => {
    const body = '{"id":"evt_1"}';
    const now = 1_800_000_000;

    it("accepts a fresh, correct signature, and any matching v1", async () => {
      const header = await sign(body, WEBHOOK_SECRET, now);
      expect(
        await verifyStripeSignature(body, header, WEBHOOK_SECRET, now),
      ).toBe(true);
      const withOld = `${header},v1=${"0".repeat(64)}`;
      expect(
        await verifyStripeSignature(body, withOld, WEBHOOK_SECRET, now),
      ).toBe(true);
    });

    it("rejects a replayed (old) or future-dated signature", async () => {
      const old = await sign(body, WEBHOOK_SECRET, now - 301);
      const future = await sign(body, WEBHOOK_SECRET, now + 301);
      expect(await verifyStripeSignature(body, old, WEBHOOK_SECRET, now)).toBe(
        false,
      );
      expect(
        await verifyStripeSignature(body, future, WEBHOOK_SECRET, now),
      ).toBe(false);
      const edge = await sign(body, WEBHOOK_SECRET, now - 300);
      expect(await verifyStripeSignature(body, edge, WEBHOOK_SECRET, now)).toBe(
        true,
      );
    });

    it("rejects a wrong secret, a changed body, and malformed headers", async () => {
      const header = await sign(body, WEBHOOK_SECRET, now);
      expect(
        await verifyStripeSignature(body, header, "whsec_other", now),
      ).toBe(false);
      expect(
        await verifyStripeSignature(body + " ", header, WEBHOOK_SECRET, now),
      ).toBe(false);
      for (const bad of [
        "",
        "t=1",
        "v1=abcd",
        `t=x,v1=${"a".repeat(64)}`,
        `t=${now},v1=zz`,
        `t=${now},v1=abc`,
      ]) {
        expect(
          await verifyStripeSignature(body, bad, WEBHOOK_SECRET, now),
          bad,
        ).toBe(false);
      }
    });
  });
});

describe("checkout, portal and subscription webhooks", () => {
  const h = useCheckoutHarness();
  const { api, asUser, run } = h;

  describe("POST /v1/users/me/billing/checkout", () => {
    it("starts a subscription checkout for the user and returns the hosted URL", async () => {
      const res = await asUser("/v1/users/me/billing/checkout");
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ url: stripeUrl });

      expect(state.stripeCalls).toHaveLength(1);
      const { path, params } = state.stripeCalls[0]!;
      expect(path).toBe("/v1/checkout/sessions");
      expect(params.get("mode")).toBe("subscription");
      expect(params.get("line_items[0][price]")).toBe("price_pro");
      expect(params.get("line_items[0][quantity]")).toBe("1");
      expect(params.get("client_reference_id")).toBe(h.userUid);
      expect(params.get("customer_email")).toBe("payer@example.com");
      expect(params.get("customer")).toBeNull();
      expect(params.get("metadata[user_uid]")).toBe(h.userUid);
      expect(params.get("subscription_data[metadata][user_uid]")).toBe(
        h.userUid,
      );
      // Return URLs come from configuration, never from the request.
      expect(params.get("success_url")).toBe(
        "https://console-qa.wazoo.dev/settings?checkout=success",
      );
      expect(params.get("cancel_url")).toBe(
        "https://console-qa.wazoo.dev/settings?checkout=cancelled",
      );
    });

    it("reuses the Stripe customer for a returning user", async () => {
      run(
        "UPDATE users SET stripe_customer_id = 'cus_1' WHERE uid = ?",
        h.userUid,
      );
      await asUser("/v1/users/me/billing/checkout");
      const { params } = state.stripeCalls[0]!;
      expect(params.get("customer")).toBe("cus_1");
      expect(params.get("customer_email")).toBeNull();
    });

    it("is unavailable until Stripe and the console URL are configured", async () => {
      for (const missing of [
        "STRIPE_SECRET_KEY",
        "STRIPE_PRICE_ID",
        "CONSOLE_URL",
      ] as const) {
        const res = await asUser("/v1/users/me/billing/checkout", "POST", {
          ...h.env,
          [missing]: "",
        });
        expect(res.status, missing).toBe(503);
        expect(
          ((await res.json()) as { error: { code: string } }).error.code,
        ).toBe("BILLING_NOT_CONFIGURED");
      }
      expect(state.stripeCalls).toHaveLength(0);
    });

    it("refuses a user who is already subscribed to Pro", async () => {
      run(
        "UPDATE users SET plan = 'pro', stripe_subscription_id = 'sub_1' WHERE uid = ?",
        h.userUid,
      );
      const res = await asUser("/v1/users/me/billing/checkout");
      expect(res.status).toBe(409);
      expect(
        ((await res.json()) as { error: { code: string } }).error.code,
      ).toBe("ALREADY_SUBSCRIBED");
      expect(state.stripeCalls).toHaveLength(0);
    });

    it("hides Stripe's error text behind a generic 502", async () => {
      state.stripeStatus = 400;
      const res = await asUser("/v1/users/me/billing/checkout");
      expect(res.status).toBe(502);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe("STRIPE_ERROR");
      expect(JSON.stringify(body)).not.toContain("price_bad");
    });

    it("requires a signed-in user", async () => {
      const res = await api("/v1/users/me/billing/checkout", {
        method: "POST",
      });
      expect(res.status).toBe(401);
    });
  });

  describe("POST /v1/users/me/billing/portal", () => {
    it("opens the portal for a user with a Stripe customer", async () => {
      run(
        "UPDATE users SET stripe_customer_id = 'cus_9' WHERE uid = ?",
        h.userUid,
      );
      const res = await asUser("/v1/users/me/billing/portal");
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ url: stripeUrl });
      const { path, params } = state.stripeCalls[0]!;
      expect(path).toBe("/v1/billing_portal/sessions");
      expect(params.get("customer")).toBe("cus_9");
      expect(params.get("return_url")).toBe(
        "https://console-qa.wazoo.dev/settings",
      );
    });

    it("has nothing to open before the first checkout", async () => {
      const res = await asUser("/v1/users/me/billing/portal");
      expect(res.status).toBe(409);
      expect(
        ((await res.json()) as { error: { code: string } }).error.code,
      ).toBe("NO_BILLING_ACCOUNT");
    });
  });

  describe("GET /v1/users/me/plan billing flags", () => {
    it("offers checkout to a free user, and the portal once they have a customer", async () => {
      let plan = (await (await asUser("/v1/users/me/plan", "GET")).json()) as {
        billing: unknown;
      };
      expect(plan.billing).toEqual({
        checkoutAvailable: true,
        portalAvailable: false,
      });
      run(
        "UPDATE users SET plan = 'pro', stripe_customer_id = 'cus_1' WHERE uid = ?",
        h.userUid,
      );
      plan = (await (await asUser("/v1/users/me/plan", "GET")).json()) as {
        billing: unknown;
      };
      expect(plan.billing).toEqual({
        checkoutAvailable: false,
        portalAvailable: true,
      });
    });

    it("offers nothing when billing is not configured", async () => {
      const plan = (await (
        await asUser("/v1/users/me/plan", "GET", {
          ...h.env,
          STRIPE_PRICE_ID: "",
        })
      ).json()) as { billing: unknown };
      expect(plan.billing).toEqual({
        checkoutAvailable: false,
        portalAvailable: false,
      });
    });
  });
});
