import { BoardsListClient } from "@/components/demo-boards/admin/boards-list-client";

export const metadata = { title: "Boards — Kracked Sales" };

export default function BoardsPage() {
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <BoardsListClient />
    </div>
  );
}
