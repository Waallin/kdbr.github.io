"use client";

import { useEffect, useMemo, useState } from "react";
import type { User, UserSubscriptionProduct } from "@/stores/useUsersStore";
import { useUsersStore } from "@/stores/useUsersStore";

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

  return {
    total,
    trialActive,
    weeklyActive,
    yearlyActive,
    newLast24h,
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

function UserCard({ user }: { user: User }) {
  const [open, setOpen] = useState(false);
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
        onClick={() => setOpen((v) => !v)}
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
      )}
    </article>
  );
}

export default function Home() {
  const { users, fetchUsers } = useUsersStore();

  const usersByCreatedDesc = useMemo(() => {
    return [...users].sort((a, b) => {
      const ma = getTimestampMs(a.createdAt) ?? 0;
      const mb = getTimestampMs(b.createdAt) ?? 0;
      return mb - ma;
    });
  }, [users]);

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
                : `${users.length} användare`}
            </p>
          </div>
          <ThemeToggle />
        </header>

        {users.length > 0 ? <OverviewStats users={users} /> : null}

        {usersByCreatedDesc.length > 0 && (
          <div className="flex flex-col gap-6">
            {usersByCreatedDesc.map((user) => (
              <UserCard key={user.id} user={user} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
