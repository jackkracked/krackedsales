import type { Metadata } from "next";
import { DemoBoardPage } from "@/components/demo-boards/public/demo-board-page";
import { getBoardByToken } from "@/lib/demo-boards/queries";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  const { token } = await params;
  const board = await getBoardByToken(token);
  const who = board?.contactName ? board.contactName.split(" ")[0] : null;
  const title = who ? `A demo for ${who} · Kracked` : "Your demo · Kracked";
  return {
    title,
    description: "A custom email design, prepared for you by Kracked.",
    robots: { index: false, follow: false },
  };
}

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ preview?: string }>;
}) {
  const { token } = await params;
  const { preview } = await searchParams;
  return <DemoBoardPage token={token} preview={preview === "1"} />;
}
