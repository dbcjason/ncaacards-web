import { redirect } from "next/navigation";
import { clearPendingSignup, getPendingSignup } from "@/lib/pending-signup";
import { createSessionForUser, createUserFromAccessCode, findAccessCode, logUsageEvent } from "@/lib/auth";
import { retrieveCheckoutSession } from "@/lib/stripe";

type CompleteSignupPageProps = {
  searchParams: Promise<{
    session_id?: string;
  }>;
};

export default async function CompleteSignupPage({ searchParams }: CompleteSignupPageProps) {
  const { session_id: sessionId } = await searchParams;
  if (!sessionId) {
    redirect("/?tab=create-account&error=Missing Stripe session.");
  }

  const pending = await getPendingSignup();
  if (!pending) {
    redirect("/?tab=create-account&error=Your signup session expired. Please try again.");
  }

  try {
    const session = await retrieveCheckoutSession(sessionId);
    if (session.payment_status !== "paid") {
      redirect("/?tab=create-account&error=Payment was not completed.");
    }

    const created = await createUserFromAccessCode({
      email: pending.email,
      password: "",
      passwordHash: pending.passwordHash,
      accessCode: pending.accessCode,
      paymentConfirmed: true,
    });

    await clearPendingSignup();
    await createSessionForUser(created.userId);

    const code = await findAccessCode(pending.accessCode);
    if (code) {
      await logUsageEvent({
        organizationId: code.organization_id,
        userId: created.userId,
        eventType: "login",
        email: pending.email,
        path: "/cards",
        source: "stripe_signup_complete",
      });
    }

    redirect("/cards?notice=Account created and payment confirmed.");
  } catch (error) {
    await clearPendingSignup();
    redirect(`/?tab=create-account&error=${encodeURIComponent(error instanceof Error ? error.message : "Could not complete signup.")}`);
  }
}
