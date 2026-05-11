"use client";

import { useEffect, useMemo, useState } from "react";
import type { User, UserSubscriptionProduct } from "@/stores/useUsersStore";
import { useUsersStore } from "@/stores/useUsersStore";
import { getUserDays } from "@/services/firebase";

function formatTimestamp(ts: unknown): string {
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

function getTimestampMs(ts: unknown): number | null {
  if (ts == null) return null;
  if (typeof ts === "object" && ts !== null && "toDate" in ts) {
    const d = (ts as { toDate: () => Date }).toDate();
    if (d instanceof Date && !Number.isNaN(d.getTime())) return d.getTime();
  }
  if (
    typeof ts === "object" &&
    ts !== null &&
    "seconds" in ts &&
    typeof (ts as { seconds: number }).seconds === "number"
  ) {
    return (ts as { seconds: number }).seconds * 1000;
  }
  return null;
}

function norm(s: string | undefined): string {
  return (s ?? "").trim().toUpperCase();
}

function genderCategory(g: string | undefined): "female" | "male" | "unknown" {
  const n = norm(g);
  if (!n) return "unknown";
  const femaleExact = new Set([
    "F",
    "FEMALE",
    "KVINNA",
    "K",
    "WOMAN",
    "WOMEN",
    "TJEJ",
  ]);
  const maleExact = new Set(["M", "MALE", "MAN", "MÄN", "MANNEN", "KILLE", "HERR"]);
  if (femaleExact.has(n)) return "female";
  if (maleExact.has(n)) return "male";
  if (n.includes("KVINN") || n.includes("WOMAN") || n.includes("FEMALE")) return "female";
  if (n.includes("MALE") && !n.includes("FEMALE")) return "male";
  if (n.includes("MAN") && !n.includes("WOMAN") && !n.includes("KVINN")) return "male";
  return "unknown";
}

function formatPercentOfTotal(count: number, total: number): string {
  if (total === 0) return "—";
  return new Intl.NumberFormat("sv-SE", {
    style: "percent",
    maximumFractionDigits: 1,
  }).format(count / total);
}

function isoOrMillisToMs(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim()) {
    const t = Date.parse(v);
    if (!Number.isNaN(t)) return t;
  }
  return null;
}

function rcLatestExpirationMs(rc: NonNullable<User["revenuecat"]>): number | null {
  if (rc.latestExpirationDateMillis != null && Number.isFinite(rc.latestExpirationDateMillis)) {
    return rc.latestExpirationDateMillis;
  }
  return isoOrMillisToMs(rc.latestExpirationDate);
}

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

function anyRevenueCatAccessLive(user: User, now: number): boolean {
  return userOnActiveTrial(user, now) || activeProductIds(user, now).size > 0;
}

/** Betalande prenumerant: aktiv RC-åtkomst men inte trial. */
function userIsPremiumSubscriber(user: User, now: number): boolean {
  return anyRevenueCatAccessLive(user, now) && !userOnActiveTrial(user, now);
}

type UserListFilter =
  | "all"
  | "trial"
  | "premium"
  | "weekly"
  | "yearly"
  | "inactive";

function userMatchesListFilter(user: User, filter: UserListFilter, now: number): boolean {
  switch (filter) {
    case "all":
      return true;
    case "trial":
      return userOnActiveTrial(user, now);
    case "premium":
      return userIsPremiumSubscriber(user, now);
    case "weekly":
      return liveWeeklySubscriptionNonTrial(user, now);
    case "yearly":
      return liveYearlySubscriptionNonTrial(user, now);
    case "inactive":
      return !anyRevenueCatAccessLive(user, now);
    default:
      return true;
  }
}

function liveActiveSubscriptionLabels(user: User, now: number): string {
  const ids = activeProductIds(user, now);
  if (ids.size === 0) return "—";
  return [...ids].join(", ");
}

