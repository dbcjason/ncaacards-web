import { NextRequest, NextResponse } from "next/server";
import { createAccessCode, createBillingRecord, createOrganizationAccount, generateUniqueAccessCode, normalizeAccessScope, normalizeAccountType, requireAdminUser } from "@/lib/auth";
import { sendAccessCodeEmail } from "@/lib/email";

function redirectDashboard(req: NextRequest, tab: string, kind: "notice" | "error", message: string) {
  const url = req.nextUrl.clone();
  url.pathname = "/dashboard";
  url.search = "";
  url.searchParams.set("tab", tab);
  url.searchParams.set(kind, message);
  return NextResponse.redirect(url);
}

export async function POST(req: NextRequest) {
  await requireAdminUser();
  const form = await req.formData();
  try {
    const organizationName = String(form.get("organizationName") || "").trim();
    if (!organizationName) {
      throw new Error("Organization name is required.");
    }
    const accountType = normalizeAccountType(String(form.get("accountType") || "paid"));
    const requiresPayment = String(form.get("requiresPayment") || "") === "on";
    const recipientEmail = String(form.get("recipientEmail") || "").trim().toLowerCase();
    const sendInvite = String(form.get("sendInvite") || "") === "on";
    if (sendInvite && !recipientEmail) {
      throw new Error("Recipient email is required when sending the access code.");
    }
    const organization = await createOrganizationAccount({
      organizationName,
      accountType,
      accessScope: normalizeAccessScope(String(form.get("accessScope") || "both")),
      requiresPayment,
      notes: String(form.get("notes") || "").trim() || undefined,
      contractStartsAt: String(form.get("contractStartsAt") || "").trim() || null,
      contractEndsAt: String(form.get("contractEndsAt") || "").trim() || null,
      expiresAt: String(form.get("expiresAt") || "").trim() || null,
    });
    await createBillingRecord({
      organizationId: String(organization.id),
      provider: requiresPayment ? "manual" : "manual",
      status: requiresPayment ? "pending" : "not_required",
      notes: requiresPayment ? "Awaiting payment setup or manual confirmation." : "Free or comped account.",
      currentPeriodEnd: String(form.get("contractEndsAt") || "").trim() || null,
    });
    const accessScope = normalizeAccessScope(String(form.get("accessScope") || "both"));
    const accessCode = String(form.get("accessCode") || "").trim() || await generateUniqueAccessCode(6);
    const expiresAt = String(form.get("expiresAt") || "").trim() || null;
    await createAccessCode({
      organizationId: String(organization.id),
      code: accessCode,
      accountType,
      accessScope,
      requiresPayment,
      maxUses: 1,
      expiresAt,
    });

    if (sendInvite) {
      const signUpUrl = `https://www.dbcjason.com/?tab=create-account&code=${encodeURIComponent(accessCode)}&email=${encodeURIComponent(recipientEmail)}`;
      const emailResult = await sendAccessCodeEmail({
        to: recipientEmail,
        organizationName,
        accessCode,
        accessScope,
        accountType,
        signUpUrl,
        expiresAt,
      });
      if (!emailResult.ok) {
        throw new Error(`Organization and access code created, but email failed: ${emailResult.error}`);
      }
      return redirectDashboard(req, "accounts", "notice", `Organization created for ${organizationName}. Access code ${accessCode} was emailed to ${recipientEmail}.`);
    }

    return redirectDashboard(req, "accounts", "notice", `Organization created: ${organizationName}. Access code ${accessCode} is ready.`);
  } catch (error) {
    return redirectDashboard(req, "accounts", "error", error instanceof Error ? error.message : "Could not create organization.");
  }
}
