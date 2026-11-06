"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { subscribeTasks } from "@/lib/db/tasks";
import type { Task } from "@/lib/types";
import { friendlyError } from "@/lib/db/errors";
import { useAuth } from "./AuthProvider";

interface TasksContextValue {
  tasks: Task[];
  byId: Map<string, Task>;
  loading: boolean;
  error: string | null;
}

const TasksContext = createContext<TasksContextValue | null>(null);

/**
 * One listener for the follow-ups. The Follow-ups screen, the card on each
 * client and the dashboard all read it, so ticking one off anywhere clears it
 * everywhere.
 */
export function TasksProvider({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (status !== "signed-in") {
      setTasks([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    return subscribeTasks(
      (next) => {
        setTasks(next);
        setError(null);
        setLoading(false);
      },
      (err) => {
        setError(friendlyError(err, "follow-ups"));
        setLoading(false);
      },
    );
  }, [status]);

  const value = useMemo<TasksContextValue>(
    () => ({
      tasks,
      byId: new Map(tasks.map((task) => [task.id, task])),
      loading,
      error,
    }),
    [tasks, loading, error],
  );

  return (
    <TasksContext.Provider value={value}>{children}</TasksContext.Provider>
  );
}

export function useTasks(): TasksContextValue {
  const ctx = useContext(TasksContext);
  if (!ctx) return { tasks: [], byId: new Map(), loading: false, error: null };
  return ctx;
}
