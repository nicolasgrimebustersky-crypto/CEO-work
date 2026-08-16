"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { useAuth } from "@/components/providers/AuthProvider";
import { isPublicRoute } from "@/lib/publicRoutes";
import { Spinner } from "@/components/ui/Spinner";
import { LoginScreen } from "./LoginScreen";
import { SetupScreen } from "./SetupScreen";

/**
 * Every screen but the public ones sits behind this. There is no
 * unauthenticated route in the app besides the login form itself, so gating
 * once here beats per-page checks.
 *
 * Note this only skips the *login wall* — the children handed to it are the
 * provider stack and the shell, so AppShell has to make the same check to drop
 * the navigation. See lib/publicRoutes.ts.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const pathname = usePathname();

  if (isPublicRoute(pathname)) return <>{children}</>;

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
