var CACHE='habits-v4';
var FILES=['./','./index.html','./manifest.webmanifest','./icon-192.png','./icon-512.png','./apple-touch-icon.png'];

self.addEventListener('install',function(e){
  e.waitUntil(caches.open(CACHE).then(function(c){return c.addAll(FILES)}).then(function(){return self.skipWaiting()}));
});
self.addEventListener('activate',function(e){
  e.waitUntil(caches.keys().then(function(ks){
    return Promise.all(ks.filter(function(k){return k!==CACHE}).map(function(k){return caches.delete(k)}));
  }).then(function(){return self.clients.claim()}));
});
// сначала сеть, при её отсутствии — кеш (работает без интернета)
self.addEventListener('fetch',function(e){
  if(e.request.method!=='GET')return;
  e.respondWith(fetch(e.request).then(function(r){
    var copy=r.clone();caches.open(CACHE).then(function(c){c.put(e.request,copy)});return r;
  }).catch(function(){return caches.match(e.request).then(function(m){return m||caches.match('./index.html')})}));
});
self.addEventListener('notificationclick',function(e){
  e.notification.close();
  var hid=e.notification.data&&e.notification.data.habitId;
  if(e.action==='done'&&hid){
    e.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(function(list){
      if(list.length){list.forEach(function(c){c.postMessage({type:'done',habitId:hid})});return}
      return self.clients.openWindow('./index.html#done='+hid);
    }));
    return;
  }
  e.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(function(list){
    for(var i=0;i<list.length;i++){if('focus' in list[i])return list[i].focus()}
    return self.clients.openWindow('./index.html');
  }));
});
