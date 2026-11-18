export default function Home() {
  return (
    <main className="launcher">
      <section className="launcher-intro" aria-labelledby="launcher-heading">
        <img className="launcher-logo" src="/csjs.svg" alt="CSJS" width={112} height={112} />
        <h1 id="launcher-heading">Play Counter-Strike 1.6</h1>
        <p>Multiplayer in your browser</p>
      </section>
      <form className="launcher-form" action="/play">
        <label>Player name<input name="name" defaultValue="Player" maxLength={24} /></label>
        <button type="submit">Join game</button>
      </form>
    </main>
  );
}
