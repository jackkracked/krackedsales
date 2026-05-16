import { Resend } from "resend";

const FROM = "Kracked Retention <onboarding@resend.dev>";
const GAGE = "gage@krackedretention.com";

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
}

function fmtAmt(amount: number, currency: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
    maximumFractionDigits: 0,
  }).format(amount);
}

// ─── Proposal link email (sent to client when proposal is dispatched) ─────────

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
  const appUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : "https://kracked-sales.vercel.app";
  const signingUrl = `${appUrl}/p/${proposal.token}`;
  const serviceType = proposal.type === "management" ? "Management Retainer" : "Project";

  const to: string[] = [];
  if (proposal.contactEmail) to.push(proposal.contactEmail);
  if (to.length === 0) {
    console.warn("[email] No recipient email — skipping proposal link email");
    return;
  }

  const { error } = await resend.emails.send({
    from: FROM,
    to,
    subject: `Your Proposal from Kracked Retention — ${proposal.title}`,
    html: `
      <div style="font-family: Helvetica, Arial, sans-serif; font-size: 14px; color: #1a1a1a; max-width: 600px; margin: 0 auto;">
        <div style="text-align: center; padding: 32px 0 24px;">
          <div style="font-size: 22px; font-weight: 900; letter-spacing: -0.5px;">Kracked</div>
          <div style="font-size: 9px; font-weight: 700; letter-spacing: 4px; margin-top: 2px;">RETENTION</div>
        </div>

        <div style="height: 6px; background: #1a1a1a; border-radius: 1px; margin-bottom: 28px;"></div>

        <p style="margin: 0 0 16px;">Hi ${proposal.contactName},</p>
        <p style="margin: 0 0 16px;">
          Your proposal for <strong>${proposal.title}</strong> (${serviceType} — ${amount}) is ready to review and sign.
        </p>
        <p style="margin: 0 0 24px;">
          Click the button below to view the full agreement and add your signature:
        </p>

        <div style="text-align: center; margin: 0 0 28px;">
          <a href="${signingUrl}" style="display: inline-block; background: #1a1a1a; color: #fff; font-size: 14px; font-weight: 600; padding: 12px 28px; border-radius: 6px; text-decoration: none; letter-spacing: 0.01em;">
            Review &amp; Sign
          </a>
        </div>

        <p style="margin: 0 0 16px; font-size: 12px; color: #666;">
          Or copy this link into your browser:<br>
          <a href="${signingUrl}" style="color: #1a1a1a;">${signingUrl}</a>
        </p>

        <p style="margin: 0 0 16px;">
          If you have any questions, reply to this email or reach us at
          <a href="mailto:admin@krackedretention.com" style="color: #1a1a1a;">admin@krackedretention.com</a>.
        </p>
        <p style="margin: 0;">— The Kracked Retention Team</p>

        <div style="height: 1px; background: #e0e0e0; margin: 32px 0;"></div>
        <p style="font-size: 11px; color: #999; margin: 0;">
          © 2026 Kracked Retention · admin@krackedretention.com
        </p>
      </div>
    `,
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

  const to: string[] = [GAGE];
  if (proposal.contactEmail) to.push(proposal.contactEmail);

  const { error: signedError } = await resend.emails.send({
    from: FROM,
    to,
    subject: `Signed Agreement: ${proposal.title}`,
    html: `
      <div style="font-family: Helvetica, Arial, sans-serif; font-size: 14px; color: #1a1a1a; max-width: 600px; margin: 0 auto;">
        <div style="text-align: center; padding: 32px 0 24px;">
          <div style="font-size: 22px; font-weight: 900; letter-spacing: -0.5px;">Kracked</div>
          <div style="font-size: 9px; font-weight: 700; letter-spacing: 4px; margin-top: 2px;">RETENTION</div>
        </div>

        <div style="height: 6px; background: #1a1a1a; border-radius: 1px; margin-bottom: 28px;"></div>

        <p style="margin: 0 0 16px;">Hi ${proposal.contactName},</p>
        <p style="margin: 0 0 16px;">
          Your signed agreement for <strong>${proposal.title}</strong> (${amount}) has been received and is
          attached to this email for your records.
        </p>
        <p style="margin: 0 0 16px;">
          You will receive your payment link shortly. If you have any questions, reply to this email or
          reach us at <a href="mailto:admin@krackedretention.com" style="color: #1a1a1a;">admin@krackedretention.com</a>.
        </p>
        <p style="margin: 0 0 16px;">Looking forward to working with you.</p>
        <p style="margin: 0;">— The Kracked Retention Team</p>

        <div style="height: 1px; background: #e0e0e0; margin: 32px 0;"></div>
        <p style="font-size: 11px; color: #999; margin: 0;">
          © 2026 Kracked Retention · admin@krackedretention.com
        </p>
      </div>
    `,
    attachments: [
      {
        filename,
        content: pdfBuffer,
      },
    ],
  });
  if (signedError) throw new Error(`Resend rejected signed agreement email: ${signedError.message}`);
}

// ─── First payment receipt email ──────────────────────────────────────────────

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

  const to: string[] = [GAGE];
  if (proposal.contactEmail) to.push(proposal.contactEmail);

  const { error: receiptError } = await resend.emails.send({
    from: FROM,
    to,
    subject: `Payment Received: ${proposal.title}`,
    html: `
      <div style="font-family: Helvetica, Arial, sans-serif; font-size: 14px; color: #1a1a1a; max-width: 600px; margin: 0 auto;">
        <div style="text-align: center; padding: 32px 0 24px;">
          <div style="font-size: 22px; font-weight: 900; letter-spacing: -0.5px;">Kracked</div>
          <div style="font-size: 9px; font-weight: 700; letter-spacing: 4px; margin-top: 2px;">RETENTION</div>
        </div>

        <div style="height: 6px; background: #1a1a1a; border-radius: 1px; margin-bottom: 28px;"></div>

        <p style="margin: 0 0 16px;">Hi ${proposal.contactName},</p>
        <p style="margin: 0 0 16px;">
          We have received your payment for <strong>${proposal.title}</strong> (${amount}).
          Your signed agreement is attached to this email as your receipt.
        </p>
        <p style="margin: 0 0 16px;">
          We are excited to get started! You'll hear from us shortly with next steps.
        </p>
        <p style="margin: 0 0 16px;">Thank you for your business.</p>
        <p style="margin: 0;">— The Kracked Retention Team</p>

        <div style="height: 1px; background: #e0e0e0; margin: 32px 0;"></div>
        <p style="font-size: 11px; color: #999; margin: 0;">
          © 2026 Kracked Retention · admin@krackedretention.com
        </p>
      </div>
    `,
    attachments: [
      {
        filename,
        content: pdfBuffer,
      },
    ],
  });
  if (receiptError) throw new Error(`Resend rejected payment receipt email: ${receiptError.message}`);
}
