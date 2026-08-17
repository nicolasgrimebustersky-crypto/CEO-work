"use client";

import { subDays } from "date-fns";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { subscribeJobsFrom } from "@/lib/db/jobs";
import type { Job } from "@/lib/types";
import { friendlyError } from "@/lib/db/errors";
import { useAuth } from "./AuthProvider";

/** How far back the shared calendar keeps jobs loaded. */
const WINDOW_DAYS = 180;

interface JobsContextValue {
  jobs: Job[];
  byId: Map<string, Job>;
  loading: boolean;
  error: string | null;
}

const JobsContext = createContext<JobsContextValue | null>(null);

export function JobsProvider({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Anchored to the day the app loaded so the window doesn't slide mid-session
  // and resubscribe on every render.
  const [windowStart] = useState(() => subDays(new Date(), WINDOW_DAYS));

  useEffect(() => {
    if (status !== "signed-in") {
      setJobs([]);
      setLoading(status === "loading");
      return;
    }
    setLoading(true);
    return subscribeJobsFrom(
      windowStart,
      (next) => {
        setJobs(next);
        setLoading(false);
        setError(null);
      },
      (err) => {
        setError(friendlyError(err, "jobs"));
        setLoading(false);
      },
    );
  }, [status, windowStart]);

  const value = useMemo<JobsContextValue>(
    () => ({ jobs, byId: new Map(jobs.map((job) => [job.id, job])), loading, error }),
    [jobs, loading, error],
  );

  return <JobsContext.Provider value={value}>{children}</JobsContext.Provider>;
}

export function useJobs(): JobsContextValue {
  const ctx = useContext(JobsContext);
  if (!ctx) throw new Error("useJobs must be used inside <JobsProvider>");
  return ctx;
}
