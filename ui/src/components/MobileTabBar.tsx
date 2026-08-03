import type { ReactNode } from "react";
import type { MobilePanel } from "../lib/url-state";

export type { MobilePanel };

interface MobileTabBarProps {
  active: MobilePanel;
  onChange: (panel: MobilePanel) => void;
  /** Live running conversations — badge on Recent tab. */
  runningCount?: number;
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

function RecentIcon({ className }: { className?: string }) {
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
      <path d="M12 7v5l3 2" />
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

const tabs: {
  id: MobilePanel;
  label: string;
  Icon: TabIcon;
}[] = [
  { id: "history", label: "History", Icon: HistoryIcon },
  { id: "recent", label: "Recent", Icon: RecentIcon },
  { id: "feed", label: "Chat", Icon: ChatIcon },
];

export function MobileTabBar({
  active,
  onChange,
  runningCount = 0,
}: MobileTabBarProps) {
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
        const showRunningBadge = tab.id === "recent" && runningCount > 0;
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onChange(tab.id)}
            className={`relative flex min-h-[49px] flex-1 flex-col items-center justify-center gap-0.5 pt-1.5 text-[10px] font-medium transition-colors ${
              isActive
                ? "text-sky-400"
                : "text-zinc-500 active:text-zinc-300"
            }`}
            data-testid={`mobile-tab-${tab.id}`}
            aria-current={isActive ? "page" : undefined}
            aria-label={
              showRunningBadge
                ? `Recent, ${runningCount} running`
                : undefined
            }
          >
            <span className="relative">
              <tab.Icon className="h-[22px] w-[22px]" />
              {showRunningBadge && (
                <span
                  className="absolute -right-2 -top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-amber-500 px-0.5 text-[9px] font-semibold leading-none text-zinc-950"
                  data-testid="mobile-tab-recent-running-badge"
                  aria-hidden="true"
                >
                  {runningCount > 9 ? "9+" : runningCount}
                </span>
              )}
            </span>
            {tab.label}
          </button>
        );
      })}
    </nav>
  );
}
