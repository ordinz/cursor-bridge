import type { ReactNode } from "react";
import type { MobilePanel } from "../lib/url-state";

export type { MobilePanel };

interface MobileTabBarProps {
  active: MobilePanel;
  onChange: (panel: MobilePanel) => void;
}

type TabIcon = (props: { className?: string }) => ReactNode;

function HistoryIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M4 6h16" />
      <path d="M4 12h16" />
      <path d="M4 18h10" />
    </svg>
  );
}

function ChatIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5H7l-4 3v-3.5A8.5 8.5 0 1 1 21 11.5Z" />
    </svg>
  );
}

function HelpIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1.5 1-1.5 2.2" />
      <path d="M12 17h.01" />
    </svg>
  );
}

const tabs: {
  id: MobilePanel;
  label: string;
  Icon: TabIcon;
}[] = [
  { id: "history", label: "History", Icon: HistoryIcon },
  { id: "feed", label: "Chat", Icon: ChatIcon },
  { id: "instructions", label: "Help", Icon: HelpIcon },
];

export function MobileTabBar({ active, onChange }: MobileTabBarProps) {
  return (
    <nav
      className="flex shrink-0 border-t border-zinc-800/80 bg-zinc-950/90 backdrop-blur-xl lg:hidden pb-[env(safe-area-inset-bottom)]"
      data-component="MobileTabBar"
      data-testid="mobile-tab-bar"
      data-section="primary-nav"
      aria-label="Primary navigation"
    >
      {tabs.map((tab) => {
        const isActive = active === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onChange(tab.id)}
            className={`flex min-h-[49px] flex-1 flex-col items-center justify-center gap-0.5 pt-1.5 text-[10px] font-medium transition-colors ${
              isActive
                ? "text-sky-400"
                : "text-zinc-500 active:text-zinc-300"
            }`}
            data-testid={`mobile-tab-${tab.id}`}
            aria-current={isActive ? "page" : undefined}
          >
            <tab.Icon className="h-[22px] w-[22px]" />
            {tab.label}
          </button>
        );
      })}
    </nav>
  );
}
