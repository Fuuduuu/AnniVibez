import { shoppingSummary } from '../shopping/model.js';
import { ShellIcon } from './ShellIcon.jsx';
import '../design/shopping.css';

export function ShoppingHomeCard({ shopping, onOpen }) {
  const summary = shoppingSummary(shopping.items);
  const available = !shopping.loading && !shopping.error;
  return <section className="mm-section mm-shopping-home" aria-labelledby="shopping-home-heading">
    <div className="mm-card mm-shopping-home-card">
      <div className="mm-shopping-home-heading"><h2 id="shopping-home-heading" className="mm-section-label">OSTUD</h2><ShellIcon name="shopping" /></div>
      <p className="mm-shopping-home-count">{shopping.loading ? 'Laadin nimekirja…' : shopping.error ? 'Ostunimekiri pole praegu saadaval'
        : summary.count ? `${summary.count} ${summary.count === 1 ? 'asi' : 'asja'} nimekirjas` : 'Ostunimekiri on tühi'}</p>
      {available && !!summary.names.length && <p className="mm-shopping-home-preview">{summary.names.join(' · ')}{summary.extra > 0 ? ` +${summary.extra}` : ''}</p>}
      {shopping.error && <p className="mm-shopping-sync-note" role="alert">{shopping.error}</p>}
      <button className="mm-button mm-button-primary" type="button" onClick={onOpen}>Ava nimekiri<ShellIcon name="next" /></button>
    </div>
  </section>;
}
