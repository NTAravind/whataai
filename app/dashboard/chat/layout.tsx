import { ReactNode } from "react";

export default function ChatLayout({ children }: { children: ReactNode }) {
  // We can just use the standard layout, or wrap it in a specific div.
  // The global dashboard shell in app/dashboard/layout.tsx already provides the sidebar.
  return (
    <div className="flex flex-1 h-[calc(100vh-1rem)] md:h-screen flex-col p-4 md:p-6">
      {children}
    </div>
  );
}
