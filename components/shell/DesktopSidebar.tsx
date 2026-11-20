"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { useCustomers } from "@/components/providers/CustomersProvider";
import { useDocuments } from "@/components/providers/DocumentsProvider";
import { useTasks } from "@/components/providers/TasksProvider";
import { useTeam } from "@/components/providers/TeamProvider";
import { Logo } from "@/components/ui/Logo";
import { desktopGroups } from "@/lib/desktopNav";
import { formatMoney, initialsFor } from "@/lib/format";
import { isShown } from "@/lib/menuVisibility";
import { routes } from "@/lib/routes";
import { dueNow, groupTasks, isMine } from "@/lib/tasks";
import { buildThreads, needsReplyCount } from "@/lib/threads";
import { readableInkOn } from "@/lib/userColor";
import { ALL_DESTINATIONS, isActive } from "./navItems";

/**
 * The computer's navigation: every screen at once, grouped, always on screen.
 *
 * Only rendered on a wide screen (the caller shows it only through `desktop:`), so nothing
 * here touches the phone. It reads the same switches as the phone's menu — a
 * screen switched off on the Account page is gone from here too.
 */
export function DesktopSidebar() {
  const pathname = usePathname();
  const { me, author, colorFor, isAdmin } = useTeam();
  const { outstanding } = useDocuments();
  const { customers } = useCustomers();
  const { tasks } = useTasks();

  const unanswered = needsReplyCount(buildThreads(customers));
  // Counted exactly as the dashboard's Follow-ups card counts them: your own,
  // late or due today. Two numbers for one thing would be one too many.
  const now = Date.now();
  const dueGroups = groupTasks(
    dueNow(tasks.filter((task) => isMine(task, author?.uid ?? null)), now),
    now,
  );
  const dueFollowUps = dueGroups.overdue.length + dueGroups.today.length;
  const badges: Record<string, number> = {
    [routes.messages]: unanswered,
    [routes.tasks]: dueFollowUps,
  };

  const groups = desktopGroups(
    ALL_DESTINATIONS.filter((item) => isShown(item.href, me?.hiddenMenu)),
  );
  const myColor = author ? colorFor(author.uid) : "#2f80ff";

  return (
    <aside
      aria-label="Sidebar"
      className="glass m-4 mr-0 flex w-64 shrink-0 flex-col overflow-hidden rounded-3xl border"
    >
      <div className="px-5 pt-5 pb-3">
        <Logo width={132} priority />
      </div>

      <nav aria-label="All screens" className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        {groups.map((group) => (
          <div key={group.label} className="mt-3 first:mt-1">
            <p className="px-3 pb-1 text-[11px] font-extrabold tracking-[0.12em] text-muted/80 uppercase">
              {group.label}
            </p>
            <ul className="flex flex-col gap-0.5">
              {group.items.map(({ href, label, icon: Icon }) => {
                const active = isActive(pathname, href);
                const count = badges[href] ?? 0;
                return (
                  <li key={href}>
                    <Link
                      href={href}
                      aria-current={active ? "page" : undefined}
                      className={`flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-bold transition ${
                        active
                          ? "nav-active text-accent"
                          : "text-muted hover:bg-white/5 hover:text-ink"
                      }`}
                    >
                      <span className="flex size-5 shrink-0 items-center justify-center [&_svg]:size-5">
                        <Icon active={active} />
                      </span>
                      <span className={`min-w-0 flex-1 truncate ${active ? "" : "text-ink/90"}`}>
                        {label}
                      </span>
                      {count > 0 ? (
                        <span className="flex min-w-5 items-center justify-center rounded-full bg-accent px-1.5 text-[11px] font-extrabold text-accent-ink tabular-nums">
                          {count > 9 ? "9+" : count}
                        </span>
                      ) : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="flex flex-col gap-2 border-t border-white/10 p-3">
        {/* Money owed is the owner's figure; a crew member doesn't see it on
            the dashboard either. */}
        {isAdmin ? (
          <Link
            href={routes.invoices}
            className="flex items-center justify-between gap-3 rounded-2xl bg-white/5 px-3 py-2.5 transition hover:bg-white/10"
          >
            <span className="text-xs font-bold text-muted">Owed to you</span>
            <span className="text-base font-extrabold text-money tabular-nums">
              {formatMoney(outstanding)}
            </span>
          </Link>
        ) : null}

        {author ? (
          <Link
            href={routes.account}
            aria-current={isActive(pathname, routes.account) ? "page" : undefined}
            className="flex items-center gap-3 rounded-2xl px-2 py-2 transition hover:bg-white/5"
          >
            <span
              aria-hidden
              className="flex size-9 shrink-0 items-center justify-center rounded-full text-xs font-extrabold"
              style={{ backgroundColor: myColor, color: readableInkOn(myColor) }}
            >
              {initialsFor(author.displayName)}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-bold text-ink">{author.displayName}</span>
              <span className="block text-xs font-semibold text-muted">
                {isAdmin ? "Owner" : "Crew"} · Account
              </span>
            </span>
          </Link>
        ) : null}
      </div>
    </aside>
  );
}
