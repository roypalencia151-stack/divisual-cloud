import Editor from "./editor";

export default function Home() {
  return (
    <>
      <header>
        <div className="inner">
          <div>
            <div className="brand-mark">DIVISUAL</div>
            <div className="brand-sub">Edición automática · Cloud</div>
          </div>
          <span id="status-pill" className="status-pill hidden">
            <span className="dot" />
            <span id="status-pill-text">Procesando</span>
          </span>
        </div>
      </header>
      <main>
        <Editor />
        <footer>
          <div>tribu divisual · cloud edition</div>
          <div>
            <a href="https://vercel.com" style={{ color: "var(--text-dim)" }}>
              hosted on vercel
            </a>
          </div>
        </footer>
      </main>
    </>
  );
}
