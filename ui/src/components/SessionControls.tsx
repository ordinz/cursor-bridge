import type { Model, Project, Session } from "../lib/types";
import { ModelPicker } from "./ModelPicker";
import { ProjectSelect } from "./ProjectSelect";

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
      <ProjectSelect
        project={project}
        projects={projects}
        onProjectChange={onProjectChange}
        side="top"
        className="max-w-[46%]"
      />

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
