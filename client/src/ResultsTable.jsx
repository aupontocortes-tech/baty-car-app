import React from 'react'

export default function ResultsTable({ rows, onDelete }) {

  return (
    <div>
      <table className="table">
        <thead>
          <tr>
            <th>Placa</th>
            <th>Data</th>
            <th>Loja</th>
            <th>Lava Jato</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, idx) => (
            <tr key={idx} onClick={() => onDelete && onDelete(idx)} style={{ cursor: onDelete ? 'pointer' : 'default' }} title={onDelete ? 'Clique para excluir' : undefined}>
              <td>{r.placa}</td>
              <td>{r.data}</td>
              <td>{r.loja}</td>
              <td>{r.lava_jato}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}