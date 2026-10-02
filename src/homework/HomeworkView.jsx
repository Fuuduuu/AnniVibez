import { groupHomework } from './model.js';
import { homeworkCount } from './presentation.js';
import { HomeworkRow } from './HomeworkRow';
import { ShellIcon } from '../components/ShellIcon';

export function HomeworkView({ homework, now, onAdd, onOpen, onComplete }) {
  const { groups, completed } = groupHomework(homework.items, now);
  const remaining = groups.reduce((sum, group) => sum + group.items.length, 0);
  const row = item => <li key={item.id}><HomeworkRow item={item} now={now} writable={homework.writable}
    onOpen={onOpen} onComplete={onComplete} /></li>;
  return <section className="mm-homework-view" aria-labelledby="homework-heading">
    <div className="mm-homework-heading"><div><h2 id="homework-heading">Kodused tööd</h2>
      <p>{!homework.writable ? 'Salvestuse lugemine ebaõnnestus.' : remaining ? `${homeworkCount(remaining)} tegemata` : 'Kõik tehtud? Tubli, Anni!'}</p></div>
      <button type="button" className="mm-button mm-button-primary" disabled={!homework.writable} onClick={onAdd}>
        <ShellIcon name="add" />Lisa kodune töö</button>
    </div>
    {!remaining && <div className="mm-timetable-empty mm-homework-empty">
      <span className="mm-icon-tile"><ShellIcon name="tunniplaan" /></span>
      <h3>{!homework.writable ? 'Kodutöid ei saanud avada.' : completed.length ? 'Kõik kodused tööd on tehtud!' : 'Kodutöid pole veel.'}</h3>
      <p>{!homework.writable ? 'Olemasolev salvestus säilib. Proovi vaadet hiljem uuesti avada.'
        : completed.length ? 'Tehtud tööd leiad allpool. Uue ülesande saad alati juurde lisada.' : 'Lisa oma esimene ülesanne ja vali tähtaeg. Väike samm, suur võit!'}</p>
    </div>}
    {groups.filter(group => group.items.length).map(group => <section className="mm-homework-group" key={group.key}
      data-homework-group={group.key} aria-labelledby={`homework-${group.key}`}>
      <h3 id={`homework-${group.key}`}>{group.label}<span>{group.items.length}</span></h3>
      <ul className="mm-homework-list">{group.items.map(row)}</ul>
    </section>)}
    {completed.length > 0 && <details className="mm-homework-completed"><summary>Tehtud<span>{completed.length}</span></summary>
      <ul className="mm-homework-list">{completed.map(row)}</ul></details>}
    <p className="mm-footnote mm-timetable-note">Anni kodutööd on ainult selles seadmes. Need ei lähe kalendrisse ega pilvesünki.</p>
  </section>;
}
