import { NextRequest, NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/auth";
import { withDbTransaction } from "@/lib/db";
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

    await withDbTransaction(async (client) => {
      const existing = await client.query(
        `select id, status
         from public.access_requests
         where id = $1
         limit 1`,
        [requestId],
      );
      const row = existing.rows[0] as { id: string; status: string } | undefined;
      if (!row) {
        throw new Error("That request could not be found.");
      }
      if (row.status !== "pending") {
        throw new Error("That request has already been handled.");
      }

      await client.query(
        `update public.access_requests
           set status = 'expired',
               reviewed_at = now(),
               reviewed_by_email = $2
         where id = $1`,
        [requestId, adminUser.email],
      );
    });

    return redirectDashboard(req, "notice", "Request declined.");
  } catch (error) {
    return redirectDashboard(req, "error", error instanceof Error ? error.message : "Could not decline request.");
  }
}
