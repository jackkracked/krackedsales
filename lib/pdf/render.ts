import { renderToBuffer } from "@react-pdf/renderer";
import React from "react";
import { AgreementPdf, type ProposalForPdf } from "./agreement-pdf";

export async function generateAgreementPdf(proposal: ProposalForPdf): Promise<Buffer> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const element = React.createElement(AgreementPdf, { proposal }) as any;
  const buffer = await renderToBuffer(element);
  return Buffer.from(buffer);
}
