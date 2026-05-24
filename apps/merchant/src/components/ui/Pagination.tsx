type PaginationProps = {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  label?: string;
};

export function Pagination({ page, pageSize, total, onPageChange, label = "条" }: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);
  const start = total === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const end = Math.min(total, safePage * pageSize);
  const pages = Array.from({ length: totalPages }, (_, index) => index + 1).filter(
    (item) => item === 1 || item === totalPages || Math.abs(item - safePage) <= 1
  );

  return (
    <div className="list-pagination">
      <span>
        共 {total} {label}，当前 {start}-{end}
      </span>
      <div>
        <button disabled={safePage <= 1} type="button" onClick={() => onPageChange(safePage - 1)}>‹</button>
        {pages.map((item, index) => {
          const previous = pages[index - 1];
          return (
            <span className="page-group" key={item}>
              {previous && item - previous > 1 && <em>...</em>}
              <button className={safePage === item ? "active" : ""} type="button" onClick={() => onPageChange(item)}>
                {item}
              </button>
            </span>
          );
        })}
        <button disabled={safePage >= totalPages} type="button" onClick={() => onPageChange(safePage + 1)}>›</button>
      </div>
    </div>
  );
}
