import "server-only";

type AccessCodeEmailInput = {
  to: string;
  organizationName: string;
  accessCode: string;
  accessScope: "men" | "women" | "both";
  accountType: "paid" | "free" | "trial" | "expired";
  signUpUrl: string;
  expiresAt?: string | null;
};

type AccessRequestEmailInput = {
  requesterEmail: string;
  organization: string;
  requesterName: string;
  notes?: string | null;
};

function resendKey(): string {
  return String(process.env.RESEND_API_KEY || "").trim();
}

function senderEmail(): string {
  return String(process.env.INVITE_FROM_EMAIL || "").trim();
}

export function canSendEmail(): boolean {
  return Boolean(resendKey() && senderEmail());
}

export async function sendAccessCodeEmail(input: AccessCodeEmailInput): Promise<{ ok: boolean; error?: string }> {
  if (!canSendEmail()) {
    return { ok: false, error: "Email sending is not configured yet. Add RESEND_API_KEY and INVITE_FROM_EMAIL." };
  }

  const expiresLabel = input.expiresAt ? `This code expires on ${new Date(input.expiresAt).toLocaleDateString("en-US")}.` : "";
  const html = `
    <div style="font-family: Georgia, 'Times New Roman', serif; background:#f7f0e3; padding:32px; color:#1b1711;">
      <div style="max-width:620px; margin:0 auto; background:#fffaf3; border:1px solid #d8c8a8; border-radius:20px; padding:32px;">
        <div style="font-size:12px; letter-spacing:0.18em; text-transform:uppercase; color:#8b6f3d;">DBCJASON.COM</div>
        <h1 style="font-size:32px; margin:12px 0 8px;">Your Access Code Is Ready</h1>
        <p style="font-size:16px; line-height:1.6;">
          You have been invited to create an account for <strong>${escapeHtml(input.organizationName)}</strong>.
        </p>
        <div style="margin:24px 0; padding:24px; border-radius:18px; background:#1f1a13; color:#f8f0df; text-align:center;">
          <div style="font-size:12px; letter-spacing:0.18em; text-transform:uppercase; opacity:0.7;">One-Time Access Code</div>
          <div style="font-size:44px; letter-spacing:0.22em; margin-top:10px;">${escapeHtml(input.accessCode)}</div>
        </div>
        <p style="font-size:15px; line-height:1.7;">
          Access level: <strong>${escapeHtml(input.accessScope)}</strong><br/>
          Account type: <strong>${escapeHtml(input.accountType)}</strong><br/>
          ${escapeHtml(expiresLabel)}
        </p>
        <p style="margin:28px 0;">
          <a href="${input.signUpUrl}" style="display:inline-block; background:#af3c2e; color:#fff7ef; padding:14px 22px; text-decoration:none; border-radius:999px; font-weight:700;">
            Create Your Account
          </a>
        </p>
        <p style="font-size:13px; color:#6c5d44; line-height:1.6;">
          This code can only be used one time. If you already created your account, you can ignore this email.
        </p>
      </div>
    </div>
  `;

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: senderEmail(),
      to: [input.to],
      subject: `Your ${input.organizationName} access code`,
      html,
    }),
  });

  if (!response.ok) {
    const message = await response.text();
    return { ok: false, error: `Resend error ${response.status}: ${message}` };
  }

  return { ok: true };
}

function adminNotifyEmail(): string {
  return String(process.env.ACCESS_REQUEST_NOTIFY_EMAIL || "dbbjasonb@gmail.com").trim();
}

export async function sendAccessRequestNotification(input: AccessRequestEmailInput): Promise<{ ok: boolean; error?: string }> {
  if (!canSendEmail()) {
    return { ok: false, error: "Email sending is not configured yet. Add RESEND_API_KEY and INVITE_FROM_EMAIL." };
  }

  const html = `
    <div style="font-family: Georgia, 'Times New Roman', serif; padding: 24px; color: #181512;">
      <h1 style="font-size: 24px; margin-bottom: 16px;">New Access Code Request</h1>
      <p><strong>Email:</strong> ${escapeHtml(input.requesterEmail)}</p>
      <p><strong>Organization:</strong> ${escapeHtml(input.organization)}</p>
      <p><strong>Who They Are:</strong> ${escapeHtml(input.requesterName)}</p>
      <p><strong>Notes:</strong> ${escapeHtml(input.notes || "—")}</p>
      <p><a href="https://www.dbcjason.com/dashboard?tab=requests">Open admin dashboard</a></p>
    </div>
  `;

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: senderEmail(),
      to: [adminNotifyEmail()],
      subject: `Access request from ${input.organization}`,
      html,
    }),
  });

  if (!response.ok) {
    const message = await response.text();
    return { ok: false, error: `Resend error ${response.status}: ${message}` };
  }

  return { ok: true };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
