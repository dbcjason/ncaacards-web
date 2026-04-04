import { NextRequest, NextResponse } from "next/server";
import { bootstrapAdminAccount } from "@/lib/bootstrap-auth";

function token(): string {
  return String(process.env.PAYLOAD_SYNC_TOKEN || "").trim();
}

export async function POST(req: NextRequest) {
  const configuredToken = token();
  if (!configuredToken) {
    return NextResponse.json({ ok: false, error: "PAYLOAD_SYNC_TOKEN is not configured." }, { status: 500 });
  }
  if (req.headers.get("authorization") !== `Bearer ${configuredToken}`) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = (await req.json()) as { email?: string; password?: string; organizationName?: string };
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    if (!email || !password) {
      return NextResponse.json({ ok: false, error: "Email and password are required." }, { status: 400 });
    }
    const result = await bootstrapAdminAccount({
      email,
      password,
      organizationName: String(body.organizationName || "").trim() || undefined,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Could not bootstrap admin account." },
      { status: 500 },
    );
  }
}
