import "server-only";

type CheckoutInput = {
  origin: string;
  customerEmail: string;
  accessCode: string;
  organizationName: string;
};

export type StripeCheckoutSession = {
  id: string;
  url: string | null;
  payment_status: string | null;
  status: string | null;
  metadata?: Record<string, string>;
};

function stripeSecretKey(): string {
  return String(process.env.STRIPE_SECRET_KEY || "").trim();
}

function signupPriceId(): string {
  return String(process.env.STRIPE_SIGNUP_PRICE_ID || "").trim();
}

export function hasStripeBilling(): boolean {
  return Boolean(stripeSecretKey() && signupPriceId());
}

function authHeader() {
  return { Authorization: `Bearer ${stripeSecretKey()}` };
}

function formBody(params: Record<string, string>) {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    body.append(key, value);
  }
  return body;
}

export async function createSignupCheckoutSession(input: CheckoutInput): Promise<StripeCheckoutSession> {
  if (!hasStripeBilling()) {
    throw new Error("Stripe billing is not configured yet. Add STRIPE_SECRET_KEY and STRIPE_SIGNUP_PRICE_ID.");
  }
  const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: authHeader(),
    body: formBody({
      mode: "payment",
      success_url: `${input.origin}/auth/complete-signup?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${input.origin}/?tab=create-account&cancelled=1&code=${encodeURIComponent(input.accessCode)}&email=${encodeURIComponent(input.customerEmail)}`,
      customer_email: input.customerEmail,
      "line_items[0][price]": signupPriceId(),
      "line_items[0][quantity]": "1",
      "metadata[access_code]": input.accessCode,
      "metadata[organization_name]": input.organizationName,
    }),
  });

  const json = (await response.json()) as StripeCheckoutSession & { error?: { message?: string } };
  if (!response.ok) {
    throw new Error(json?.error?.message || "Failed to create Stripe checkout session.");
  }
  return json;
}

export async function retrieveCheckoutSession(sessionId: string): Promise<StripeCheckoutSession> {
  if (!stripeSecretKey()) {
    throw new Error("Stripe billing is not configured yet.");
  }
  const response = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`, {
    headers: authHeader(),
  });
  const json = (await response.json()) as StripeCheckoutSession & { error?: { message?: string } };
  if (!response.ok) {
    throw new Error(json?.error?.message || "Failed to load Stripe checkout session.");
  }
  return json;
}
