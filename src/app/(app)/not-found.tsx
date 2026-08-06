import Link from "next/link";
export default function NotFound() {
  return (
    <main>
      <div className="page-head"><div><h1>Not found</h1><p>That page doesn&apos;t exist.</p></div></div>
      <div className="card"><Link className="btn" href="/">Back to overview</Link></div>
    </main>
  );
}
