export function DataTable({ columns, rows, emptyText }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {columns.map(function (column) {
              return <th key={column.key}>{column.label}</th>;
            })}
          </tr>
        </thead>
        <tbody>
          {!rows.length ? (
            <tr>
              <td colSpan={columns.length}>{emptyText || "No records found"}</td>
            </tr>
          ) : (
            rows.map(function (row, index) {
              return (
                <tr key={row.id || index}>
                  {columns.map(function (column) {
                    return <td key={column.key}>{column.render ? column.render(row) : row[column.key]}</td>;
                  })}
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
