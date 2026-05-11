"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  UserPlus, Users, X, ChevronRight, Eye, EyeOff, RefreshCw, CheckCircle2, KeyRound,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { FEATURES, FEATURE_LABELS, type FeatureKey } from "@/lib/auth/permission-constants";

// ─── Types ────────────────────────────────────────────────────────────────────

interface TeamUser {
  id: string;
  name: string;
  email: string;
  role: string;
  isActive: boolean;
  ghlUserId: string | null;
  createdAt: string;
  targets: {
    dealsPerMonth: number;
    callsPerDay: number;
    revenueTarget: number;
  } | null;
  permissionOverrides: Record<string, boolean>;
  rolePreset: Record<string, boolean>;
}

// ─── Small UI primitives ───────────────────────────────────────────────────────

function UserInitials({ name }: { name: string }) {
  const initials = name.split(" ").map((n) => n[0]).slice(0, 2).join("").toUpperCase();
  return (
    <div className="w-9 h-9 rounded-full bg-primary/15 flex items-center justify-center text-sm font-bold text-primary shrink-0">
      {initials || "?"}
    </div>
  );
}

function RoleBadge({ role }: { role: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center px-2 py-0.5 rounded-[4px] text-[10px] font-semibold uppercase tracking-wide",
        role === "admin"
          ? "bg-primary/15 text-primary"
          : "bg-muted text-muted-foreground"
      )}
    >
      {role}
    </span>
  );
}

function Input({
  label, value, onChange, type = "text", placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-foreground">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={cn(
          "w-full rounded-[6px] border border-border bg-background px-3 py-2",
          "text-sm text-foreground placeholder:text-muted-foreground",
          "focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors"
        )}
      />
    </div>
  );
}

function NumberInput({
  label, value, onChange, min = 0,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-foreground">{label}</label>
      <input
        type="number"
        min={min}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className={cn(
          "w-full rounded-[6px] border border-border bg-background px-3 py-2",
          "text-sm text-foreground tabular-nums",
          "focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors"
        )}
      />
    </div>
  );
}

function Toggle({
  label, checked, onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="flex items-center justify-between w-full py-2 group"
    >
      <span className="text-sm text-foreground">{label}</span>
      <span
        className={cn(
          "relative inline-flex w-8 h-4 rounded-full transition-colors duration-150 shrink-0",
          checked ? "bg-primary" : "bg-muted"
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform duration-150",
            checked ? "translate-x-4" : "translate-x-0.5"
          )}
        />
      </span>
    </button>
  );
}

// ─── Slide-over panel ─────────────────────────────────────────────────────────

interface SlideOverProps {
  user: TeamUser;
  onClose: () => void;
}

