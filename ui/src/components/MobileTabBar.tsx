export type MobilePanel = "history" | "feed" | "instructions";

interface MobileTabBarProps {
  active: MobilePanel;
  onChange: (panel: MobilePanel) => void;
}

const tabs: { id: MobilePanel; label: string }[] = [
  { id: "history", label: "History" },
  { id: "feed", label: "Conversation" },
  { id: "instructions", label: "Instructions" },
];

export function MobileTabBar({ active, onChange }: MobileTabBarProps) {
  return (
    <nav
      className="flex shrink-0 border-t border-zinc-800 bg-zinc-950 pb-[env(safe-area-inset-bottom)]"
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
          {tab.label}
        </button>
      ))}
    </nav>
  );
}
