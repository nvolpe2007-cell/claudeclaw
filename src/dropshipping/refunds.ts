import { loadDsConfig } from "./dsConfig";
import { loadRefunds, updateRefund, type RefundRequest } from "./store";

export interface RefundResult {
  success: boolean;
  processorRefundId?: string;
  error?: string;
}

// ─── Stripe ────────────────────────────────────────────────────────────────

async function stripeRefund(paymentIntentId: string, amount: number, secretKey: string): Promise<RefundResult> {
  try {
    const body = new URLSearchParams({
      payment_intent: paymentIntentId,
      amount: String(Math.round(amount * 100)), // Stripe uses cents
    });

    const res = await fetch("https://api.stripe.com/v1/refunds", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${secretKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    });

    const json = await res.json() as { id?: string; error?: { message: string } };
    if (json.error) return { success: false, error: json.error.message };
    return { success: true, processorRefundId: json.id };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

// ─── PayPal ────────────────────────────────────────────────────────────────

async function getPayPalToken(clientId: string, clientSecret: string, sandbox: boolean): Promise<string | null> {
  const base = sandbox ? "https://api-m.sandbox.paypal.com" : "https://api-m.paypal.com";
  try {
    const res = await fetch(`${base}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        "Authorization": `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    });
    const json = await res.json() as { access_token?: string };
    return json.access_token ?? null;
  } catch {
    return null;
  }
}

async function paypalRefund(
  captureId: string,
  amount: number,
  currency: string,
  clientId: string,
  clientSecret: string,
  sandbox: boolean
): Promise<RefundResult> {
  const token = await getPayPalToken(clientId, clientSecret, sandbox);
  if (!token) return { success: false, error: "Failed to get PayPal access token" };

  const base = sandbox ? "https://api-m.sandbox.paypal.com" : "https://api-m.paypal.com";
  try {
    const res = await fetch(`${base}/v2/payments/captures/${captureId}/refund`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        amount: { value: amount.toFixed(2), currency_code: currency },
        note_to_payer: "Refund processed by store",
      }),
    });
    const json = await res.json() as { id?: string; message?: string; name?: string };
    if (json.name) return { success: false, error: json.message ?? json.name };
    return { success: true, processorRefundId: json.id };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

// ─── Public API ────────────────────────────────────────────────────────────

/**
 * Process a refund against the configured payment processor.
 * `transactionRef` is the Stripe payment_intent ID or PayPal capture ID.
 */
export async function processRefund(
  refundId: string,
  transactionRef: string,
  currency = "USD"
): Promise<RefundResult> {
  const refunds = await loadRefunds();
  const refund = refunds.find((r) => r.id === refundId);
  if (!refund) return { success: false, error: `Refund ${refundId} not found` };
  if (refund.status === "processed") return { success: false, error: "Refund already processed" };

  const config = await loadDsConfig();
  const { processor } = config.payment;
  let result: RefundResult;

  if (processor === "stripe") {
    if (!config.payment.stripeSecretKey) {
      return { success: false, error: "Stripe secret key not configured. Run: dropshipping setup:payment" };
    }
    result = await stripeRefund(transactionRef, refund.amount, config.payment.stripeSecretKey);
  } else if (processor === "paypal") {
    if (!config.payment.paypalClientId || !config.payment.paypalClientSecret) {
      return { success: false, error: "PayPal credentials not configured. Run: dropshipping setup:payment" };
    }
    result = await paypalRefund(
      transactionRef,
      refund.amount,
      currency,
      config.payment.paypalClientId,
      config.payment.paypalClientSecret,
      config.payment.paypalSandbox
    );
  } else {
    // Manual processor — just mark as processed
    result = { success: true, processorRefundId: `MANUAL-${Date.now()}` };
  }

  if (result.success) {
    await updateRefund(refundId, {
      status: "processed",
      processorRefundId: result.processorRefundId ?? null,
      notes: `${refund.notes ? refund.notes + "\n" : ""}Processed via ${processor}`,
    });
  }

  return result;
}

/** Summarize pending refunds for the agent report. */
export async function refundSummary(): Promise<{
  pending: number;
  processed: number;
  denied: number;
  totalPending: number;
}> {
  const refunds = await loadRefunds();
  return {
    pending: refunds.filter((r) => r.status === "pending").length,
    processed: refunds.filter((r) => r.status === "processed").length,
    denied: refunds.filter((r) => r.status === "denied").length,
    totalPending: refunds.filter((r) => r.status === "pending").reduce((s, r) => s + r.amount, 0),
  };
}
