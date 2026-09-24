import './_group.css';

export function Current() {
  return (
    <main className="curral-mockup">
      <header className="curral-header">
        <div className="curral-header-top">
          <button className="curral-back" type="button" aria-label="Voltar">←</button>
          <span className="curral-brand" aria-label="CODAP">CODAP</span>
        </div>
        <div className="curral-header-copy">
          <span className="curral-kicker">Registro de campo</span>
          <h1>Curral</h1>
          <p>Registro de animal encontrado</p>
        </div>
      </header>
    </main>
  );
}