const SUBJECTS = {
  'matemaatika': ['#e8e2fb', '#6a5fb5'], 'eesti keel': ['#fce2e8', '#b8577a'],
  'inglise keel': ['#dcf0f8', '#3a80a3'], 'loodusõpetus': ['#dbf2e6', '#358b6c'],
  'kehaline kasvatus': ['#fde7d2', '#b86d2e'], 'kunst': ['#fbf0c6', '#9c7b12'],
  'muusika': ['#fbe0db', '#b95443'], 'ajalugu': ['#f0e6da', '#8a6644'],
  'käsitöö': ['#f3e1f6', '#9150a0'], 'kirjandus': ['#fde3ea', '#ad4a6a'],
  'klassijuhataja tund': ['#e3eaf8', '#4f6aa3'],
};

export function subjectColors(subject) {
  const key = subject.trim().toLocaleLowerCase('et');
  const [tint, ink] = Object.hasOwn(SUBJECTS, key) ? SUBJECTS[key] : ['#ede8f3', '#746585'];
  return { '--tt-subject-tint': tint, '--tt-subject-ink': ink };
}

export const lessonCount = count => `${count} ${count === 1 ? 'tund' : 'tundi'}`;

export function lessonTag(lesson) {
  if (lesson.status === 'current') return `PRAEGU · VEEL ${lesson.remainingMinutes} MIN`;
  if (lesson.status === 'next') return lesson.untilMinutes <= 60 ? `JÄRGMINE · ${lesson.untilMinutes} MIN PÄRAST` : 'JÄRGMINE';
  if (lesson.status === 'past') return 'LÕPPENUD';
  return null;
}
