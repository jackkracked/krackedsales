import { ProposalSigningPage } from "@/components/proposals/public/proposal-signing-page";

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <ProposalSigningPage token={token} />;
}
