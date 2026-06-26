// Stripe billing webhook (Phase 11 scaffold — "future"). Inert until
// STRIPE_WEBHOOK_SECRET is set (returns 503). When configured it verifies the
// Stripe signature (HMAC-SHA256, no SDK dependency) and upserts tenant_billing
// from subscription/checkout events. Tenant is resolved via the checkout
// session's client_reference_id / subscription metadata.tenantId.
import crypto from "node:crypto";
import type { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { tenantBilling } from "@/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TOLERANCE_SECS = 300;

/** Verify a Stripe-Signature header against the raw payload (constant-time). */
function verifySignature(payload: string, header: string, secret: string): boolean {
  const items = header.split(",").map((p) => p.split("="));
  const t = items.find(([k]) => k === "t")?.[1];
  const sigs = items.filter(([k]) => k === "v1").map(([, v]) => v);
  if (!t || sigs.length === 0) return false;
  const ts = Number(t);
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > TOLERANCE_SECS)
    return false;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${t}.${payload}`)
    .digest("hex");
  const exp = Buffer.from(expected);
  return sigs.some((s) => {
    const buf = Buffer.from(s);
    return buf.length === exp.length && crypto.timingSafeEqual(buf, exp);
  });
}

type StripeEvent = {
  type: string;
  data: { object: Record<string, unknown> };
};

export async function POST(req: NextRequest) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret)
    return Response.json({ error: "Billing not configured" }, { status: 503 });

  const sig = req.headers.get("stripe-signature");
  const payload = await req.text();
  if (!sig || !verifySignature(payload, sig, secret))
    return Response.json({ error: "Invalid signature" }, { status: 400 });

  let event: StripeEvent;
  try {
    event = JSON.parse(payload) as StripeEvent;
  } catch {
    return Response.json({ error: "Invalid payload" }, { status: 400 });
  }

  const obj = event.data.object as Record<string, unknown>;
  const tenantId =
    (obj.client_reference_id as string | undefined) ??
    ((obj.metadata as Record<string, string> | undefined)?.tenantId ?? null);

  try {
    switch (event.type) {
      case "checkout.session.completed":
      case "customer.subscription.created":
      case "customer.subscription.updated": {
        if (!tenantId) break;
        const periodEnd = obj.current_period_end as number | undefined;
        await db
          .insert(tenantBilling)
          .values({
            tenantId,
            plan: "pro",
            status: (obj.status as typeof tenantBilling.status.enumValues[number]) ?? "active",
            stripeCustomerId: (obj.customer as string) ?? null,
            stripeSubscriptionId:
              (obj.subscription as string) ?? (obj.id as string) ?? null,
            currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000) : null,
            updatedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: tenantBilling.tenantId,
            set: {
              plan: "pro",
              status: (obj.status as typeof tenantBilling.status.enumValues[number]) ?? "active",
              stripeCustomerId: (obj.customer as string) ?? null,
              currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000) : null,
              updatedAt: new Date(),
            },
          });
        break;
      }
      case "customer.subscription.deleted": {
        if (!tenantId) break;
        await db
          .update(tenantBilling)
          .set({ plan: "free", status: "canceled", updatedAt: new Date() })
          .where(eq(tenantBilling.tenantId, tenantId));
        break;
      }
      default:
        break; // ignore unhandled event types
    }
  } catch {
    // Acknowledge anyway so Stripe doesn't hammer retries on a transient DB blip;
    // monitoring (Sentry) surfaces the failure separately.
    return Response.json({ received: true, applied: false });
  }

  return Response.json({ received: true });
}
