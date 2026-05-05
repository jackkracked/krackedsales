"use client";

export function FollowUpEmpty() {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center px-8 py-16">
      <div className="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center mb-4">
        <svg
          className="w-6 h-6 text-green-600"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      </div>
      <p className="text-sm font-semibold text-foreground mb-1">All caught up</p>
      <p className="text-xs text-muted-foreground max-w-[200px]">
        No one in the pipeline needs a follow-up right now.
      </p>
    </div>
  );
}

export function WorkspaceEmpty() {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center px-8">
      <div className="w-10 h-10 rounded-full bg-muted/60 flex items-center justify-center mb-3">
        <svg
          className="w-5 h-5 text-muted-foreground/50"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.5}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z"
          />
        </svg>
      </div>
      <p className="text-xs text-muted-foreground">
        Select a contact to see the AI recommendation
      </p>
    </div>
  );
}
