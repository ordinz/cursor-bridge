import type { Project } from "../lib/types";
import { cn } from "../lib/utils";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";

const triggerClass =
  "h-7 min-h-7 w-auto max-w-full gap-1 rounded-md border-0 bg-transparent px-1.5 py-0 text-xs text-zinc-400 shadow-none hover:bg-zinc-800/80 hover:text-zinc-200 focus-visible:border-0 focus-visible:ring-0 data-[size=default]:h-7 dark:bg-transparent dark:hover:bg-zinc-800/80";

interface ProjectSelectProps {
  project: string;
  projects: Project[];
  onProjectChange: (project: string) => void;
  side?: "top" | "bottom";
  className?: string;
}

export function ProjectSelect({
  project,
  projects,
  onProjectChange,
  side = "bottom",
  className,
}: ProjectSelectProps) {
  return (
    <Select
      value={project}
      onValueChange={(value) => {
        if (value != null) onProjectChange(value);
      }}
      items={projects.map((p) => ({ value: p.id, label: p.name }))}
    >
      <SelectTrigger
        className={cn(triggerClass, className)}
        size="sm"
        aria-label="Project"
        data-testid="project-select"
      >
        <SelectValue placeholder="Project" />
      </SelectTrigger>
      <SelectContent
        alignItemWithTrigger={false}
        align="start"
        side={side}
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
  );
}
