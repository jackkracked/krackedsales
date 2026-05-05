"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { UserPlus, Users, RefreshCw, CheckCircle2, Eye, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils/cn";

interface User {
  id: string;
  name: string;
  email: string;
  createdAt: string;
}

async function fetchUsers(): Promise<User[]> {
  const res = await fetch("/api/users");
  if (!res.ok) throw new Error("Failed to load users");
  const data = await res.json();
  return data.users;
}

async function createUser(payload: { name: string; email: string; password: string }) {
  const res = await fetch("/api/users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Failed to create user");
  return data.user as User;
}

export function UserManager() {
  const queryClient = useQueryClient();

  const { data: userList = [], isLoading } = useQuery<User[]>({
    queryKey: ["users"],
    queryFn: fetchUsers,
  });

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [success, setSuccess] = useState(false);

  const createMutation = useMutation({
    mutationFn: createUser,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users"] });
      setName("");
      setEmail("");
      setPassword("");
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    createMutation.mutate({ name, email, password });
  }

  const canSubmit = name.trim() && email.trim() && password.length >= 8;

  return (
    <div className="bg-card border border-border rounded-[10px] p-5">
      {/* Header */}
      <div className="flex items-center gap-2 mb-1">
        <Users className="w-4 h-4 text-muted-foreground" />
        <h2
          className="text-sm font-semibold text-foreground"
          style={{ fontFamily: "var(--font-heading)" }}
        >
          Team Members
        </h2>
      </div>
      <p className="text-xs text-muted-foreground mb-5">
        Add team members so they can log in with their own email and password.
      </p>

      {/* Existing users */}
      {isLoading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground mb-5">
          <RefreshCw className="w-3 h-3 animate-spin" />
          Loading…
        </div>
      ) : userList.length > 0 ? (
        <div className="mb-5 rounded-[8px] border border-border overflow-hidden">
          {userList.map((u, i) => (
            <div
              key={u.id}
              className={cn(
                "flex items-center justify-between px-3.5 py-2.5",
                i < userList.length - 1 && "border-b border-border"
              )}
            >
              <div>
                <p className="text-sm font-medium text-foreground">{u.name}</p>
                <p className="text-xs text-muted-foreground">{u.email}</p>
              </div>
              <span className="text-xs text-muted-foreground">
                {new Date(u.createdAt).toLocaleDateString("en-GB", {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                })}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div className="mb-5 px-3.5 py-3 rounded-[8px] border border-dashed border-border text-xs text-muted-foreground">
          No users yet — create the first one below.
        </div>
      )}

      {/* Add user form */}
      <form onSubmit={handleSubmit} className="space-y-3">
        <p className="text-xs font-medium text-foreground flex items-center gap-1.5">
          <UserPlus className="w-3.5 h-3.5" />
          Add new user
        </p>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground">Full name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Sarah Jones"
              className={cn(
                "w-full rounded-[6px] border border-border bg-background px-3 py-2",
                "text-sm text-foreground placeholder:text-muted-foreground",
                "focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary",
                "transition-colors"
              )}
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="sarah@example.com"
              autoCapitalize="none"
              autoCorrect="off"
              className={cn(
                "w-full rounded-[6px] border border-border bg-background px-3 py-2",
                "text-sm text-foreground placeholder:text-muted-foreground",
                "focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary",
                "transition-colors"
              )}
            />
          </div>
        </div>

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
                "focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary",
                "transition-colors",
                createMutation.isError && "border-destructive"
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
          <p className="text-xs text-muted-foreground">
            You set this — share it with them directly.
          </p>
        </div>

        <div className="flex items-center gap-3 pt-1">
          <button
            type="submit"
            disabled={!canSubmit || createMutation.isPending}
            className={cn(
              "flex items-center gap-1.5 px-4 py-2 rounded-[6px] text-sm font-medium transition-colors",
              "bg-primary text-white hover:bg-primary/90",
              "disabled:opacity-50 disabled:cursor-not-allowed"
            )}
          >
            {createMutation.isPending && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
            Create user
          </button>

          {success && (
            <span className="flex items-center gap-1 text-xs text-green-600 font-medium">
              <CheckCircle2 className="w-3.5 h-3.5" />
              User created
            </span>
          )}
          {createMutation.isError && (
            <span className="text-xs text-destructive">
              {(createMutation.error as Error).message}
            </span>
          )}
        </div>
      </form>
    </div>
  );
}
