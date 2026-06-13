export type MobilePanel = "history" | "feed" | "tools";

interface MobileTabBarProps {
  active: MobilePanel;
  onChange: (panel: MobilePanel) => void;
  toolCount: number;
}

const tabs: { id: MobilePanel; label: string }[] = [
  { id: "history", label: "History" },
  { id: "feed", label: "Activity" },
  { id: "tools", label: "Tools" },
];

export function MobileTabBar({ active, onChange, toolCount }: MobileTabBarProps) {
  return (
    <nav
      className="flex shrink-0 border-t border-zinc-800 bg-zinc-950 pb-[env(safe-area-inset-bottom)] lg:hidden"
      data-testid="mobile-tab-bar"
      aria-label="Primary navigation"
    >
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          onClick={() => onChange(tab.id)}
          className={`flex min-h-11 flex-1 flex-col items-center justify-center gap-0.5 py-2 text-xs font-medium transition-colors ${
            active === tab.id
              ? "text-zinc-100"
              : "text-zinc-500 active:text-zinc-300"
          }`}
          data-testid={`mobile-tab-${tab.id}`}
          aria-current={active === tab.id ? "page" : undefined}
        >
          <span className="flex items-center gap-1">
            {tab.label}
            {tab.id === "tools" && toolCount > 0 && (
              <span className="rounded-full bg-amber-900/50 px-1.5 text-[10px] text-amber-300">
                {toolCount}
              </span>
            )}
          </span>
        </button>
      ))}
    </nav>
  );
}
