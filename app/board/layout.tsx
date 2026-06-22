import { QueryProvider } from "@/providers/query-provider";

export default function BoardLayout({ children }: { children: React.ReactNode }) {
  return <QueryProvider>{children}</QueryProvider>;
}
