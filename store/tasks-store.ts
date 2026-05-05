"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface Task {
  id: string;
  title: string;
  notes: string | null;
  dueDate: string | null; // ISO date string yyyy-MM-dd
  contactId: string | null;
  contactName: string | null;
  opportunityId: string | null;
  completed: boolean;
  createdAt: string; // ISO
}

interface TasksStore {
  tasks: Task[];
  addTask: (task: Omit<Task, "id" | "createdAt" | "completed">) => Task;
  completeTask: (id: string) => void;
  deleteTask: (id: string) => void;
}

export const useTasksStore = create<TasksStore>()(
  persist(
    (set, get) => ({
      tasks: [],

      addTask: (input) => {
        const task: Task = {
          ...input,
          id: crypto.randomUUID(),
          completed: false,
          createdAt: new Date().toISOString(),
        };
        set({ tasks: [...get().tasks, task] });
        return task;
      },

      completeTask: (id) => {
        set({ tasks: get().tasks.map((t) => t.id === id ? { ...t, completed: true } : t) });
      },

      deleteTask: (id) => {
        set({ tasks: get().tasks.filter((t) => t.id !== id) });
      },
    }),
    { name: "kracked-tasks" }
  )
);
