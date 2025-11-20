import React from 'react'

export default function ResultsTable({ rows }) {

  return (
    <div>
      <table className="table">
        <thead>
          <tr>
            <th>Placa</th>
            <th>Data/Hora</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, idx) => (
            <tr key={idx}>
              <td>{r.plate}</td>
              <td>{r.timestamp}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}