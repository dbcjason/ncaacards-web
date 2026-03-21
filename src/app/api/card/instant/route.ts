import { NextRequest, NextResponse } from "next/server";
import { getCardPayloadFromStore } from "@/lib/jobs";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const payload = await getCardPayloadFromStore(body);
    if (!payload) {
      return NextResponse.json({ ok: true, found: false });
    }
    return NextResponse.json({ ok: true, found: true, payload });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

