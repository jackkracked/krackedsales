import { BoardCockpit } from "@/components/demo-boards/admin/board-cockpit";

export const metadata = { title: "Board — Kracked Sales" };

export default async function BoardCockpitPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div className="h-full overflow-hidden">
      <BoardCockpit boardId={id} />
    </div>
  );
}
