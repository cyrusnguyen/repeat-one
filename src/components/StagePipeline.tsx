import type { Stage } from "@/lib/run-view";

export function StagePipeline({ stages }: { stages: Stage[] }) {
  return (
    <ol className="stages" aria-label="Run stages">
      {stages.map((s) => (
        <li key={s.key} data-state={s.state}>
          <b>{s.label}</b>
          <small>{s.caption}</small>
        </li>
      ))}
    </ol>
  );
}