function SlideOver({ user, onClose }: SlideOverProps) {
  const queryClient = useQueryClient();

  // Profile fields
  const [name, setName] = useState(user.name);
  const [email, setEmail] = useState(user.email);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showNewPassword, setShowNewPassword] = useState(false);

  const [role, setRole] = useState(user.role);
  const [isActive, setIsActive] = useState(user.isActive);
  const [ghlUserId, setGhlUserId] = useState(user.ghlUserId ?? "");
  const [dealsPerMonth, setDealsPerMonth] = useState(user.targets?.dealsPerMonth ?? 5);
  const [callsPerDay, setCallsPerDay] = useState(user.targets?.callsPerDay ?? 15);
  const [revenueTarget, setRevenueTarget] = useState(user.targets?.revenueTarget ?? 0);

  // Build current permission state: rolePreset + overrides
  const initialPerms: Record<FeatureKey, boolean> = {} as Record<FeatureKey, boolean>;
  for (const f of FEATURES) {
    const override = user.permissionOverrides[f];
    initialPerms[f] = override !== undefined ? override : (user.rolePreset[f] ?? role === "admin");
  }
  const [perms, setPerms] = useState<Record<FeatureKey, boolean>>(initialPerms);

  const mutation = useMutation({
    mutationFn: (payload: object) =>
      fetch("/api/settings/team", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.id, ...payload }),
      }).then((r) => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["team-settings"] });
      onClose();
    },
  });

  const passwordMismatch = newPassword.length > 0 && newPassword !== confirmPassword;
  const passwordTooShort = newPassword.length > 0 && newPassword.length < 8;

  function handleSave() {
    if (passwordMismatch || passwordTooShort) return;

    // Only store overrides that differ from the current role preset
    const overrides: Record<string, boolean> = {};
    for (const f of FEATURES) {
      const roleDefault = user.rolePreset[f] ?? role === "admin";
      if (perms[f] !== roleDefault) {
        overrides[f] = perms[f];
      }
    }

    mutation.mutate({
      name: name.trim() !== user.name ? name : undefined,
      email: email.trim().toLowerCase() !== user.email ? email : undefined,
      newPassword: newPassword.length >= 8 ? newPassword : undefined,
      role,
      isActive,
      ghlUserId,
      targets: role === "rep" ? { dealsPerMonth, callsPerDay, revenueTarget } : undefined,
      permissionOverrides: overrides,
    });
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/40 z-40 transition-opacity"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="fixed right-0 top-0 bottom-0 w-[400px] bg-card border-l border-border z-50 flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-border shrink-0">
          <UserInitials name={user.name} />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-foreground truncate">{user.name}</p>
            <p className="text-xs text-muted-foreground truncate">{user.email}</p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          {/* Profile */}
          <section>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">
              Profile
            </p>
            <div className="space-y-3">
              <Input label="Display name" value={name} onChange={setName} placeholder="Alice Galperin" />
              <Input label="Email" value={email} onChange={setEmail} type="email" placeholder="alice@example.com" />

              {/* Change password */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground flex items-center gap-1.5">
                  <KeyRound className="w-3 h-3 text-muted-foreground" />
                  New password
                </label>
                <div className="relative">
                  <input
                    type={showNewPassword ? "text" : "password"}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Leave blank to keep current"
                    className={cn(
                      "w-full rounded-[6px] border bg-background px-3 py-2 pr-10",
                      "text-sm text-foreground placeholder:text-muted-foreground",
                      "focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors",
                      passwordTooShort ? "border-destructive" : "border-border"
                    )}
                  />
                  <button
                    type="button"
                    onClick={() => setShowNewPassword((v) => !v)}
                    tabIndex={-1}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {showNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {passwordTooShort && (
                  <p className="text-[11px] text-destructive">Minimum 8 characters</p>
                )}
              </div>

              {newPassword.length > 0 && (
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-foreground">Confirm password</label>
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Re-enter new password"
                    className={cn(
                      "w-full rounded-[6px] border bg-background px-3 py-2",
                      "text-sm text-foreground placeholder:text-muted-foreground",
                      "focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors",
                      passwordMismatch ? "border-destructive" : "border-border"
                    )}
                  />
                  {passwordMismatch && (
                    <p className="text-[11px] text-destructive">Passwords do not match</p>
                  )}
                </div>
              )}
            </div>
          </section>

          {/* Role + Status */}
          <section>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">
              Role
            </p>
            <div className="flex gap-2 mb-4">
              {(["admin", "rep"] as const).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRole(r)}
                  className={cn(
                    "flex-1 py-2 rounded-[6px] text-sm font-medium transition-colors border",
                    role === r
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-background text-foreground/70 border-border hover:border-primary/40"
                  )}
                >
                  {r.charAt(0).toUpperCase() + r.slice(1)}
                </button>
              ))}
            </div>
            <Toggle
              label="Account active"
              checked={isActive}
              onChange={setIsActive}
            />
          </section>

          {/* GHL User ID */}
          <section>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">
              GHL Integration
            </p>
            <Input
              label="GHL User ID"
              value={ghlUserId}
              onChange={setGhlUserId}
              placeholder="yi2pnZ49sp6z8OIAezdA"
            />
            <p className="text-[11px] text-muted-foreground mt-1.5">
              Links this user to GHL for pipeline and calendar filtering.
            </p>
          </section>

          {/* Targets — rep only */}
          {role === "rep" && (
            <section>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">
                Monthly Targets
              </p>
              <div className="space-y-3">
                <NumberInput
                  label="Deals per month"
                  value={dealsPerMonth}
                  onChange={setDealsPerMonth}
                  min={1}
                />
                <NumberInput
                  label="Calls per day"
                  value={callsPerDay}
                  onChange={setCallsPerDay}
                  min={1}
                />
                <NumberInput
                  label="Revenue target ($)"
                  value={revenueTarget}
                  onChange={setRevenueTarget}
                />
              </div>
            </section>
          )}

          {/* Permission overrides */}
          <section>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">
              Permissions
            </p>
            <p className="text-[11px] text-muted-foreground mb-3">
              Override the {role} defaults for this user only.
            </p>
            <div className="divide-y divide-border">
              {FEATURES.map((f) => (
                <Toggle
                  key={f}
                  label={FEATURE_LABELS[f]}
                  checked={perms[f]}
                  onChange={(v) => setPerms((p) => ({ ...p, [f]: v }))}
                />
              ))}
            </div>
          </section>
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-border flex items-center gap-3 shrink-0">
          <button
            onClick={handleSave}
            disabled={mutation.isPending || passwordMismatch || passwordTooShort}
            className={cn(
              "flex items-center gap-1.5 px-4 py-2 rounded-[6px] text-sm font-medium transition-colors",
              "bg-primary text-white hover:bg-primary/90",
              "disabled:opacity-50 disabled:cursor-not-allowed"
            )}
          >
            {mutation.isPending && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
            Save changes
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-[6px] text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
          >
            Cancel
          </button>
          {mutation.isError && (
            <span className="text-xs text-destructive flex-1 text-right">Failed to save</span>
          )}
        </div>
      </div>
    </>
  );
}

// ─── Add user form ────────────────────────────────────────────────────────────

