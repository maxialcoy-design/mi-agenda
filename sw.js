self.addEventListener('install',event=>event.waitUntil(self.skipWaiting()));
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));

self.addEventListener('push',event=>{
  let data={};
  try{ data=event.data?event.data.json():{}; }catch(e){}
  const title=data.title||'Mi Agenda';
  const time=data.time||'';
  const body=data.body || (time ? 'Tienes una cita a las '+time+': '+(data.title||'') : (data.title||'Tienes un aviso en Mi Agenda.'));
  event.waitUntil(
    self.registration.showNotification(title,{
      body:body,
      icon:'/mi-agenda/icons/icon-192.png',
      badge:'/mi-agenda/icons/icon-192.png',
      tag:data.reminderId||'mi-agenda',
      data:{url:'https://maxialcoy-design.github.io/mi-agenda/'}
    })
  );
});

self.addEventListener('notificationclick',event=>{
  event.notification.close();
  const url=(event.notification.data&&event.notification.data.url)||'https://maxialcoy-design.github.io/mi-agenda/';
  event.waitUntil(
    clients.matchAll({type:'window',includeUncontrolled:true}).then(list=>{
      for(const client of list){
        if('focus' in client){
          client.navigate(url);
          return client.focus();
        }
      }
      return clients.openWindow(url);
    })
  );
});

self.addEventListener('fetch',event=>{
  event.respondWith(fetch(event.request).catch(()=>caches.match(event.request)));
});
