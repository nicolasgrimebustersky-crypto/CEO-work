import {
  addMinutes,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  isSameDay,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from "date-fns";

import type { Job } from "./types";

/** The timeline only covers working hours — nobody schedules a wash at 3am. */
export const DAY_START_HOUR = 6;
export const DAY_END_HOUR = 21;
export const SLOT_MINUTES = 30;
export const SLOTS_PER_DAY = ((DAY_END_HOUR - DAY_START_HOUR) * 60) / SLOT_MINUTES;

/** Default visit length when creating a job, in minutes. */
export const DEFAULT_JOB_MINUTES = 90;

export type CalendarView = "day" | "week" | "month";

export function minutesFromMidnight(date: Date): number {
  return date.getHours() * 60 + date.getMinutes();
}

export function snapToSlot(minutes: number): number {
  return Math.round(minutes / SLOT_MINUTES) * SLOT_MINUTES;
}

/** Builds a Date on `day` at `minutes` past midnight. */
export function atMinutes(day: Date, minutes: number): Date {
  return addMinutes(startOfDay(day), minutes);
}

export function formatSlotLabel(minutes: number): string {
  const hour24 = Math.floor(minutes / 60);
  const minute = minutes % 60;
  const suffix = hour24 >= 12 ? "pm" : "am";
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return minute === 0 ? `${hour12}${suffix}` : `${hour12}:${String(minute).padStart(2, "0")}${suffix}`;
}

export function jobsOnDay(jobs: Job[], day: Date): Job[] {
  return jobs
    .filter((job) => isSameDay(job.scheduledStart.toDate(), day))
    .sort((a, b) => a.scheduledStart.toMillis() - b.scheduledStart.toMillis());
}

export function weekDays(anchor: Date): Date[] {
  return eachDayOfInterval({
    start: startOfWeek(anchor, { weekStartsOn: 0 }),
    end: endOfWeek(anchor, { weekStartsOn: 0 }),
  });
}

/** Always six rows, so the month grid doesn't change height between months. */
export function monthGridDays(anchor: Date): Date[] {
  const start = startOfWeek(startOfMonth(anchor), { weekStartsOn: 0 });
  return Array.from({ length: 42 }, (_, index) => addMinutes(start, index * 24 * 60));
}

export function isInMonth(day: Date, anchor: Date): boolean {
  return day >= startOfMonth(anchor) && day <= endOfMonth(anchor);
}

export function jobDurationMinutes(job: Job): number {
  const ms = job.scheduledEnd.toMillis() - job.scheduledStart.toMillis();
  return Math.max(Math.round(ms / 60000), SLOT_MINUTES);
}

/** ISO date key (local, not UTC) used to tag calendar drop targets. */
export function dayKey(day: Date): string {
  const year = day.getFullYear();
  const month = String(day.getMonth() + 1).padStart(2, "0");
  const date = String(day.getDate()).padStart(2, "0");
  return `${year}-${month}-${date}`;
}

export function dayFromKey(key: string): Date {
  const [year, month, date] = key.split("-").map(Number);
  return new Date(year, (month ?? 1) - 1, date ?? 1);
}