function AddUserForm({ onSuccess }: { onSuccess: () => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"admin" | "rep">("rep");
  const [showPassword, setShowPassword] = useState(false);
  const [success, setSuccess] = useState(false);

  const mutation = useMutation({
    mutationFn: (payload: object) =>
      fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }).then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error ?? "Failed to create user");
        return d;
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["team-settings"] });
      setName("");
      setEmail("");
      setPassword("");
      setSuccess(true);
      setTimeout(() => { setSuccess(false); onSuccess(); }, 1800);
    },
  });

  const canSubmit = name.trim() && email.trim() && password.length >= 8;

  return (
    <div className="bg-card border border-border rounded-[10px] p-5">
      <p className="text-xs font-semibold text-foreground flex items-center gap-1.5 mb-4">
        <UserPlus className="w-3.5 h-3.5" />
        Add new team member
      </p>

      <form
        onSubmit={(e) => { e.preventDefault(); mutation.mutate({ name, email, password, role }); }}
        className="space-y-3"
      >
        <div className="grid grid-cols-2 gap-3">
          <Input label="Full name" value={name} onChange={setName} placeholder="Alice Galperin" />
          <Input label="Email" value={email} onChange={setEmail} type="email" placeholder="alice@example.com" />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground">Password</label>
            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Min. 8 characters"
                className={cn(
                  "w-full rounded-[6px] border border-border bg-background px-3 py-2 pr-10",
                  "text-sm text-foreground placeholder:text-muted-foreground",
                  "focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors",
                  mutation.isError && "border-destructive"
                )}
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                tabIndex={-1}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground">Role</label>
            <div className="flex gap-2 h-[38px]">
              {(["admin", "rep"] as const).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRole(r)}
                  className={cn(
                    "flex-1 rounded-[6px] text-sm font-medium transition-colors border",
                    role === r
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-background text-foreground/70 border-border hover:border-primary/40"
                  )}
                >
                  {r.charAt(0).toUpperCase() + r.slice(1)}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3 pt-1">
          <button
            type="submit"
            disabled={!canSubmit || mutation.isPending}
            className={cn(
              "flex items-center gap-1.5 px-4 py-2 rounded-[6px] text-sm font-medium transition-colors",
              "bg-primary text-white hover:bg-primary/90",
              "disabled:opacity-50 disabled:cursor-not-allowed"
            )}
          >
            {mutation.isPending && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
            Create user
          </button>
          {success && (
            <span className="flex items-center gap-1 text-xs text-emerald-600 font-medium">
              <CheckCircle2 className="w-3.5 h-3.5" />
              Created
            </span>
          )}
          {mutation.isError && (
            <span className="text-xs text-destructive">
              {(mutation.error as Error).message}
            </span>
          )}
        </div>
      </form>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function TeamSettings() {
  const [selectedUser, setSelectedUser] = useState<TeamUser | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);

  const { data, isLoading } = useQuery<{ users: TeamUser[] }>({
    queryKey: ["team-settings"],
    queryFn: () => fetch("/api/settings/team").then((r) => r.json()),
    staleTime: 30 * 1000,
  });

  const users = data?.users ?? [];

  return (
    <div className="space-y-5">
      {/* User list */}
      <div className="bg-card border border-border rounded-[10px] overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-muted-foreground" />
            <h2
              className="text-sm font-semibold text-foreground"
              style={{ fontFamily: "var(--font-heading)" }}
            >
              Team Members
            </h2>
          </div>
          <button
            onClick={() => setShowAddForm((v) => !v)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-[6px] text-xs font-medium bg-primary text-white hover:bg-primary/90 transition-colors"
          >
            <UserPlus className="w-3.5 h-3.5" />
            Add member
          </button>
        </div>

        {isLoading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 px-4 py-3 border-b border-border last:border-0">
              <div className="w-9 h-9 rounded-full bg-muted/60 animate-pulse shrink-0" />
              <div className="flex-1 space-y-1.5">
                <div className="h-3 bg-muted/60 rounded animate-pulse w-32" />
                <div className="h-2.5 bg-muted/40 rounded animate-pulse w-48" />
              </div>
            </div>
          ))
        ) : users.length === 0 ? (
          <div className="px-4 py-6 text-center text-xs text-muted-foreground">
            No users yet.
          </div>
        ) : (
          users.map((u, i) => (
            <button
              key={u.id}
              onClick={() => setSelectedUser(u)}
              className={cn(
                "flex items-center gap-3 px-4 py-3 w-full text-left hover:bg-muted/30 transition-colors",
                i < users.length - 1 && "border-b border-border"
              )}
            >
              <UserInitials name={u.name} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-foreground truncate">{u.name}</p>
                  <RoleBadge role={u.role} />
                  {!u.isActive && (
                    <span className="text-[10px] text-muted-foreground font-medium">(inactive)</span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground truncate">{u.email}</p>
              </div>
              <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/50 shrink-0" />
            </button>
          ))
        )}
      </div>

      {/* Add user form — shown inline when triggered */}
      {showAddForm && <AddUserForm onSuccess={() => setShowAddForm(false)} />}

      {/* Slide-over for editing a user */}
      {selectedUser && (
        <SlideOver user={selectedUser} onClose={() => setSelectedUser(null)} />
      )}
    </div>
  );
}
