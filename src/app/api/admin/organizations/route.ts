import { NextRequest, NextResponse } from "next/server";
import { createBillingRecord, createOrganizationAccount, normalizeAccessScope, normalizeAccountType, requireAdminUser } from "@/lib/auth";

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
    return redirectDashboard(req, "accounts", "notice", `Organization created: ${organizationName}`);
  } catch (error) {
    return redirectDashboard(req, "accounts", "error", error instanceof Error ? error.message : "Could not create organization.");
  }
}
