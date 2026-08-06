"use client";
export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main>
      <div className="page-head"><div><h1>Something went wrong</h1><p>An unexpected error occurred while loading this page.</p></div></div>
      <div className="card">
        <p className="cell-sub">Try again, or reload the page. If it keeps happening, check the manager logs.</p>
        <button className="btn primary" onClick={() => reset()}>Try again</button>
      </div>
    </main>
  );
}
