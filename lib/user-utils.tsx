"use client";

import { useEffect, useState } from "react";
import type { User } from "@/stores/useUsersStore";

export function formatTimestamp(ts: unknown): string {
  if (ts == null) return "—";
  if (typeof ts === "object" && ts !== null && "toDate" in ts) {
    const d = (ts as { toDate: () => Date }).toDate();
    if (d instanceof Date && !Number.isNaN(d.getTime())) {
      return d.toLocaleString("sv-SE", { dateStyle: "short", timeStyle: "short" });
    }
  }
  if (
    typeof ts === "object" &&
    ts !== null &&
    "seconds" in ts &&
    typeof (ts as { seconds: number }).seconds === "number"
  ) {
    const ms = (ts as { seconds: number }).seconds * 1000;
    return new Date(ms).toLocaleString("sv-SE", {
      dateStyle: "short",
      timeStyle: "short",
    });
  }
  return "—";
}

function isoOrMillisToMs(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim()) {
    const t = Date.parse(v);
    if (!Number.isNaN(t)) return t;
  }
  return null;
}

function norm(s: string | undefined): string {
  return (s ?? "").trim().toUpperCase();
}

type UserSubscriptionProduct = NonNullable<
  NonNullable<User["revenuecat"]>["subscriptionsByProductIdentifier"]
>[string];

function subscriptionProductIsLive(p: UserSubscriptionProduct | undefined, now: number): boolean {
  if (p?.isActive !== true) return false;
  const exp = isoOrMillisToMs(p.expiresDate);
  if (exp != null) return exp > now;
  return true;
}

type EntitlementRow = NonNullable<
  NonNullable<User["revenuecat"]>["entitlements"]
>["active"] extends Record<string, infer V> | undefined
  ? V
  : never;

function entitlementIsLive(e: EntitlementRow | undefined, now: number): boolean {
  if (e?.isActive !== true) return false;
  if (e.expirationDateMillis != null && Number.isFinite(e.expirationDateMillis)) {
    return e.expirationDateMillis > now;
  }
  const exp = isoOrMillisToMs(e.expirationDate);
  if (exp != null) return exp > now;
  return true;
}

function userOnActiveTrial(user: User, now: number): boolean {
  const rc = user.revenuecat;
  if (!rc) return false;
  const byProd = rc.subscriptionsByProductIdentifier;
  if (byProd) {
    for (const p of Object.values(byProd)) {
      if (norm(p?.periodType) !== "TRIAL") continue;
      if (!subscriptionProductIsLive(p, now)) continue;
      return true;
    }
  }
  const active = rc.entitlements?.active;
  if (active) {
    for (const e of Object.values(active)) {
      if (norm(e?.periodType) !== "TRIAL") continue;
      if (!entitlementIsLive(e, now)) continue;
      return true;
    }
  }
  return false;
}

function findSubProduct(
  rc: NonNullable<User["revenuecat"]>,
  productIdNorm: string,
): UserSubscriptionProduct | undefined {
  const byProd = rc.subscriptionsByProductIdentifier;
  if (!byProd) return undefined;
  for (const [key, p] of Object.entries(byProd)) {
    if (norm(key) === productIdNorm) return p;
    if (norm(p.productIdentifier) === productIdNorm) return p;
  }
  return undefined;
}

function rcLatestExpirationMs(rc: NonNullable<User["revenuecat"]>): number | null {
  if (rc.latestExpirationDateMillis != null && Number.isFinite(rc.latestExpirationDateMillis)) {
    return rc.latestExpirationDateMillis;
  }
  return isoOrMillisToMs(rc.latestExpirationDate);
}

function activeProductIds(user: User, now: number): Set<string> {
  const rc = user.revenuecat;
  const ids = new Set<string>();
  if (!rc) return ids;
  const byProd = rc.subscriptionsByProductIdentifier;
  const ent = rc.entitlements?.active;

  if (byProd) {
    for (const [key, p] of Object.entries(byProd)) {
      if (!subscriptionProductIsLive(p, now)) continue;
      ids.add(norm(key));
      if (p.productIdentifier) ids.add(norm(p.productIdentifier));
    }
  }

  if (ent) {
    for (const e of Object.values(ent)) {
      if (!entitlementIsLive(e, now)) continue;
      if (e.productIdentifier) ids.add(norm(e.productIdentifier));
    }
  }

  for (const rawId of rc.activeSubscriptions ?? []) {
    const pid = norm(rawId);
    if (ids.has(pid)) continue;
    const p = findSubProduct(rc, pid);
    if (p && subscriptionProductIsLive(p, now)) {
      ids.add(pid);
      continue;
    }
    if (ent) {
      for (const e of Object.values(ent)) {
        if (!entitlementIsLive(e, now)) continue;
        if (norm(e.productIdentifier) === pid) {
          ids.add(pid);
          break;
        }
      }
    }
  }

  const noDetail =
    (!byProd || Object.keys(byProd).length === 0) &&
    (!ent || Object.keys(ent).length === 0);
  if (noDetail && (rc.activeSubscriptions?.length ?? 0) > 0) {
    const g = rcLatestExpirationMs(rc);
    if (g != null && g > now) {
      for (const rawId of rc.activeSubscriptions ?? []) {
        if (rawId) ids.add(norm(rawId));
      }
    }
  }

  return ids;
}

function isYearlyProductId(id: string): boolean {
  if (id === "WEEKLY") return false;
  return (
    id === "YEARLY" ||
    id === "ANNUAL" ||
    id === "YEAR" ||
    id.includes("YEARLY") ||
    id.includes("ANNUAL")
  );
}