function prenumerationSummary(user: User): string {
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

function hasRevenueCatData(rc: User["revenuecat"]): boolean {
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

function computeOverview(users: User[]) {
  const total = users.length;
  if (total === 0) return null;

  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  const newLast24h = users.filter((u) => {
    const ms = getTimestampMs(u.createdAt);
    return ms != null && now - ms <= dayMs;
  }).length;

  const trialActive = users.filter((u) => userOnActiveTrial(u, now)).length;
  const weeklyActive = users.filter((u) => liveWeeklySubscriptionNonTrial(u, now)).length;
  const yearlyActive = users.filter((u) => liveYearlySubscriptionNonTrial(u, now)).length;

  let genderFemale = 0;
  let genderMale = 0;
  let genderUnknown = 0;
  for (const u of users) {
    const c = genderCategory(u.gender);
    if (c === "female") genderFemale++;
    else if (c === "male") genderMale++;
    else genderUnknown++;
  }

  const currentYear = new Date(now).getFullYear();
  const ages: number[] = [];
  let ageUnknown = 0;
  for (const u of users) {
    if (typeof u.birthYear !== "number" || !Number.isFinite(u.birthYear)) {
      ageUnknown++;
      continue;
    }
    const age = currentYear - u.birthYear;
    if (age < 0 || age > 120) {
      ageUnknown++;
      continue;
    }
    ages.push(age);
  }

  const ageMin = ages.length > 0 ? Math.min(...ages) : null;
  const ageMax = ages.length > 0 ? Math.max(...ages) : null;

  let ageMedian: number | null = null;
  if (ages.length > 0) {
    const sorted = [...ages].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    ageMedian =
      sorted.length % 2 === 1 ? sorted[mid]! : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
  }

  let ageBucketUnder18 = 0;
  let ageBucket18_24 = 0;
  let ageBucket25_34 = 0;
  let ageBucket35_44 = 0;
  let ageBucket45_54 = 0;
  let ageBucket55Plus = 0;
  for (const age of ages) {
    if (age < 18) ageBucketUnder18++;
    else if (age <= 24) ageBucket18_24++;
    else if (age <= 34) ageBucket25_34++;
    else if (age <= 44) ageBucket35_44++;
    else if (age <= 54) ageBucket45_54++;
    else ageBucket55Plus++;
  }

  return {
    total,
    trialActive,
    weeklyActive,
    yearlyActive,
    newLast24h,
    genderFemale,
    genderMale,
    genderUnknown,
    ageMin,
    ageMax,
    ageMedian,
    ageBucketUnder18,
    ageBucket18_24,
    ageBucket25_34,
    ageBucket35_44,
    ageBucket45_54,
    ageBucket55Plus,
    ageUnknown,
  };
}

function StatTile({
  label,
  labelMobile,
  value,
  className = "",
}: {
  label: string;
  labelMobile?: string;
  value: string;
  className?: string;
}) {
  return (
    <div
      className={`flex flex-row items-center justify-between gap-3 rounded-xl border border-app-border bg-app-surface px-3 py-3 sm:flex-col sm:items-stretch sm:justify-start sm:px-4 sm:py-4 ${className}`}
      style={{ boxShadow: "var(--app-shadow)" }}
    >
      <span
        className="max-w-[62%] text-[10px] font-semibold uppercase leading-snug tracking-wide text-app-muted sm:max-w-none sm:text-[11px]"
        style={{ letterSpacing: "0.05em" }}
      >
        <span className="sm:hidden">{labelMobile ?? label}</span>
        <span className="hidden sm:inline">{label}</span>
      </span>
      <span className="shrink-0 text-xl font-semibold tabular-nums tracking-tight text-app-primary sm:text-2xl">
        {value}
      </span>
    </div>
  );
}

function OverviewStats({ users }: { users: User[] }) {
  const o = useMemo(() => computeOverview(users), [users]);
  if (!o) return null;

  return (
    <div
      className="rounded-2xl border border-app-border bg-gradient-to-b from-app-surface to-app-bg p-3 sm:p-5"
      style={{ boxShadow: "var(--app-shadow-md)" }}
    >
      <div className="mb-3 sm:mb-4">
        <h2 className="border-l-2 border-app-primary pl-2.5 text-sm font-semibold text-app-text">
          Översikt
        </h2>
      </div>
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 sm:gap-3 lg:grid-cols-5 lg:gap-3">
        <StatTile
          label="Användare totalt"
          labelMobile="Totalt"
          value={String(o.total)}
        />
        <StatTile label="Trial (aktiv)" labelMobile="Trial" value={String(o.trialActive)} />
        <StatTile
          label="Veckoprenumeration"
          labelMobile="Veckoabo"
          value={String(o.weeklyActive)}
        />
        <StatTile
          label="Årsprenumeration"
          labelMobile="Årsabo"
          value={String(o.yearlyActive)}
        />
        <StatTile
          label="Nya (24 h)"
          labelMobile="Nya 24 h"
          value={String(o.newLast24h)}
          className="sm:max-lg:col-span-2 lg:col-span-1"
        />
      </div>

      <div className="mt-6 sm:mt-8">
        <h3
          className="mb-3 text-xs font-semibold uppercase tracking-wide text-app-muted"
          style={{ letterSpacing: "0.05em" }}
        >
          Kön
        </h3>
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3 sm:gap-3">
          <StatTile
            label="Kvinnor"
            labelMobile="Kvinnor"
            value={formatPercentOfTotal(o.genderFemale, o.total)}
          />
          <StatTile
            label="Män"
            labelMobile="Män"
            value={formatPercentOfTotal(o.genderMale, o.total)}
          />
          <StatTile
            label="Okänt / annat"
            labelMobile="Okänt"
            value={formatPercentOfTotal(o.genderUnknown, o.total)}
          />
        </div>
      </div>

      <div className="mt-6 sm:mt-8">
        <h3
          className="mb-3 text-xs font-semibold uppercase tracking-wide text-app-muted"
          style={{ letterSpacing: "0.05em" }}
        >
          Ålder (födelseår)
        </h3>
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 sm:gap-3 lg:grid-cols-3">
          <StatTile
            label="Åldersspann"
            labelMobile="Spann"
            value={
              o.ageMin != null && o.ageMax != null
                ? `${o.ageMin}–${o.ageMax} år`
                : "—"
            }
          />
          <StatTile
            label="Medianålder"
            labelMobile="Median"
            value={o.ageMedian != null ? `${o.ageMedian} år` : "—"}
          />
          <StatTile
            label="Saknar / ogiltigt år"
            labelMobile="Okänt år"
            value={formatPercentOfTotal(o.ageUnknown, o.total)}
          />
        </div>
        <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2 sm:gap-3 lg:grid-cols-3 xl:grid-cols-6 xl:gap-3">
          <StatTile
            label="Under 18 år"
            labelMobile="< 18"
            value={formatPercentOfTotal(o.ageBucketUnder18, o.total)}
          />
          <StatTile
            label="18–24 år"
            labelMobile="18–24"
            value={formatPercentOfTotal(o.ageBucket18_24, o.total)}
          />
          <StatTile
            label="25–34 år"
            labelMobile="25–34"
            value={formatPercentOfTotal(o.ageBucket25_34, o.total)}
          />
          <StatTile
            label="35–44 år"
            labelMobile="35–44"
            value={formatPercentOfTotal(o.ageBucket35_44, o.total)}
          />
          <StatTile
            label="45–54 år"
            labelMobile="45–54"
            value={formatPercentOfTotal(o.ageBucket45_54, o.total)}
          />
          <StatTile
            label="55 år och upp"
            labelMobile="55+"
            value={formatPercentOfTotal(o.ageBucket55Plus, o.total)}
            className="sm:max-xl:col-span-2 xl:col-span-1"
          />
        </div>
      </div>
    </div>
  );
}

function Section({
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

function Row({
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

function ThemeToggle() {
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

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="inline-flex items-center rounded-md bg-[var(--app-badge-bg)] px-2 py-0.5 text-xs font-medium text-app-primary"
      style={{ width: "fit-content" }}
    >
      {children}
    </span>
  );
}

function DayCheck({ label, done }: { label: string; done: boolean }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium"
      style={{
        background: done
          ? "color-mix(in srgb, var(--app-primary) 12%, transparent)"
          : "color-mix(in srgb, var(--app-muted) 10%, transparent)",
        color: done ? "var(--app-primary)" : "var(--app-muted)",
      }}
    >
      <span style={{ fontSize: "0.7rem" }}>{done ? "✓" : "✗"}</span>
      {label}
    </span>
  );
}

function DaysDrawer({
  open,
  onClose,
  days,
}: {
  open: boolean;
  onClose: () => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  days: any[] | null;
}) {
  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm transition-opacity duration-300"
        style={{
          opacity: open ? 1 : 0,
          pointerEvents: open ? "auto" : "none",
        }}
        onClick={onClose}
      />
      <aside
        className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col bg-app-bg transition-transform duration-300 ease-in-out sm:max-w-lg"
        style={{
          transform: open ? "translateX(0)" : "translateX(100%)",
          boxShadow: open ? "-8px 0 30px rgba(0,0,0,.12)" : "none",
        }}
      >
        <div className="flex items-center justify-between border-b border-app-border px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-app-text">Historik</h2>
            {days && (
              <p className="text-xs text-app-muted">
                {days.length} {days.length === 1 ? "dag" : "dagar"}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-app-muted transition-colors hover:bg-app-hover hover:text-app-text"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {days === null ? (
            <p className="text-sm text-app-muted">Laddar dagar…</p>
          ) : days.length === 0 ? (
            <p className="text-sm text-app-muted">Inga dagar registrerade.</p>
          ) : (
            <div className="flex flex-col gap-3">
              {days.map((day) => {
                const comp = day.completion ?? {};
                const pts = day.points ?? {};
                const prog = day.progress ?? {};
                const w = day.weight ?? {};
                const allDone = comp.steps && comp.water && comp.points;

                return (
                  <div
                    key={day.id}
                    className="overflow-hidden rounded-xl border border-app-border bg-app-surface"
                    style={{ boxShadow: "var(--app-shadow)" }}
                  >
                    <div
                      className="flex items-center justify-between px-4 py-2.5"
                      style={{
                        background: allDone
                          ? "color-mix(in srgb, var(--app-primary) 8%, var(--app-surface))"
                          : undefined,
                      }}
                    >
                      <span className="text-sm font-semibold text-app-text">
                        {day.dateKey ?? day.id}
                      </span>
                      <div className="flex items-center gap-1.5">
                        <DayCheck label="Steg" done={!!comp.steps} />
                        <DayCheck label="Vatten" done={!!comp.water} />
                        <DayCheck label="Poäng" done={!!comp.points} />
                      </div>
                    </div>

                    <div className="border-t border-app-border-subtle px-4 py-3">
                      <div className="flex items-baseline gap-2">
                        <span className="text-lg font-semibold tabular-nums text-app-primary">
                          {pts.total ?? 0}
                        </span>
                        <span className="text-[11px] text-app-muted">poäng</span>
                        <span className="text-[11px] text-app-muted">
                          (bas {pts.base ?? 0} · bonus {pts.stepBonus ?? 0} · använt {pts.used ?? 0})
                        </span>
                      </div>

                      <div className="mt-2 flex items-center gap-4 text-sm text-app-text">
                        <span>
                          <span className="font-medium tabular-nums">{prog.steps ?? 0}</span>
                          <span className="ml-1 text-xs text-app-muted">steg</span>
                        </span>
                        <span>
                          <span className="font-medium tabular-nums">{prog.water ?? 0}</span>
                          <span className="ml-1 text-xs text-app-muted">vatten</span>
                        </span>
                        <span className="ml-auto text-xs text-app-muted">
                          {w.logged && w.value != null ? `${w.value} kg` : "Ej vägd"}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </aside>
    </>
  );
}

function UserCard({ user }: { user: User }) {
  const [open, setOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [days, setDays] = useState<any[] | null>(null);
  const rc = user.revenuecat;
  const weekly = rc?.subscriptionsByProductIdentifier?.WEEKLY;
  const premium = rc?.entitlements?.active
    ? Object.values(rc.entitlements.active)[0]
    : undefined;
  const readPerms = user.healthKitPermission?.permissions?.read;
  const readSummary =
    readPerms && Object.keys(readPerms).length > 0
      ? Object.entries(readPerms)
          .map(([k, v]) => `${k}: ${v}`)
          .join(", ")
      : "—";

  const token = user.notificationToken ?? "";
  const tokenShort =
    token.length > 36 ? `${token.slice(0, 20)}…${token.slice(-8)}` : token || "—";

  const displayName = user.name?.trim() || user.email || user.id;
  const rcNow = Date.now();
  const subSummary = prenumerationSummary(user);

  return (
    <article
      className="overflow-hidden rounded-xl border border-app-border bg-app-surface"
      style={{ boxShadow: "var(--app-shadow)" }}
    >
      <button
        type="button"
        onClick={() => {
          if (!open) {
            getUserDays(user.id).then((days) => console.log(`Days for ${user.id}:`, days));
          }
          setOpen((v) => !v);
        }}
        aria-expanded={open}
        aria-label={open ? "Visa mindre om användaren" : "Visa mer om användaren"}
        className="flex w-full cursor-pointer flex-col gap-3 border-b border-app-border-subtle bg-[color-mix(in_srgb,var(--app-surface)_88%,var(--app-bg))] px-5 py-4 text-left transition-colors hover:bg-app-hover"
        style={{ borderBottomWidth: "1px" }}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold text-app-text">
                {displayName}
              </h2>
              {user.platform && <Badge>{user.platform}</Badge>}
              {open && user.version && <Badge>v{user.version}</Badge>}
              {open && user.gender && <Badge>{user.gender}</Badge>}
            </div>
            <p
              className="mt-1 truncate font-mono text-xs text-app-muted"
              title={user.email ?? user.id}
            >
              {user.email ?? user.id}
            </p>
          </div>
          <span
            className="mt-1 shrink-0 text-app-muted transition-transform"
            style={{
              transform: open ? "rotate(180deg)" : "rotate(0deg)",
              fontSize: "0.75rem",
              lineHeight: 1,
            }}
            aria-hidden
          >
            ▼
          </span>
        </div>
        {!open && (
          <p className="text-sm text-app-muted">
            <span className="text-app-text/80">Skapad: </span>
            {formatTimestamp(user.createdAt)}
            <span className="mx-2 text-app-border">·</span>
            <span className="text-app-text/80">Vikt: </span>
            {user.currentWeight ?? "—"} kg
            {user.goalWeight != null ? ` → ${user.goalWeight} kg` : ""}
            <span className="mx-2 text-app-border">·</span>
            <span className="text-app-text/80">Prenum: </span>
            {subSummary}
          </p>
        )}
      </button>

      {open && (
        <>
        <div className="grid gap-8 p-5 sm:grid-cols-2">
          <Section title="Konto & aktivitet">
            <Row label="Senast aktiv" value={formatTimestamp(user.lastActiveAt)} />
            <Row label="Skapad" value={formatTimestamp(user.createdAt)} />
            <Row label="App-öppningar" value={user.totalAppsOpen ?? "—"} />
            <Row
              label="Push-token"
              value={<span title={token || undefined}>{tokenShort}</span>}
              mono
            />
          </Section>

          <Section title="Profil">
            <Row label="Födelseår" value={user.birthYear ?? "—"} />
            <Row label="Längd (cm)" value={user.height ?? "—"} />
            <Row label="Nuvarande vikt" value={user.currentWeight ?? "—"} />
            <Row label="Målvikt" value={user.goalWeight ?? "—"} />
            <Row label="Startvikt" value={user.startWeight ?? "—"} />
          </Section>

          <Section title="HealthKit">
            <Row label="Status" value={user.healthKitPermission?.status ?? "—"} />
            <Row
              label="Beviljad"
              value={
                user.healthKitPermission?.granted === undefined
                  ? "—"
                  : user.healthKitPermission.granted
                    ? "Ja"
                    : "Nej"
              }
            />
            <Row
              label="Kan fråga igen"
              value={
                user.healthKitPermission?.canAskAgain === undefined
                  ? "—"
                  : user.healthKitPermission.canAskAgain
                    ? "Ja"
                    : "Nej"
              }
            />
            <Row label="Läsrättigheter" value={readSummary} />
          </Section>

          <Section title="Prenumeration (RevenueCat)">
            {!hasRevenueCatData(rc) ? (
              <p className="text-sm text-app-muted">
                Ingen RevenueCat-data för den här användaren.
              </p>
            ) : (
              <>
                <Row
                  label="Giltig nu (ej utgången)"
                  value={anyRevenueCatAccessLive(user, rcNow) ? "Ja" : "Nej"}
                />
                <Row
                  label="Aktiva produkter (ej utgångna)"
                  value={liveActiveSubscriptionLabels(user, rcNow)}
                />
                <Row
                  label="Aktiva (rålista RC)"
                  value={
                    rc?.activeSubscriptions?.length
                      ? rc.activeSubscriptions.join(", ")
                      : "—"
                  }
                />
                <Row label="Senaste utgång (RC)" value={rc?.latestExpirationDate ?? "—"} />
                <Row
                  label="Produkt"
                  value={
                    weekly?.productIdentifier ?? premium?.productIdentifier ?? "—"
                  }
                />
                <Row
                  label="Pris"
                  value={
                    weekly?.price != null
                      ? `${weekly.price.amount ?? "—"} ${weekly.price.currency ?? ""}`.trim()
                      : "—"
                  }
                />
                <Row label="Butik" value={weekly?.store ?? "—"} />
                <Row
                  label="Sandbox"
                  value={
                    weekly?.isSandbox === undefined
                      ? "—"
                      : weekly.isSandbox
                        ? "Ja"
                        : "Nej"
                  }
                />
                <Row
                  label="Förnyas"
                  value={
                    weekly?.willRenew === undefined
                      ? "—"
                      : weekly.willRenew
                        ? "Ja"
                        : "Nej"
                  }
                />
                {rc?.managementURL && (
                  <Row
                    label="Hantera"
                    value={
                      <a
                        href={rc.managementURL}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-medium text-app-primary underline decoration-app-primary/35 underline-offset-2 hover:decoration-app-primary"
                      >
                        App Store
                      </a>
                    }
                  />
                )}
                {rc?.originalAppUserId && (
                  <Row label="RC anonymous id" value={rc.originalAppUserId} mono />
                )}
                <Row label="Först sedd" value={rc?.firstSeen ?? "—"} />
                <Row label="RC request" value={rc?.requestDate ?? "—"} />
              </>
            )}
          </Section>
        </div>

        <div className="border-t border-app-border-subtle px-5 py-3">
          <button
            type="button"
            onClick={() => {
              if (!days) {
                getUserDays(user.id).then((d) => {
                  const sorted = [...d].sort((a, b) =>
                    ((b as Record<string, string>).dateKey ?? "").localeCompare(
                      (a as Record<string, string>).dateKey ?? "",
                    ),
                  );
                  setDays(sorted);
                });
              }
              setDrawerOpen(true);
            }}
            className="text-sm font-medium text-app-primary underline decoration-app-primary/35 underline-offset-2 transition-colors hover:decoration-app-primary"
          >
            Visa historik →
          </button>
        </div>
        </>
      )}

      <DaysDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} days={days} />
    </article>
  );
}

export default function Home() {
  const { users, fetchUsers } = useUsersStore();
  const [listFilter, setListFilter] = useState<UserListFilter>("all");
  const [showStats, setShowStats] = useState(false);

  const usersByCreatedDesc = useMemo(() => {
    return [...users].sort((a, b) => {
      const ma = getTimestampMs(a.createdAt) ?? 0;
      const mb = getTimestampMs(b.createdAt) ?? 0;
      return mb - ma;
    });
  }, [users]);

  const filteredUsers = useMemo(() => {
    const now = Date.now();
    return usersByCreatedDesc.filter((u) => userMatchesListFilter(u, listFilter, now));
  }, [usersByCreatedDesc, listFilter]);

  useEffect(() => {
    void fetchUsers();
  }, [fetchUsers]);

  return (
    <div className="flex min-h-full flex-1 flex-col bg-app-bg font-sans">
      <main
        className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-4 py-10 sm:px-6"
        style={{ maxWidth: "64rem" }}
      >
        <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-semibold tracking-tight text-app-text">
              Användare
            </h1>
            <p className="text-sm text-app-muted">
              {users.length === 0
                ? "Inga användare hittades i Firestore (collection: users)."
                : listFilter === "all"
                  ? `${users.length} användare`
                  : `${filteredUsers.length} av ${users.length} användare`}
            </p>
            {users.length > 0 ? (
              <label className="mt-3 flex max-w-md flex-col gap-1.5">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-app-muted">
                  Filtrera lista
                </span>
                <select
                  value={listFilter}
                  onChange={(e) => setListFilter(e.target.value as UserListFilter)}
                  className="rounded-lg border border-app-border bg-app-surface px-3 py-2 text-sm text-app-text"
                  style={{ boxShadow: "var(--app-shadow)" }}
                >
                  <option value="all">Alla</option>
                  <option value="premium">Premium (betalande)</option>
                  <option value="trial">Trial (aktiv)</option>
                  <option value="weekly">Veckoprenumeration</option>
                  <option value="yearly">Årsprenumeration</option>
                  <option value="inactive">Ingen aktiv prenumeration</option>
                </select>
              </label>
            ) : null}
          </div>
          <div className="flex shrink-0 flex-col gap-2 sm:flex-row sm:items-start sm:justify-end">
            {users.length > 0 ? (
              <button
                type="button"
                onClick={() => setShowStats((v) => !v)}
                aria-expanded={showStats}
                className="rounded-lg border border-app-border bg-app-surface px-3 py-2 text-xs font-medium text-app-text"
                style={{ boxShadow: "var(--app-shadow)" }}
              >
                {showStats ? "Dölj statistik" : "Visa statistik"}
              </button>
            ) : null}
            <ThemeToggle />
          </div>
        </header>

        {users.length > 0 && showStats ? (
          <OverviewStats users={filteredUsers} />
        ) : null}

        {filteredUsers.length > 0 ? (
          <div className="flex flex-col gap-6">
            {filteredUsers.map((user) => (
              <UserCard key={user.id} user={user} />
            ))}
          </div>
        ) : users.length > 0 ? (
          <p className="text-sm text-app-muted">Inga användare matchar filtret.</p>
        ) : null}
      </main>
    </div>
  );
}
