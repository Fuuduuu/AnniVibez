import { useEffect, useState } from 'react';

export function useCalendarNow() {
  const [now,setNow]=useState(()=>new Date());
  useEffect(()=>{
    const refresh=()=>setNow(new Date());
    const timer=setInterval(refresh,60000);
    window.addEventListener('focus',refresh);
    document.addEventListener('visibilitychange',refresh);
    return ()=>{
      clearInterval(timer);
      window.removeEventListener('focus',refresh);
      document.removeEventListener('visibilitychange',refresh);
    };
  },[]);
  return now;
}