function liveWeeklySubscriptionNonTrial(user: User, now: number): boolean {
  const rc = user.revenuecat;
  if (!rc) return false;
  const byProd = rc.subscriptionsByProductIdentifier;
  if (byProd) {
    for (const [key, p] of Object.entries(byProd)) {
      if (norm(key) !== "WEEKLY" && norm(p.productIdentifier) !== "WEEKLY") continue;
      if (!subscriptionProductIsLive(p, now)) continue;
      if (norm(p.periodType) === "TRIAL") continue;
      return true;
    }
  }
  const ent = rc.entitlements?.active;
  if (ent) {
    for (const e of Object.values(ent)) {
      if (norm(e.productIdentifier) !== "WEEKLY") continue;
      if (!entitlementIsLive(e, now)) continue;
      if (norm(e.periodType) === "TRIAL") continue;
      return true;
    }
  }
  if (userOnActiveTrial(user, now)) return false;
  return activeProductIds(user, now).has("WEEKLY");
}

function liveYearlySubscriptionNonTrial(user: User, now: number): boolean {
  const rc = user.revenuecat;
  if (!rc) return false;
  const byProd = rc.subscriptionsByProductIdentifier;
  if (byProd) {
    for (const [key, p] of Object.entries(byProd)) {
      const kn = norm(key);
      const pin = norm(p.productIdentifier ?? "");
      if (!isYearlyProductId(kn) && !isYearlyProductId(pin)) continue;
      if (!subscriptionProductIsLive(p, now)) continue;
      if (norm(p.periodType) === "TRIAL") continue;
      return true;
    }
  }
  const ent = rc.entitlements?.active;
  if (ent) {
    for (const e of Object.values(ent)) {
      const pin = norm(e.productIdentifier ?? "");
      if (!isYearlyProductId(pin)) continue;
      if (!entitlementIsLive(e, now)) continue;
      if (norm(e.periodType) === "TRIAL") continue;
      return true;
    }
  }
  if (userOnActiveTrial(user, now)) return false;
  for (const id of activeProductIds(user, now)) {
    if (isYearlyProductId(id)) return true;
  }
  return false;
}

export function anyRevenueCatAccessLive(user: User, now: number): boolean {
  return userOnActiveTrial(user, now) || activeProductIds(user, now).size > 0;
}

export function liveActiveSubscriptionLabels(user: User, now: number): string {
  const ids = activeProductIds(user, now);
  if (ids.size === 0) return "—";
  return [...ids].join(", ");
}

export function prenumerationSummary(user: User): string {
  const now = Date.now();
  if (userOnActiveTrial(user, now)) return "Trial (aktiv)";
  if (liveWeeklySubscriptionNonTrial(user, now)) {
    const rc = user.revenuecat;
    const parts = [
      rc?.subscriptionsByProductIdentifier?.WEEKLY?.productIdentifier ?? "WEEKLY",
      rc?.latestExpirationDate,
    ].filter(Boolean) as string[];
    return parts.length ? parts.join(" · ") : "Vecko (aktiv)";
  }
  if (liveYearlySubscriptionNonTrial(user, now)) {
    const rc = user.revenuecat;
    return rc?.latestExpirationDate?.trim() ? rc.latestExpirationDate : "Årsabbo (aktiv)";
  }
  if (activeProductIds(user, now).size > 0) return "Aktiv prenumeration";
  if (hasRevenueCatData(user.revenuecat)) return "Utgången / ingen aktiv";
  return "Ingen aktiv";
}

export function hasRevenueCatData(rc: User["revenuecat"]): boolean {
  if (rc == null) return false;
  if ((rc.activeSubscriptions?.length ?? 0) > 0) return true;
  const byProd = rc.subscriptionsByProductIdentifier;
  if (byProd && Object.keys(byProd).length > 0) return true;
  const activeEnt = rc.entitlements?.active;
  if (activeEnt && Object.keys(activeEnt).length > 0) return true;
  if (rc.latestExpirationDate?.trim()) return true;
  if (rc.managementURL?.trim()) return true;
  if (rc.originalAppUserId?.trim()) return true;
  if (rc.firstSeen?.trim()) return true;
  if (rc.requestDate?.trim()) return true;
  return false;
}

export function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <h3
        className="text-xs font-semibold uppercase tracking-wide text-app-muted"
        style={{ letterSpacing: "0.05em" }}
      >
        {title}
      </h3>
      <div className="flex flex-col gap-2">{children}</div>
    </section>
  );
}

export function Row({
  label,
  value,
  mono,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div
      className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4"
      style={{ wordBreak: "break-word" }}
    >
      <span className="shrink-0 text-sm text-app-muted">{label}</span>
      <span
        className={`text-sm text-app-text ${mono ? "font-mono text-xs sm:text-right" : ""}`}
      >
        {value}
      </span>
    </div>
  );
}

export function ThemeToggle() {
  const [mode, setMode] = useState<"light" | "dark">("light");

  useEffect(() => {
    setMode(
      document.documentElement.classList.contains("dark") ? "dark" : "light",
    );
  }, []);

  return (
    <button
      type="button"
      onClick={() => {
        const next =
          document.documentElement.classList.contains("dark") ? "light" : "dark";
        document.documentElement.classList.toggle("dark", next === "dark");
        localStorage.setItem("kudoo-theme", next);
        setMode(next);
      }}
      className="shrink-0 rounded-lg border border-app-border bg-app-surface px-3 py-2 text-xs font-medium text-app-text"
      style={{ boxShadow: "var(--app-shadow)" }}
    >
      {mode === "dark" ? "Ljust läge" : "Mörkt läge"}
    </button>
  );
}

export function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="inline-flex items-center rounded-md bg-[var(--app-badge-bg)] px-2 py-0.5 text-xs font-medium text-app-primary"
      style={{ width: "fit-content" }}
    >
      {children}
    </span>
  );
}
