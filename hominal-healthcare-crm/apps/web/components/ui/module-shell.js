export function ModuleShell({ title, description, actions, children }) {
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
