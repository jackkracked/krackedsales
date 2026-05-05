import { create } from "zustand";

interface FlowEditorStore {
  activeNodeId: string | null;
  open: (id: string) => void;
  close: () => void;
}

export const useFlowEditor = create<FlowEditorStore>((set) => ({
  activeNodeId: null,
  open:  (id) => set({ activeNodeId: id }),
  close: ()   => set({ activeNodeId: null }),
}));
