import type { Model, Project, Session } from "../lib/types";
import { ModelPicker } from "./ModelPicker";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";

const triggerClass =
  "h-7 min-h-7 w-auto max-w-[46%] gap-1 rounded-md border-0 bg-transparent px-1.5 py-0 text-xs text-zinc-400 shadow-none hover:bg-zinc-800/80 hover:text-zinc-200 focus-visible:border-0 focus-visible:ring-0 data-[size=default]:h-7 dark:bg-transparent dark:hover:bg-zinc-800/80";

interface SessionControlsProps {
  session: Session | null;
  project: string;
  projects: Project[];
  models: Model[];
  model: string;
  modelsLoading: boolean;
  onProjectChange: (project: string) => void;
  onModelChange: (model: string) => void;
}

export function SessionControls({
  session,
  project,
  projects,
  models,
  model,
  modelsLoading,
  onProjectChange,
  onModelChange,
}: SessionControlsProps) {
  return (
    <div
      className="flex min-w-0 items-center gap-0.5 px-3 pt-1.5 sm:px-4"
      data-component="SessionControls"
      data-testid="session-controls"
      data-section="session-controls"
    >
      <Select
        value={project}
        onValueChange={(value) => {
          if (value != null) onProjectChange(value);
        }}
        items={projects.map((p) => ({ value: p.id, label: p.name }))}
      >
        <SelectTrigger
          className={triggerClass}
          size="sm"
          aria-label="Project"
          data-testid="project-select"
        >
          <SelectValue placeholder="Project" />
        </SelectTrigger>
        <SelectContent
          alignItemWithTrigger={false}
          align="start"
          side="top"
        >
          <SelectGroup>
            {projects.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>

      <span className="text-zinc-700" aria-hidden>
        ·
      </span>

      <ModelPicker
        models={models}
        value={model}
        loading={modelsLoading}
        onChange={onModelChange}
        compact
        className="max-w-[52%]"
        title={
          session
            ? "Applies to new sessions; active session keeps its model"
            : "Model for new sessions"
        }
      />
    </div>
  );
}
