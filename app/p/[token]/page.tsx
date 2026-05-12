import { ProposalSigningPage } from "@/components/proposals/public/proposal-signing-page";

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ preview?: string }>;
}) {
  const { token } = await params;
  const { preview } = await searchParams;
  return <ProposalSigningPage token={token} preview={preview === "1"} />;
}
