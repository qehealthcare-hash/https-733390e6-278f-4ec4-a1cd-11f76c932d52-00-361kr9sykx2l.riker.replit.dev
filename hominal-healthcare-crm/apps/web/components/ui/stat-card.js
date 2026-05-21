export function StatCard({ label, value, detail }) {
  return (
    <div className="panel card">
      <h3>{label}</h3>
      <strong>{value}</strong>
      {detail ? <div className="mini-muted">{detail}</div> : null}
    </div>
  );
}
