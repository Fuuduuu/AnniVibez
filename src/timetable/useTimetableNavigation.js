import { useEffect, useRef, useState } from 'react';
import { addDays } from '../calendar/dates.js';
import { schoolSelection, stepSchoolDay } from './model.js';

export function useTimetableNavigation(now) {
  const [selection, setSelection] = useState(() => schoolSelection(now));
  const [view, setView] = useState(selection);
  const [motion, setMotion] = useState({ phase: 'idle', direction: 'forward' });
  const target = useRef(selection), timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);

  function choose(next) {
    const previous = target.current;
    if (next.monday === previous.monday && next.weekday === previous.weekday) return;
    const backward = addDays(next.monday, next.weekday - 1) < addDays(previous.monday, previous.weekday - 1);
    const direction = backward ? 'backward' : 'forward';
    clearTimeout(timer.current);
    target.current = next;
    setSelection(next);
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setView(next);setMotion({ phase: 'idle', direction });return;
    }
    setMotion({ phase: 'out', direction });
    timer.current = setTimeout(() => {
      setView(next);setMotion({ phase: 'in', direction });
      timer.current = setTimeout(() => setMotion({ phase: 'idle', direction }), 340);
    }, 150);
  }
  return { selection, view, motion, choose,
    stepDay: delta => choose(stepSchoolDay(target.current, delta)),
    stepWeek: delta => choose({ ...target.current, monday: addDays(target.current.monday, delta * 7) }),
    goToday: () => choose(schoolSelection(now)) };
}

// Horizontal intent leaves vertical scrolling to the browser. Swipes never activate a lesson.
export function useSchoolSwipe(step) {
  const gesture = useRef(null), suppressClick = useRef(false);
  return {
    onPointerDown: event => {
      if (!event.isPrimary || event.button > 0) return;
      suppressClick.current = false;
      gesture.current = { x: event.clientX, y: event.clientY, id: event.pointerId };
    },
    onPointerMove: event => {
      const start = gesture.current;
      if (!start || start.id !== event.pointerId) return;
      const dx = event.clientX - start.x, dy = event.clientY - start.y;
      if (Math.abs(dx) > 20 && Math.abs(dx) > Math.abs(dy) * 1.2) {
        try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* Synthetic or cancelled pointer. */ }
      }
    },
    onPointerUp: event => {
      const start = gesture.current;gesture.current = null;
      if (!start || start.id !== event.pointerId) return;
      const dx = event.clientX - start.x, dy = event.clientY - start.y;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.2) {
        suppressClick.current = true;step(dx < 0 ? 1 : -1);
      }
    },
    onPointerCancel: () => { gesture.current = null; },
    onClickCapture: event => {
      if (suppressClick.current) { suppressClick.current = false;event.preventDefault();event.stopPropagation(); }
    },
  };
}
