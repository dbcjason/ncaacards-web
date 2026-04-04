import { NextRequest, NextResponse } from "next/server";
import { createAccessCode, generateUniqueAccessCode, normalizeAccessScope, normalizeAccountType, requireAdminUser } from "@/lib/auth";
import { sendAccessCodeEmail } from "@/lib/email";
import { dbQueryOne } from "@/lib/db";

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
    const organizationId = String(form.get("organizationId") || "").trim();
    let organizationName = String(form.get("organizationName") || "").trim();
    const recipientEmail = String(form.get("recipientEmail") || "").trim().toLowerCase();
    if (!organizationId) {
      throw new Error("Pick an organization before generating an access code.");
    }
    if (!organizationName) {
      const org = await dbQueryOne<{ name: string }>(`select name from public.organizations where id = $1 limit 1`, [organizationId]);
      organizationName = String(org?.name || "").trim();
    }
    if (!organizationName) {
      throw new Error("Organization was not found.");
    }

    const code = await generateUniqueAccessCode(6);
    const accessScope = normalizeAccessScope(String(form.get("accessScope") || "both"));
    const accountType = normalizeAccountType(String(form.get("accountType") || "paid"));
    const requiresPayment = String(form.get("requiresPayment") || "") === "on";
    const expiresAt = String(form.get("expiresAt") || "").trim() || null;

    await createAccessCode({
      organizationId,
      code,
      accountType,
      accessScope,
      requiresPayment,
      maxUses: 1,
      expiresAt,
    });

    if (String(form.get("sendInvite") || "") === "on") {
      if (!recipientEmail) {
        throw new Error(`Access code ${code} created, but recipient email is required to send an invite.`);
      }
      const signUpUrl = `https://dbcjason.com/?tab=create-account&code=${encodeURIComponent(code)}&email=${encodeURIComponent(recipientEmail)}`;
      const emailResult = await sendAccessCodeEmail({
        to: recipientEmail,
        organizationName,
        accessCode: code,
        accessScope,
        accountType,
        signUpUrl,
        expiresAt,
      });
      if (!emailResult.ok) {
        throw new Error(`Access code ${code} created, but email failed: ${emailResult.error}`);
      }
      return redirectDashboard(req, "accounts", "notice", `Access code ${code} created and emailed to ${recipientEmail}.`);
    }

    return redirectDashboard(req, "accounts", "notice", `Access code ${code} created for ${organizationName}.`);
  } catch (error) {
    return redirectDashboard(req, "accounts", "error", error instanceof Error ? error.message : "Could not create access code.");
  }
}
