import React from 'react';

const DataTable = ({ 
  columns = [], 
  data = [], 
  emptyMessage = "No records found."
}) => {
  return (
    <div className="table-scroll">
      <table className="data-table">
        <thead>
          <tr>
            {columns.map((col, idx) => (
              <th key={idx} style={col.style || {}}>
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.length === 0 ? (
            <tr>
              <td colSpan={columns.length} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '24px' }}>
                {emptyMessage}
              </td>
            </tr>
          ) : (
            data.map((row, rowIdx) => (
              <tr key={rowIdx}>
                {columns.map((col, colIdx) => {
                  let content;
                  if (col.render) {
                    content = col.render(row, rowIdx);
                  } else if (typeof col.accessor === 'function') {
                    content = col.accessor(row);
                  } else {
                    content = row[col.accessor];
                  }

                  return (
                    <td key={colIdx} style={col.cellStyle || {}}>
                      {content}
                    </td>
                  );
                })}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
};

export default DataTable;
