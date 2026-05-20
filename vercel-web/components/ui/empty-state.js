export function EmptyState({ title, description }) {
  return (
    <div className="panel empty-state">
      <h3 style={{ marginTop: 0 }}>{title}</h3>
      <div className="mini-muted">{description}</div>
    </div>
  );
}
