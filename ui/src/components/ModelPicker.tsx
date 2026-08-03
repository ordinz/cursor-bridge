import { useMemo, useState } from "react";
import { CheckIcon, ChevronDownIcon, StarIcon } from "lucide-react";
import type { Model } from "../lib/types";
import { useModelFavorites } from "../hooks/useModelFavorites";
import { cn } from "../lib/utils";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "./ui/popover";

interface ModelPickerProps {
  models: Model[];
  value: string;
  loading?: boolean;
  disabled?: boolean;
  compact?: boolean;
  className?: string;
  title?: string;
  onChange: (modelId: string) => void;
}

function modelLabel(model: Model) {
  return model.displayName || model.id;
}

export function ModelPicker({
  models,
  value,
  loading = false,
  disabled = false,
  compact = false,
  className,
  title,
  onChange,
}: ModelPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const { isFavorite, toggleFavorite } = useModelFavorites();

  const selected = models.find((m) => m.id === value);
  const selectedLabel = selected ? modelLabel(selected) : value || "Model";

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? models.filter((m) => {
          const label = modelLabel(m).toLowerCase();
          return label.includes(q) || m.id.toLowerCase().includes(q);
        })
      : models;

    return [...list].sort((a, b) => {
      const af = isFavorite(a.id) ? 1 : 0;
      const bf = isFavorite(b.id) ? 1 : 0;
      if (af !== bf) return bf - af;
      return modelLabel(a).localeCompare(modelLabel(b));
    });
  }, [models, query, isFavorite]);

  const favoriteCount = filtered.filter((m) => isFavorite(m.id)).length;

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery("");
      }}
    >
      <PopoverTrigger
        type="button"
        disabled={disabled || loading || models.length === 0}
        title={title}
        aria-label="Model"
        data-testid="model-select"
        className={cn(
          compact
            ? "flex h-7 min-h-7 min-w-0 items-center justify-between gap-1 rounded-md px-1.5 text-left text-xs text-zinc-400 outline-none hover:bg-zinc-800/80 hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-50"
            : "flex h-10 min-h-10 w-full items-center justify-between gap-1.5 rounded-xl border border-zinc-700/80 bg-zinc-900/80 px-2.5 text-left text-[15px] text-zinc-100 transition-colors outline-none hover:bg-zinc-800/80 focus-visible:border-zinc-500 disabled:cursor-not-allowed disabled:opacity-50 sm:text-sm",
          className,
        )}
      >
        <span className="min-w-0 flex-1 truncate">
          {loading ? "Loading…" : selectedLabel}
        </span>
        <ChevronDownIcon
          className={cn(
            "shrink-0 text-zinc-500",
            compact ? "size-3" : "size-4",
          )}
          aria-hidden
        />
      </PopoverTrigger>
      <PopoverContent
        align="end"
        side="top"
        sideOffset={6}
        className="w-[min(100vw-1.5rem,20rem)] gap-0 border border-zinc-700/80 bg-zinc-900 p-0 shadow-xl"
        data-testid="model-picker-popover"
      >
        <div className="border-b border-zinc-800 p-1.5">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter models…"
            style={{ fontSize: 16 }}
            className="h-9 w-full rounded-md border border-zinc-700/80 bg-zinc-950 px-2 text-zinc-100 placeholder:text-zinc-600 outline-none focus:border-zinc-500"
            data-testid="model-picker-filter"
            aria-label="Filter models"
          />
        </div>
        <ul
          className="max-h-56 overflow-y-auto overscroll-contain p-1"
          role="listbox"
          aria-label="Models"
          data-testid="model-picker-list"
        >
          {filtered.length === 0 && (
            <li
              className="px-2 py-2.5 text-center text-xs text-zinc-500"
              data-testid="model-picker-empty"
            >
              No models match.
            </li>
          )}
          {filtered.map((model, index) => {
            const fav = isFavorite(model.id);
            const active = model.id === value;
            const showFavDivider =
              favoriteCount > 0 &&
              index === favoriteCount &&
              !query.trim();

            return (
              <li key={model.id}>
                {showFavDivider && (
                  <div
                    className="mx-1 my-1 border-t border-zinc-800"
                    aria-hidden
                  />
                )}
                {index === 0 && favoriteCount > 0 && !query.trim() && (
                  <div className="px-2 pb-0.5 pt-1 text-[10px] font-medium uppercase tracking-wide text-zinc-500">
                    Favorites
                  </div>
                )}
                {showFavDivider && (
                  <div className="px-2 pb-0.5 pt-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-500">
                    All models
                  </div>
                )}
                <div
                  className={cn(
                    "flex items-center gap-0.5 rounded-md",
                    active ? "bg-zinc-800" : "hover:bg-zinc-800/70",
                  )}
                  data-testid="model-picker-item"
                  data-model-id={model.id}
                  data-favorite={fav || undefined}
                  data-active={active || undefined}
                >
                  <button
                    type="button"
                    role="option"
                    aria-selected={active}
                    className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left text-sm text-zinc-100"
                    onClick={() => {
                      onChange(model.id);
                      setOpen(false);
                      setQuery("");
                    }}
                  >
                    <span className="min-w-0 flex-1 truncate">
                      {modelLabel(model)}
                    </span>
                    {active && (
                      <CheckIcon className="size-3.5 shrink-0 text-sky-400" />
                    )}
                  </button>
                  <button
                    type="button"
                    className={cn(
                      "mr-0.5 flex size-7 shrink-0 items-center justify-center rounded-md transition-colors",
                      fav
                        ? "text-amber-400 hover:bg-zinc-700/80"
                        : "text-zinc-600 hover:bg-zinc-700/80 hover:text-zinc-300",
                    )}
                    aria-label={
                      fav
                        ? `Remove ${modelLabel(model)} from favorites`
                        : `Favorite ${modelLabel(model)}`
                    }
                    aria-pressed={fav}
                    data-testid="model-favorite-toggle"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      toggleFavorite(model.id);
                    }}
                  >
                    <StarIcon
                      className="size-3.5"
                      fill={fav ? "currentColor" : "none"}
                    />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
