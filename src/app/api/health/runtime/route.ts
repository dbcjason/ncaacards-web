import { NextResponse } from "next/server";
import { publicRuntimeSummary } from "@/lib/env";

export async function GET() {
  return NextResponse.json({
    ok: true,
    runtime: publicRuntimeSummary(),
  });
}
