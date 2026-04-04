import { NextRequest, NextResponse } from "next/server";
import { createSessionForUser, createUserFromAccessCode, findAccessCode, logUsageEvent } from "@/lib/auth";
import { setPendingSignup } from "@/lib/pending-signup";
import { createSignupCheckoutSession, hasStripeBilling } from "@/lib/stripe";

function redirectHome(req: NextRequest, params: Record<string, string>) {
  const url = req.nextUrl.clone();
  url.pathname = "/";
  url.search = "";
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return NextResponse.redirect(url);
}

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const email = String(form.get("email") || "").trim().toLowerCase();
  const password = String(form.get("password") || "");
  const accessCode = String(form.get("accessCode") || "").trim();

  if (!email || !password || !accessCode) {
    return redirectHome(req, {
      tab: "create-account",
      error: "Enter your email, password, and one-time access code.",
      email,
      code: accessCode,
    });
  }

  if (!/^\d{6}$/.test(accessCode)) {
    return redirectHome(req, {
      tab: "create-account",
      error: "Access codes must be 6 digits.",
      email,
      code: accessCode,
    });
  }

  const preview = await findAccessCode(accessCode);
  if (!preview) {
    return redirectHome(req, { tab: "create-account", error: "That access code was not found.", email });
  }

  const origin = req.nextUrl.origin;
  try {
    const created = await createUserFromAccessCode({ email, password, accessCode });
    if (created.requiresPayment) {
      if (!hasStripeBilling()) {
        return redirectHome(req, {
          tab: "create-account",
          error: "This code requires payment, but Stripe is not configured yet.",
          email,
          code: accessCode,
        });
      }
      await setPendingSignup({ email, password, accessCode });
      const checkout = await createSignupCheckoutSession({
        origin,
        customerEmail: email,
        accessCode,
        organizationName: created.organizationName,
      });
      if (!checkout.url) {
        throw new Error("Stripe did not return a checkout URL.");
      }
      return NextResponse.redirect(checkout.url);
    }

    await createSessionForUser(created.userId);
    const user = await findAccessCode(accessCode);
    if (user) {
      await logUsageEvent({
        organizationId: user.organization_id,
        userId: created.userId,
        eventType: "login",
        email,
        path: "/cards",
        source: "signup_complete",
      });
    }
    const url = req.nextUrl.clone();
    url.pathname = "/cards";
    url.search = "notice=Account created successfully.";
    return NextResponse.redirect(url);
  } catch (error) {
    return redirectHome(req, {
      tab: "create-account",
      error: error instanceof Error ? error.message : "Could not create your account.",
      email,
      code: accessCode,
    });
  }
}
