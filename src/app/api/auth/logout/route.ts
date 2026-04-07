import { NextRequest, NextResponse } from "next/server";
import { destroyCurrentSession, getCurrentUser, logUsageEvent } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (user) {
    await logUsageEvent({
      organizationId: user.organization_id,
      userId: user.id,
      eventType: "logout",
      email: user.email,
      path: "/",
      source: "manual_logout",
    });
  }
  await destroyCurrentSession();
  const url = req.nextUrl.clone();
  url.pathname = "/";
  url.search = "notice=Signed out successfully.";
  return NextResponse.redirect(url, 303);
}
