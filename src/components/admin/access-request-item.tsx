"use client";

import { useState } from "react";
import { ReviewAccessRequestForm } from "@/components/admin/review-access-request-form";

type AccessRequestItemProps = {
  request: {
    id: string;
    email: string;
    organization: string;
    requester_name: string;
    notes: string | null;
    status: string;
    created_at: string;
    reviewed_at: string | null;
    reviewed_by_email: string | null;
    fulfilled_access_code: string | null;
  };
};

export function AccessRequestItem({ request }: AccessRequestItemProps) {
  const [expanded, setExpanded] = useState(false);
  const statusLabel =
    request.status === "disabled"
      ? "Approved"
      : request.status === "expired"
        ? "Declined"
        : "Pending";

  return (
    <div className="site-panel rounded-xl p-5">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="space-y-1">
          <div className="text-sm text-zinc-400">{formatDateTime(request.created_at)}</div>
          <div className="text-lg font-semibold text-zinc-100">{request.organization}</div>
          <div className="text-sm text-zinc-300">{request.email}</div>
          <div className="text-sm text-zinc-300">{request.requester_name}</div>
          {request.notes && <div className="text-sm text-zinc-500">{request.notes}</div>}
        </div>

        <div className="flex flex-col items-start gap-3 md:items-end">
          <div className="space-y-1 text-sm text-zinc-300 md:text-right">
            <div>Status: {statusLabel}</div>
            <div>Reviewed: {formatDateTime(request.reviewed_at)}</div>
            <div>By: {request.reviewed_by_email || "—"}</div>
            <div>Code: {request.fulfilled_access_code || "—"}</div>
          </div>

          <button
            type="button"
            className="site-button-secondary"
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? "Hide Request" : request.status === "pending" ? "Review Request" : "View Request"}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="mt-5 border-t border-zinc-800 pt-5">
          {request.status === "pending" ? (
            <div className="space-y-4">
              <ReviewAccessRequestForm request={request} />
              <form action="/api/admin/access-requests/decline" method="post">
                <input type="hidden" name="requestId" value={request.id} />
                <button type="submit" className="site-button-secondary border-rose-800 text-rose-200 hover:bg-rose-950/40">
                  Decline Request
                </button>
              </form>
            </div>
          ) : (
            <div className="text-sm text-zinc-400">
              This request has already been handled.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function formatDateTime(value: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
}
