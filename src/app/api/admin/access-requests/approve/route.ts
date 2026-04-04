import { NextRequest, NextResponse } from "next/server";
import {
  createAccessCode,
  createBillingRecord,
  createOrganizationAccount,
  generateUniqueAccessCode,
  normalizeAccessScope,
  normalizeAccountType,
  requireAdminUser,
} from "@/lib/auth";
import { withDbTransaction } from "@/lib/db";
import { sendAccessCodeEmail } from "@/lib/email";
import { ensureAccessRequestSchema } from "@/lib/access-requests";

function redirectDashboard(req: NextRequest, kind: "notice" | "error", message: string) {
  const url = req.nextUrl.clone();
  url.pathname = "/dashboard";
  url.search = "";
  url.searchParams.set("tab", "requests");
  url.searchParams.set(kind, message);
  return NextResponse.redirect(url);
}

export async function POST(req: NextRequest) {
  const adminUser = await requireAdminUser();
  const form = await req.formData();

  try {
    await ensureAccessRequestSchema();

    const requestId = String(form.get("requestId") || "").trim();
    if (!requestId) {
      throw new Error("Request id is required.");
    }

    const organizationName = String(form.get("organizationName") || "").trim();
    if (!organizationName) {
      throw new Error("Organization name is required.");
    }

    const accountType = normalizeAccountType(String(form.get("accountType") || "paid"));
    const accessScope = normalizeAccessScope(String(form.get("accessScope") || "both"));
    const recipientEmail = String(form.get("recipientEmail") || "").trim().toLowerCase();
    const sendInvite = String(form.get("sendInvite") || "") === "on";
    const notes = String(form.get("notes") || "").trim() || undefined;
    const accessCode = String(form.get("accessCode") || "").trim() || await generateUniqueAccessCode(6);
    const contractStartsAt = String(form.get("contractStartsAt") || "").trim() || null;
    const contractEndsAt = String(form.get("contractEndsAt") || "").trim() || null;
    const expiresAt = String(form.get("expiresAt") || "").trim() || null;
    const requiresPayment = accountType === "paid" ? String(form.get("requiresPayment") || "on") === "on" : false;

    if (sendInvite && !recipientEmail) {
      throw new Error("Recipient email is required when sending the access code.");
    }

    const existingRequest = await withDbTransaction(async (client) => {
      const result = await client.query(
        `select id, email, organization, requester_name, status
         from public.access_requests
         where id = $1
         limit 1`,
        [requestId],
      );
      return result.rows[0] as {
        id: string;
        email: string;
        organization: string;
        requester_name: string;
        status: string;
      } | undefined;
    });

    if (!existingRequest) {
      throw new Error("That request could not be found.");
    }
    if (existingRequest.status !== "pending") {
      throw new Error("That request has already been handled.");
    }

    const organization = await createOrganizationAccount({
      organizationName,
      accountType,
      accessScope,
      requiresPayment,
      notes,
      contractStartsAt,
      contractEndsAt,
      expiresAt,
    });

    await createBillingRecord({
      organizationId: String(organization.id),
      provider: "manual",
      status: requiresPayment ? "pending" : "not_required",
      notes: requiresPayment ? "Awaiting payment setup or manual confirmation." : "Free or comped account.",
      currentPeriodEnd: contractEndsAt,
    });

    await createAccessCode({
      organizationId: String(organization.id),
      code: accessCode,
      accountType,
      accessScope,
      requiresPayment,
      maxUses: 1,
      expiresAt,
    });

    await withDbTransaction(async (client) => {
      await client.query(
        `update public.access_requests
           set status = 'disabled',
               reviewed_at = now(),
               reviewed_by_email = $2,
               fulfilled_organization_id = $3,
               fulfilled_access_code = $4
         where id = $1`,
        [requestId, adminUser.email, organization.id, accessCode],
      );
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
        throw new Error(`Request was approved and code created, but email failed: ${emailResult.error}`);
      }
      return redirectDashboard(req, "notice", `Request approved for ${organizationName}. Access code ${accessCode} was emailed to ${recipientEmail}.`);
    }

    return redirectDashboard(req, "notice", `Request approved for ${organizationName}. Access code ${accessCode} is ready.`);
  } catch (error) {
    return redirectDashboard(req, "error", error instanceof Error ? error.message : "Could not approve access request.");
  }
}
