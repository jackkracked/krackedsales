import { Resend } from "resend";

const FROM = "Kracked Retention <proposals@krackedretention.com>";
const GAGE = "gage@krackedretention.com";
const APP_URL = process.env.VERCEL_PROJECT_PRODUCTION_URL
  ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
  : "https://kracked-sales.vercel.app";
// Hardcoded to the stable production domain so it never breaks in email clients
const LOGO_URL = "https://kracked-sales.vercel.app/kracked-logo.png";

function client() {
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  return new Resend(key);
}

export interface ProposalEmailData {
  contactName: string;
  contactEmail: string | null;
  title: string;
  totalAmount: number;
  currency: string;
  serviceDescription?: string | null;
}

function fmtAmt(amount: number, currency: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
    maximumFractionDigits: 0,
  }).format(amount);
}

// ─── Shared layout wrapper ────────────────────────────────────────────────────

function emailShell(content: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
</head>
<body style="margin:0;padding:0;background:#f0ede8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0ede8;padding:40px 16px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

          <!-- Header -->
          <tr>
            <td style="background:#ffffff;border-radius:12px 12px 0 0;padding:28px 40px;text-align:center;border-bottom:1px solid #e8e4df;">
              <img src="${LOGO_URL}" alt="Kracked Retention" width="220" height="63" border="0"
                style="display:block;margin:0 auto;width:220px;height:auto;max-width:220px;" />
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="background:#ffffff;padding:40px 40px 36px;">
              ${content}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#f7f5f2;border-radius:0 0 12px 12px;padding:24px 40px;text-align:center;border-top:1px solid #e8e4df;">
              <p style="margin:0 0 6px;font-size:11px;color:#999;letter-spacing:0.08em;text-transform:uppercase;font-weight:600;">Kracked Retention</p>
              <p style="margin:0 0 10px;font-size:11px;color:#aaa;">
                <a href="mailto:${GAGE}" style="color:#888;text-decoration:none;">${GAGE}</a>
                &nbsp;·&nbsp;
                <a href="https://krackedretention.com" style="color:#888;text-decoration:none;">krackedretention.com</a>
              </p>
              <p style="margin:0;font-size:10px;color:#bbb;">© ${new Date().getFullYear()} Kracked Retention. All rights reserved.</p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function ctaButton(href: string, label: string): string {
  return `<table cellpadding="0" cellspacing="0" style="margin:32px auto;">
    <tr>
      <td style="background:#0f0f0f;border-radius:8px;">
        <a href="${href}" style="display:inline-block;padding:14px 36px;font-size:14px;font-weight:700;color:#ffffff;text-decoration:none;letter-spacing:0.04em;text-transform:uppercase;">${label}</a>
      </td>
    </tr>
  </table>`;
}

function divider(): string {
  return `<table width="100%" cellpadding="0" cellspacing="0" style="margin:28px 0;">
    <tr><td style="height:1px;background:#e8e8e4;"></td></tr>
  </table>`;
}

// ─── Proposal link email ──────────────────────────────────────────────────────

export async function sendProposalLinkEmail(proposal: ProposalEmailData & {
  token: string;
  type: string;
}): Promise<void> {
  const resend = client();
  if (!resend) {
    console.warn("[email] RESEND_API_KEY not set — skipping proposal link email");
    return;
  }

  const amount = fmtAmt(proposal.totalAmount, proposal.currency);
  const signingUrl = `${APP_URL}/p/${proposal.token}`;
  const serviceType = proposal.type === "management" ? "Management Retainer" : "Project";
  const firstName = proposal.contactName.split(" ")[0];

  const to: string[] = [];
  if (proposal.contactEmail) to.push(proposal.contactEmail);
  if (to.length === 0) {
    console.warn("[email] No recipient email — skipping proposal link email");
    return;
  }

  // Parse serviceDescription into bullet lines, fallback to service type
  const deliverableLines = proposal.serviceDescription
    ? proposal.serviceDescription
        .split(/\n|•|-/)
        .map((l) => l.trim())
        .filter(Boolean)
    : null;

  const deliverablesBlock = deliverableLines
    ? `<table cellpadding="0" cellspacing="0" style="margin:0 0 28px;width:100%;">
        <tr>
          <td style="background:#f4f4f0;border-radius:8px;padding:20px 24px;">
            <p style="margin:0 0 12px;font-size:12px;color:#888;text-transform:uppercase;letter-spacing:0.07em;font-weight:700;">What's included</p>
            ${deliverableLines.map((line) => {
              // Lines ending with ":" are section headers, not bullets
              const isHeader = line.endsWith(":");
              if (isHeader) {
                return `<p style="margin:10px 0 4px;font-size:12px;font-weight:700;color:#555;text-transform:uppercase;letter-spacing:0.06em;">${line.slice(0, -1)}</p>`;
              }
              return `
            <table cellpadding="0" cellspacing="0" style="margin:0 0 6px;">
              <tr>
                <td style="width:18px;vertical-align:top;padding-top:1px;">
                  <span style="display:inline-block;width:6px;height:6px;background:#0f0f0f;border-radius:50%;margin-top:5px;"></span>
                </td>
                <td style="font-size:14px;color:#333;line-height:1.5;">${line}</td>
              </tr>
            </table>`;
            }).join("")}
          </td>
        </tr>
      </table>`
    : "";

  const steps = [
    { n: "1", title: "Review your proposal", desc: "Read through the agreement and deliverables at your own pace." },
    { n: "2", title: "Sign &amp; make payment", desc: "Add your e-signature and complete your payment securely online." },
    { n: "3", title: "Get onboarded", desc: "Our team reaches out within 24 hours to kick things off." },
  ];

  const howItWorks = `
    <table cellpadding="0" cellspacing="0" style="margin:0 0 32px;width:100%;">
      <tr>
        <td style="background:#f7f5f2;border-radius:10px;padding:24px;">
          <p style="margin:0 0 16px;font-size:11px;color:#999;text-transform:uppercase;letter-spacing:0.08em;font-weight:700;">How it works</p>
          ${steps.map((s) => `
          <table cellpadding="0" cellspacing="0" style="margin:0 0 14px;width:100%;">
            <tr>
              <td style="width:32px;vertical-align:top;">
                <div style="width:24px;height:24px;background:#0f0f0f;border-radius:50%;text-align:center;line-height:24px;font-size:11px;font-weight:800;color:#ffffff;">${s.n}</div>
              </td>
              <td style="vertical-align:top;padding-left:8px;">
                <p style="margin:0 0 2px;font-size:14px;font-weight:700;color:#0f0f0f;">${s.title}</p>
                <p style="margin:0;font-size:13px;color:#777;line-height:1.5;">${s.desc}</p>
              </td>
            </tr>
          </table>`).join("")}
        </td>
      </tr>
    </table>`;

  const body = `
    <p style="margin:0 0 16px;font-size:15px;color:#333;line-height:1.6;">Hi ${firstName},</p>
    <p style="margin:0 0 28px;font-size:15px;color:#333;line-height:1.6;">
      Your <strong>${serviceType}</strong> proposal from Kracked Retention is ready. Click the button below to review the full agreement and add your signature.
    </p>

    ${deliverablesBlock}

    ${howItWorks}

    ${ctaButton(signingUrl, "Review &amp; Sign Agreement")}

    ${divider()}

    <p style="margin:0 0 8px;font-size:12px;color:#999;">Or copy this link into your browser:</p>
    <p style="margin:0 0 24px;font-size:12px;word-break:break-all;">
      <a href="${signingUrl}" style="color:#555;text-decoration:underline;">${signingUrl}</a>
    </p>

    <p style="margin:0 0 6px;font-size:14px;color:#555;line-height:1.6;">
      Any questions before signing? Just reply to this email — we're happy to help.
    </p>
    <p style="margin:0;font-size:14px;color:#555;">— The Kracked Retention Team</p>
  `;

  const { error } = await resend.emails.send({
    from: FROM,
    to,
    replyTo: GAGE,
    subject: `Your ${serviceType} Proposal from Kracked Retention`,
    html: emailShell(body),
  });
  if (error) throw new Error(`Resend rejected proposal link email: ${error.message}`);
}

// ─── Signed agreement email ───────────────────────────────────────────────────

export async function sendSignedAgreementEmail(
  proposal: ProposalEmailData,
  pdfBuffer: Buffer
): Promise<void> {
  const resend = client();
  if (!resend) {
    console.warn("[email] RESEND_API_KEY not set — skipping signed agreement email");
    return;
  }

  const amount = fmtAmt(proposal.totalAmount, proposal.currency);
  const filename = `kracked-retention-agreement-${proposal.contactName.toLowerCase().replace(/\s+/g, "-")}.pdf`;
  const firstName = proposal.contactName.split(" ")[0];

  const to: string[] = [GAGE];
  if (proposal.contactEmail) to.push(proposal.contactEmail);

  const body = `
    <p style="margin:0 0 6px;font-size:13px;color:#888;letter-spacing:0.06em;text-transform:uppercase;font-weight:600;">Agreement Signed</p>
    <h1 style="margin:0 0 28px;font-size:26px;font-weight:800;color:#0f0f0f;letter-spacing:-0.5px;line-height:1.2;">${proposal.title}</h1>

    <!-- Signed badge -->
    <table cellpadding="0" cellspacing="0" style="margin:0 0 28px;">
      <tr>
        <td style="background:#f0faf4;border:1px solid #c3e6cb;border-radius:8px;padding:16px 24px;">
          <span style="font-size:13px;color:#2d6a4f;font-weight:700;">✓ Agreement signed and received</span>
          <br />
          <span style="font-size:13px;color:#52796f;margin-top:4px;display:block;">Amount: <strong>${amount}</strong></span>
        </td>
      </tr>
    </table>

    <p style="margin:0 0 16px;font-size:15px;color:#333;line-height:1.6;">Hi ${firstName},</p>
    <p style="margin:0 0 16px;font-size:15px;color:#333;line-height:1.6;">
      Thank you for signing your agreement with Kracked Retention. Your signed copy is attached to this email for your records.
    </p>
    <p style="margin:0 0 24px;font-size:15px;color:#333;line-height:1.6;">
      You'll hear from us shortly with next steps. We're excited to get started.
    </p>

    ${divider()}

    <p style="margin:0;font-size:14px;color:#555;">— The Kracked Retention Team</p>
  `;

  const { error: signedError } = await resend.emails.send({
    from: FROM,
    to,
    replyTo: GAGE,
    subject: `Signed Agreement: ${proposal.title}`,
    html: emailShell(body),
    attachments: [{ filename, content: pdfBuffer }],
  });
  if (signedError) throw new Error(`Resend rejected signed agreement email: ${signedError.message}`);
}

// ─── Payment receipt email ────────────────────────────────────────────────────

export async function sendPaymentReceiptEmail(
  proposal: ProposalEmailData,
  pdfBuffer: Buffer
): Promise<void> {
  const resend = client();
  if (!resend) {
    console.warn("[email] RESEND_API_KEY not set — skipping payment receipt email");
    return;
  }

  const amount = fmtAmt(proposal.totalAmount, proposal.currency);
  const filename = `kracked-retention-receipt-${proposal.contactName.toLowerCase().replace(/\s+/g, "-")}.pdf`;
  const firstName = proposal.contactName.split(" ")[0];

  const to: string[] = [GAGE];
  if (proposal.contactEmail) to.push(proposal.contactEmail);

  const body = `
    <p style="margin:0 0 6px;font-size:13px;color:#888;letter-spacing:0.06em;text-transform:uppercase;font-weight:600;">Payment Received</p>
    <h1 style="margin:0 0 28px;font-size:26px;font-weight:800;color:#0f0f0f;letter-spacing:-0.5px;line-height:1.2;">${proposal.title}</h1>

    <!-- Payment confirmation -->
    <table cellpadding="0" cellspacing="0" style="margin:0 0 28px;">
      <tr>
        <td style="background:#f4f4f0;border-radius:8px;padding:20px 24px;">
          <span style="font-size:13px;color:#888;text-transform:uppercase;letter-spacing:0.06em;font-weight:600;display:block;margin-bottom:6px;">Amount Paid</span>
          <span style="font-size:36px;font-weight:900;color:#0f0f0f;letter-spacing:-1.5px;">${amount}</span>
        </td>
      </tr>
    </table>

    <p style="margin:0 0 16px;font-size:15px;color:#333;line-height:1.6;">Hi ${firstName},</p>
    <p style="margin:0 0 16px;font-size:15px;color:#333;line-height:1.6;">
      We've received your payment — thank you! Your receipt is attached to this email.
    </p>
    <p style="margin:0 0 24px;font-size:15px;color:#333;line-height:1.6;">
      We're excited to start working together and will be in touch shortly with next steps.
    </p>

    ${divider()}

    <p style="margin:0;font-size:14px;color:#555;">— The Kracked Retention Team</p>
  `;

  const { error: receiptError } = await resend.emails.send({
    from: FROM,
    to,
    replyTo: GAGE,
    subject: `Payment Received: ${proposal.title} (${amount})`,
    html: emailShell(body),
    attachments: [{ filename, content: pdfBuffer }],
  });
  if (receiptError) throw new Error(`Resend rejected payment receipt email: ${receiptError.message}`);
}
