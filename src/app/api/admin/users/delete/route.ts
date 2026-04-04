import { NextRequest, NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/auth";
import { withDbTransaction } from "@/lib/db";

function redirectDashboard(req: NextRequest, kind: "notice" | "error", message: string) {
  const url = req.nextUrl.clone();
  url.pathname = "/dashboard";
  url.search = "";
  url.searchParams.set("tab", "accounts");
  url.searchParams.set(kind, message);
  return NextResponse.redirect(url);
}

export async function POST(req: NextRequest) {
  const adminUser = await requireAdminUser();
  const form = await req.formData();

  try {
    const userId = String(form.get("userId") || "").trim();
    const email = String(form.get("email") || "").trim().toLowerCase();

    if (!userId) {
      throw new Error("User id is required.");
    }

    if (userId === adminUser.id) {
      throw new Error("Your own admin account cannot be deleted.");
    }

    const deleted = await withDbTransaction(async (client) => {
      const result = await client.query(
        `delete from public.app_users
         where id = $1
           and id <> $2
         returning email`,
        [userId, adminUser.id],
      );
      return result.rows[0] as { email: string } | undefined;
    });

    if (!deleted) {
      throw new Error("That account could not be deleted.");
    }

    return redirectDashboard(req, "notice", `Deleted account ${deleted.email || email || "user"}.`);
  } catch (error) {
    return redirectDashboard(req, "error", error instanceof Error ? error.message : "Could not delete account.");
  }
}
