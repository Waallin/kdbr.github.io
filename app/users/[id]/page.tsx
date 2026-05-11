"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useUsersStore } from "@/stores/useUsersStore";
import { getUserDays } from "@/services/firebase";
import {
  formatTimestamp,
  Section,
  Row,
  Badge,
  ThemeToggle,
  hasRevenueCatData,
  anyRevenueCatAccessLive,
  liveActiveSubscriptionLabels,
  prenumerationSummary,
} from "@/lib/user-utils";

export default function UserDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;
  const { users, fetchUsers } = useUsersStore();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [days, setDays] = useState<any[] | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    if (users.length === 0) void fetchUsers();
  }, [users.length, fetchUsers]);

  useEffect(() => {
    if (id) {
      getUserDays(id).then((d) => {
        const sorted = [...d].sort((a, b) =>
          (b.dateKey ?? "").localeCompare(a.dateKey ?? ""),
        );
        setDays(sorted);
      });
    }
  }, [id]);

  const user = users.find((u) => u.id === id);

  if (users.length === 0) {
    return (
      <div className="flex min-h-full flex-1 items-center justify-center bg-app-bg">
        <p className="text-sm text-app-muted">Laddar…</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex min-h-full flex-1 flex-col items-center justify-center gap-4 bg-app-bg">
        <p className="text-sm text-app-muted">Användaren hittades inte.</p>
        <button
          type="button"
          onClick={() => router.push("/")}
          className="rounded-lg border border-app-border bg-app-surface px-4 py-2 text-sm font-medium text-app-text"
          style={{ boxShadow: "var(--app-shadow)" }}
        >
          Tillbaka
        </button>
      </div>
    );
  }

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

  return (
    <div className="flex min-h-full flex-1 flex-col bg-app-bg font-sans">
      <main
        className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-4 py-10 sm:px-6"
        style={{ maxWidth: "64rem" }}
      >
        <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
          <div className="min-w-0 flex-1">
            <button
              type="button"
              onClick={() => router.push("/")}
              className="mb-3 inline-flex items-center gap-1.5 text-sm font-medium text-app-muted transition-colors hover:text-app-text"
            >
              ← Alla användare
            </button>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight text-app-text">
                {displayName}
              </h1>
              {user.platform && <Badge>{user.platform}</Badge>}
              {user.version && <Badge>v{user.version}</Badge>}
              {user.gender && <Badge>{user.gender}</Badge>}
            </div>
            <p
              className="mt-1 truncate font-mono text-xs text-app-muted"
              title={user.email ?? user.id}
            >
              {user.email ?? user.id}
            </p>
            <p className="mt-1 text-sm text-app-muted">
              {prenumerationSummary(user)}
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              className="rounded-lg border border-app-border bg-app-surface px-3 py-2 text-xs font-medium text-app-text transition-colors hover:bg-app-hover"
              style={{ boxShadow: "var(--app-shadow)" }}
            >
              Visa historik
              {days && days.length > 0 && (
                <span className="ml-1.5 tabular-nums text-app-muted">
                  ({days.length})
                </span>
              )}
            </button>
            <ThemeToggle />
          </div>
        </header>

        <div className="grid gap-8 sm:grid-cols-2">
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

      </main>

      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm transition-opacity duration-300"
        style={{
          opacity: drawerOpen ? 1 : 0,
          pointerEvents: drawerOpen ? "auto" : "none",
        }}
        onClick={() => setDrawerOpen(false)}
      />

      {/* Slide-over drawer */}
      <aside
        className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col bg-app-bg transition-transform duration-300 ease-in-out sm:max-w-lg"
        style={{
          transform: drawerOpen ? "translateX(0)" : "translateX(100%)",
          boxShadow: drawerOpen ? "-8px 0 30px rgba(0,0,0,.12)" : "none",
        }}
      >
        {/* Header */}
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
            onClick={() => setDrawerOpen(false)}
            className="rounded-lg p-2 text-app-muted transition-colors hover:bg-app-hover hover:text-app-text"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        </div>

        {/* Content */}
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
                        <span className="text-[11px] text-app-muted">
                          poäng
                        </span>
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
                          {w.logged && w.value != null
                            ? `${w.value} kg`
                            : "Ej vägd"}
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
    </div>
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
