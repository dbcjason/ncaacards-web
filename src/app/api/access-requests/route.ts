import { NextRequest, NextResponse } from "next/server";
import { withDbTransaction } from "@/lib/db";
import { sendAccessRequestNotification } from "@/lib/email";
import { ensureAccessRequestSchema } from "@/lib/access-requests";

function redirectHome(req: NextRequest, kind: "notice" | "error", message: string) {
  const url = req.nextUrl.clone();
  url.pathname = "/";
  url.search = "";
  url.searchParams.set("tab", "request-access");
  url.searchParams.set(kind, message);
  return NextResponse.redirect(url);
}

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const email = String(form.get("email") || "").trim().toLowerCase();
  const organization = String(form.get("organization") || "").trim();
  const requesterName = String(form.get("requesterName") || "").trim();
  const notes = String(form.get("notes") || "").trim();

  if (!email || !organization || !requesterName) {
    return redirectHome(req, "error", "Enter your email, organization, and who you are.");
  }

  try {
    await ensureAccessRequestSchema();
    await withDbTransaction(async (client) => {
      await client.query(
        `insert into public.access_requests
          (email, organization, requester_name, notes, status)
         values ($1,$2,$3,$4,'pending')`,
        [email, organization, requesterName, notes || null],
      );
    });

    const emailResult = await sendAccessRequestNotification({
      requesterEmail: email,
      organization,
      requesterName,
      notes: notes || null,
    });

    if (!emailResult.ok) {
      return redirectHome(req, "notice", `Access request submitted. Admin email was not sent yet: ${emailResult.error}`);
    }

    return redirectHome(req, "notice", "Access request submitted.");
  } catch (error) {
    return redirectHome(req, "error", error instanceof Error ? error.message : "Could not submit access request.");
  }
}
