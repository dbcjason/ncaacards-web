"use client";

import { useMemo, useState } from "react";

function generateSixDigitCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

type ReviewAccessRequestFormProps = {
  request: {
    id: string;
    email: string;
    organization: string;
    requester_name: string;
    notes: string | null;
  };
};

export function ReviewAccessRequestForm({ request }: ReviewAccessRequestFormProps) {
  const [accessCode, setAccessCode] = useState("");
  const [accountType, setAccountType] = useState<"paid" | "free">("paid");
  const requiresPayment = useMemo(() => accountType === "paid", [accountType]);

  return (
    <form action="/api/admin/access-requests/approve" method="post" className="grid gap-4 md:grid-cols-2">
      <input type="hidden" name="requestId" value={request.id} />

      <label className="space-y-2">
        <div className="text-sm font-medium text-zinc-100">Organization Name</div>
        <input className="site-input" name="organizationName" defaultValue={request.organization} required />
      </label>

      <label className="space-y-2">
        <div className="text-sm font-medium text-zinc-100">Recipient Email</div>
        <input className="site-input" name="recipientEmail" type="email" defaultValue={request.email} required />
      </label>

      <label className="space-y-2">
        <div className="text-sm font-medium text-zinc-100">Account Type</div>
        <select className="site-input" name="accountType" value={accountType} onChange={(event) => setAccountType(event.target.value as "paid" | "free")}>
          <option value="paid">Paid</option>
          <option value="free">Free</option>
        </select>
      </label>

      <label className="space-y-2">
        <div className="text-sm font-medium text-zinc-100">Access Scope</div>
        <select className="site-input" name="accessScope" defaultValue="both">
          <option value="both">Both</option>
          <option value="men">Men</option>
          <option value="women">Women</option>
        </select>
      </label>

      <label className="flex items-center gap-3 pt-8 text-sm text-zinc-100 md:col-span-2">
        <input type="checkbox" name="requiresPayment" defaultChecked={requiresPayment} checked={requiresPayment} readOnly className="h-4 w-4" />
        Requires payment
      </label>

      <label className="space-y-2">
        <div className="text-sm font-medium text-zinc-100">Contract Start</div>
        <input className="site-input" type="date" name="contractStartsAt" />
      </label>

      <label className="space-y-2">
        <div className="text-sm font-medium text-zinc-100">Contract End</div>
        <input className="site-input" type="date" name="contractEndsAt" />
      </label>

      <label className="space-y-2">
        <div className="text-sm font-medium text-zinc-100">Expiration Date</div>
        <input className="site-input" type="date" name="expiresAt" />
      </label>

      <label className="space-y-2 md:col-span-2">
        <div className="text-sm font-medium text-zinc-100">Internal Notes</div>
        <textarea className="site-input min-h-24" name="notes" defaultValue={request.notes || ""} />
      </label>

      <div className="space-y-2 md:col-span-2">
        <div className="text-sm font-medium text-zinc-100">Access Code</div>
        <div className="flex flex-col gap-3 md:flex-row">
          <input
            className="site-input md:max-w-xs"
            name="accessCode"
            inputMode="numeric"
            pattern="[0-9]{6}"
            maxLength={6}
            placeholder="6-digit code"
            value={accessCode}
            onChange={(event) => setAccessCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
          />
          <button className="site-button-secondary md:w-auto" type="button" onClick={() => setAccessCode(generateSixDigitCode())}>
            Generate Access Code
          </button>
        </div>
      </div>

      <label className="flex items-center gap-3 text-sm text-zinc-100 md:col-span-2">
        <input type="checkbox" name="sendInvite" defaultChecked className="h-4 w-4" />
        Send the access code email right away
      </label>

      <div className="md:col-span-2">
        <button className="site-button" type="submit">Approve Request + Create Organization</button>
      </div>
    </form>
  );
}
