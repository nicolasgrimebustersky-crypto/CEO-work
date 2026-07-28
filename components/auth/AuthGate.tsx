"use client";

import type { ReactNode } from "react";

import { useAuth } from "@/components/providers/AuthProvider";
import { Spinner } from "@/components/ui/Spinner";
import { LoginScreen } from "./LoginScreen";
import { SetupScreen } from "./SetupScreen";

/**
 * Every screen sits behind this. There is no unauthenticated route in the app
 * other than the login form itself, so gating once here beats per-page checks.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const { status } = useAuth();

  if (status === "unconfigured") return <SetupScreen />;
  if (status === "loading") {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Spinner label="Loading…" />
      </div>
    );
  }
  if (status === "signed-out") return <LoginScreen />;

  return <>{children}</>;
}
