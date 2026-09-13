export const HOUSEHOLD_KEY='majamajandus_household_profile_v1';

function normalize(profile) {
  if(!profile || typeof profile.name !== 'string' || profile.name.length > 100 || typeof profile.address !== 'string' || profile.address.length > 500) throw Error('Vigane majapidamine.');
  return {...profile,name:profile.name.trim(),address:profile.address.trim()};
}

export function createHouseholdRepository(storage) {
  function load() {
    try {
      const raw=storage.getItem(HOUSEHOLD_KEY);
      if(raw === null) return {version:1,profile:{name:'',address:''},writable:true,error:null};
      const data=JSON.parse(raw);
      if(data?.version !== 1) throw Error('Vigane versioon.');
      return {...data,profile:normalize(data.profile),writable:true,error:null};
    } catch {
      return {profile:{name:'',address:''},writable:false,error:'Majapidamise andmeid ei saanud lugeda. Salvestust ei kirjutata üle.'};
    }
  }
  return {load,save(patch) {
    const current=load();
    if(!current.writable) throw Error(current.error);
    const {writable,error,...envelope}=current;
    const next={...envelope,profile:normalize({...current.profile,...patch})};
    try {storage.setItem(HOUSEHOLD_KEY,JSON.stringify(next));}
    catch {throw Error('Salvestamine ebaõnnestus. Proovi uuesti.');}
    return {...next,writable:true,error:null};
  }};
}
