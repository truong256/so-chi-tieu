"use client";

import React from "react";
import EmptyState from "./empty-state";

export interface Column<T> {
  key: string;
  header: string;
  render?: (item: T) => React.ReactNode;
  align?: "left" | "center" | "right";
  width?: string;
}

interface AdminTableProps<T> {
  columns: Column<T>[];
  data: T[];
  loading?: boolean;
  emptyTitle?: string;
  emptyMessage?: string;
  page?: number;
  total?: number;
  limit?: number;
  onPageChange?: (nextPage: number) => void;
  onRowClick?: (item: T) => void;
  rowKey: (item: T) => string;
}

export default function AdminTable<T>({
  columns,
  data,
  loading = false,
  emptyTitle = "Chưa có dữ liệu",
  emptyMessage,
  page = 1,
  total = 0,
  limit = 20,
  onPageChange,
  onRowClick,
  rowKey,
}: AdminTableProps<T>) {
  const totalPages = Math.max(1, Math.ceil(total / limit));

  if (loading) {
    return (
      <div className="admin-table-loading">
        <div className="admin-spinner" />
        <span>Đang tải dữ liệu...</span>
      </div>
    );
  }

  if (data.length === 0) {
    return <EmptyState title={emptyTitle} message={emptyMessage} />;
  }

  return (
    <div className="admin-table-container">
      <div className="admin-table-scroll">
        <table className="admin-table">
          <thead>
            <tr>
              {columns.map((col) => (
                <th
                  key={col.key}
                  style={{
                    textAlign: col.align || "left",
                    width: col.width,
                  }}
                >
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((item) => (
              <tr
                key={rowKey(item)}
                onClick={onRowClick ? () => onRowClick(item) : undefined}
                className={onRowClick ? "clickable" : undefined}
              >
                {columns.map((col) => (
                  <td
                    key={col.key}
                    style={{ textAlign: col.align || "left" }}
                  >
                    {col.render
                      ? col.render(item)
                      : String((item as Record<string, unknown>)[col.key] ?? "")}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {onPageChange && totalPages > 1 && (
        <div className="admin-table-pagination">
          <span className="pagination-info">
            Trang {page} / {totalPages} ({total} bản ghi)
          </span>
          <div className="pagination-buttons">
            <button
              type="button"
              className="admin-btn admin-btn-secondary btn-sm"
              disabled={page <= 1}
              onClick={() => onPageChange(page - 1)}
            >
              Trước
            </button>
            <button
              type="button"
              className="admin-btn admin-btn-secondary btn-sm"
              disabled={page >= totalPages}
              onClick={() => onPageChange(page + 1)}
            >
              Sau
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
