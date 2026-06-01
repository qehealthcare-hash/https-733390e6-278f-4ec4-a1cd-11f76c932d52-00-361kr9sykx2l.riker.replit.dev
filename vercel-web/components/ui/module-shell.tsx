import type { ReactNode } from "react";

type ModuleShellProps = {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
};

export function ModuleShell({ title, description, actions, children }: ModuleShellProps) {
  return (
    <section className="panel module-shell">
      <div className="module-head">
        <div>
          <h2 style={{ margin: 0 }}>{title}</h2>
          {description ? <div className="mini-muted">{description}</div> : null}
        </div>
        {actions ? <div className="button-row">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}
