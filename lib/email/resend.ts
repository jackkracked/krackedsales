import { Resend } from "resend";

const FROM = "Kracked Retention <admin@krackedretention.com>";
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

  await resend.emails.send({
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

  await resend.emails.send({
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
}
