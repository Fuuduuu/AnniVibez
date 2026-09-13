export function createNotificationService(env=globalThis) {
  function getNotificationCapability() {
    const supported=!!(env.isSecureContext && env.Notification && typeof env.Notification.requestPermission === 'function'
      && typeof env.navigator?.serviceWorker?.getRegistration === 'function');
    return {supported,permission:supported ? env.Notification.permission : 'unsupported',
      activeDelivery:supported && typeof env.navigator?.locks?.request === 'function',exactScheduling:false,backgroundGuaranteed:false};
  }
  return {getNotificationCapability,
    async requestNotificationPermission({userInitiated=false}={}) {
      if(userInitiated && getNotificationCapability().permission === 'default') {
        try {await env.Notification.requestPermission();} catch { /* The browser remains the authority for permission. */ }
      }
      return getNotificationCapability();
    },
    async showNotification({title,body,tag},isCurrent=()=>true) {
      const allowed=()=>isCurrent() && getNotificationCapability().permission === 'granted' && env.document?.visibilityState === 'visible';
      if(!allowed()) return {status:'blocked'};
      try {
        const registration=await env.navigator.serviceWorker.getRegistration();
        if(!allowed()) return {status:'blocked'};
        if(!registration?.active || typeof registration.showNotification !== 'function') return {status:'unavailable'};
        await registration.showNotification(title,{body,tag,icon:'/icons/icon-192.png'});
        return {status:'shown'};
      } catch {return {status:'error'};}
    },
  };
}
