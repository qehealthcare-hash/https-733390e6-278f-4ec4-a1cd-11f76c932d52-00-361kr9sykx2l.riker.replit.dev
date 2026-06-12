export function EmptyState({
  title,
  description
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="panel empty-state">
      <h3 style={{ marginTop: 0 }}>{title}</h3>
      <div className="mini-muted">{description}</div>
    </div>
  );
}
