/* DOWNSHOT CRM — данные персонала, переписки и файлов.
 *
 * ТЕСТОВЫЙ РЕЖИМ: всё хранится в этом браузере (localStorage + IndexedDB для файлов),
 * SMS никуда не уходят. Роли проверяются в браузере, поэтому это макет интерфейса,
 * а не защита: для реальной работы данные, роли и отправку SMS нужно перенести на сервер.
 *
 * Требует assets/auth.js (база клиентов DSAuth).
 */
(function () {
  var A = window.DSAuth;
  var KEY = 'downshot_crm_v1';
  var TEST_CODE = '123456';
  var MAX_FILE = 25 * 1024 * 1024;

  // Все права, которые можно выдать роли (порядок = порядок строк в таблице прав).
  var PERMS = [
    { id: 'clients.view', title: 'Видеть клиентов' },
    { id: 'clients.edit', title: 'Создавать и редактировать клиентов' },
    { id: 'clients.delete', title: 'Удалять клиентов' },
    { id: 'staff.edit', title: 'Сотрудники и права ролей' },
    { id: 'dialogs', title: 'Читать переписку' },
    { id: 'messages.send', title: 'Писать клиенту (SMS)' },
    { id: 'files.upload', title: 'Загружать файлы' },
    { id: 'files.download', title: 'Скачивать файлы' },
    { id: 'files.delete', title: 'Удалять файлы' }
  ];
  // Права по умолчанию; администратор может поменять их в разделе «Сотрудники» (хранятся в data.rolePerms).
  var ROLES = {
    admin: { title: 'Администратор', locked: true, can: PERMS.map(function (p) { return p.id; }) },
    manager: { title: 'Менеджер', can: ['clients.view', 'clients.edit', 'dialogs', 'messages.send', 'files.upload', 'files.download'] },
    operator: { title: 'Оператор', can: ['dialogs', 'messages.send', 'files.upload', 'files.download'] },
    editor: { title: 'Монтажёр', can: ['dialogs', 'files.upload', 'files.download'] },
    cashier: { title: 'Кассир', can: ['clients.view', 'dialogs', 'messages.send', 'files.download'] }
  };
  var ROLE_ORDER = ['admin', 'manager', 'operator', 'editor', 'cashier'];

  var STATUSES = [
    { id: 'new', title: 'Новый' },
    { id: 'work', title: 'В работе' },
    { id: 'shoot', title: 'Съёмка назначена' },
    { id: 'done', title: 'Завершён' },
    { id: 'lost', title: 'Отказ' }
  ];

  /* ---------- хранилище ---------- */
  function load() {
    var data = null;
    try { data = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) {}
    if (!data || !data.staff) {
      // первые тестовые учётки персонала
      var now = Date.now();
      data = {
        staff: {
          'ST-ADMN': { id: 'ST-ADMN', phone: '+79000000001', name: 'Администратор', role: 'admin', active: true, createdAt: now },
          'ST-EMPL': { id: 'ST-EMPL', phone: '+79000000002', name: 'Оператор', role: 'operator', active: true, createdAt: now }
        },
        session: null, messages: [], files: []
      };
      save(data);
    }
    if (migrate(data)) save(data);
    return data;
  }
  // v2: роль «Сотрудник» стала «Оператором», добавлены тестовые учётки остальных ролей.
  function migrate(data) {
    if (data.v >= 2) return false;
    var now = Date.now(), phones = {};
    for (var k in data.staff) {
      var s = data.staff[k];
      if (s.role === 'employee') { s.role = 'operator'; if (s.name === 'Сотрудник') s.name = 'Оператор'; }
      phones[s.phone] = true;
    }
    [['ST-EDTR', '+79000000003', 'Монтажёр', 'editor'], ['ST-MNGR', '+79000000004', 'Менеджер', 'manager'], ['ST-CASH', '+79000000005', 'Кассир', 'cashier']]
      .forEach(function (t, i) {
        if (!phones[t[1]] && !data.staff[t[0]]) data.staff[t[0]] = { id: t[0], phone: t[1], name: t[2], role: t[3], active: true, createdAt: now + i + 1 };
      });
    data.rolePerms = data.rolePerms || {};
    data.v = 2;
    return true;
  }
  function rolePerms(data, role) {
    if (!ROLES[role]) return [];
    if (ROLES[role].locked) return ROLES[role].can;
    var o = data.rolePerms && data.rolePerms[role];
    return o || ROLES[role].can;
  }
  function save(data) {
    try { localStorage.setItem(KEY, JSON.stringify(data)); return true; } catch (e) { return false; }
  }
  function uid(prefix, n) {
    var abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', b = new Uint8Array(n), s = prefix;
    crypto.getRandomValues(b);
    for (var i = 0; i < n; i++) s += abc[b[i] % abc.length];
    return s;
  }
  function fail(msg) { throw new Error(msg); }

  /* ---------- текущий сотрудник и права ---------- */
  function me() {
    var d = load(), s = d.session && d.staff[d.session.id];
    return s && s.active ? s : null;
  }
  function can(action) {
    var d = load(), s = d.session && d.staff[d.session.id];
    return !!(s && s.active && rolePerms(d, s.role).indexOf(action) !== -1);
  }
  function need(action) { if (!can(action)) fail('Недостаточно прав'); }

  /* ---------- IndexedDB для содержимого файлов ---------- */
  function idb() {
    return new Promise(function (res, rej) {
      var r = indexedDB.open('downshot_files', 1);
      r.onupgradeneeded = function () { r.result.createObjectStore('blobs'); };
      r.onsuccess = function () { res(r.result); };
      r.onerror = function () { rej(r.error); };
    });
  }
  function blobOp(mode, fn) {
    return idb().then(function (db) {
      return new Promise(function (res, rej) {
        var tx = db.transaction('blobs', mode), st = tx.objectStore('blobs'), req = fn(st);
        tx.oncomplete = function () { res(req && req.result); };
        tx.onerror = function () { rej(tx.error); };
      });
    });
  }

  function clientsDb() { return A._store.load(); }
  function phoneTaken(list, phone, exceptId) {
    for (var k in list) if (list[k].phone === phone && list[k].id !== exceptId) return true;
    return false;
  }

  var api = {
    MODE: 'test',
    TEST_CODE: TEST_CODE,
    ROLES: ROLES,
    ROLE_ORDER: ROLE_ORDER,
    PERMS: PERMS,
    STATUSES: STATUSES,

    /* ---------- права ролей (меняет только тот, у кого staff.edit) ---------- */
    rolePerms: function (role) { return rolePerms(load(), role).slice(); },
    setRolePerm: function (role, perm, on) {
      need('staff.edit');
      if (!ROLES[role]) fail('Неизвестная роль');
      if (ROLES[role].locked) fail('Права администратора не меняются');
      var d = load(), list = rolePerms(d, role).slice(), i = list.indexOf(perm);
      if (on && i === -1) list.push(perm);
      if (!on && i !== -1) list.splice(i, 1);
      d.rolePerms = d.rolePerms || {};
      d.rolePerms[role] = list;
      save(d);
      return list;
    },
    resetRolePerms: function () {
      need('staff.edit');
      var d = load();
      d.rolePerms = {};
      save(d);
    },
    roleIsDefault: function (role) {
      var d = load();
      return !(d.rolePerms && d.rolePerms[role]);
    },
    MAX_FILE: MAX_FILE,
    can: can,
    me: me,

    /* ---------- вход персонала ---------- */
    requestCode: function (phone) {
      return new Promise(function (res) { setTimeout(res, 400); }).then(function () {
        var d = load(), s = null;
        for (var k in d.staff) if (d.staff[k].phone === phone) s = d.staff[k];
        if (!s) fail('Этот номер не зарегистрирован как сотрудник');
        if (!s.active) fail('Доступ отключён администратором');
        return true;
      });
    },
    verifyCode: function (phone, code) {
      return new Promise(function (res) { setTimeout(res, 300); }).then(function () {
        if (String(code).trim() !== TEST_CODE) fail('Неверный код');
        var d = load(), s = null;
        for (var k in d.staff) if (d.staff[k].phone === phone && d.staff[k].active) s = d.staff[k];
        if (!s) fail('Доступ отключён');
        d.session = { id: s.id, at: Date.now() };
        save(d);
        return s;
      });
    },
    logout: function () { var d = load(); d.session = null; save(d); },

    /* ---------- персонал (только админ) ---------- */
    staffList: function () {
      need('staff.edit');
      var d = load();
      return Object.keys(d.staff).map(function (k) { return d.staff[k]; }).sort(function (a, b) { return a.createdAt - b.createdAt; });
    },
    staffSave: function (st) {
      need('staff.edit');
      var d = load(), phone = A.normalizePhone(st.phone);
      if (!phone) fail('Неверный номер телефона');
      if (!st.name || !st.name.trim()) fail('Укажите имя');
      if (!ROLES[st.role]) fail('Неизвестная роль');
      if (phoneTaken(d.staff, phone, st.id)) fail('Сотрудник с таким номером уже есть');
      var cur = me();
      if (st.id && st.id === cur.id && (st.role !== 'admin' || st.active === false)) fail('Нельзя снять права администратора с самого себя');
      var rec = st.id && d.staff[st.id];
      if (!rec) { rec = { id: uid('ST-', 4), createdAt: Date.now(), active: true }; d.staff[rec.id] = rec; }
      rec.name = st.name.trim(); rec.phone = phone; rec.role = st.role;
      if (typeof st.active === 'boolean') rec.active = st.active;
      save(d);
      return rec;
    },
    staffRemove: function (id) {
      need('staff.edit');
      if (id === me().id) fail('Нельзя удалить самого себя');
      var d = load();
      delete d.staff[id];
      save(d);
    },
    staffName: function (id) {
      var s = load().staff[id];
      return s ? s.name : 'Удалённый сотрудник';
    },
    assignees: function () {
      var d = load();
      return Object.keys(d.staff).map(function (k) { return d.staff[k]; }).filter(function (s) { return s.active; });
    },

    /* ---------- клиенты ---------- */
    // Сотруднику доступен только список для диалогов (имя, телефон, ID), без редактирования.
    clients: function () {
      if (!can('dialogs') && !can('clients.view')) fail('Недостаточно прав');
      var db = clientsDb(), d = load();
      return Object.keys(db.users).map(function (k) {
        var u = db.users[k];
        var msgs = d.messages.filter(function (m) { return m.clientId === u.id; });
        var last = msgs[msgs.length - 1];
        return {
          id: u.id, name: u.name || '', phone: u.phone, createdAt: u.createdAt,
          status: u.status || 'new', note: u.note || '', assignee: u.assignee || '',
          requests: u.requests || [], lastMessage: last || null,
          activity: Math.max(u.createdAt || 0, last ? last.at : 0, (u.requests && u.requests[0]) ? u.requests[0].at : 0)
        };
      }).sort(function (a, b) { return b.activity - a.activity; });
    },
    client: function (id) {
      return api.clients().filter(function (c) { return c.id === id; })[0] || null;
    },
    clientSave: function (c) {
      need('clients.edit');
      var db = clientsDb(), phone = A.normalizePhone(c.phone);
      if (!phone) fail('Неверный номер телефона');
      if (phoneTaken(db.users, phone, c.id)) fail('Клиент с таким номером уже есть');
      var u = c.id && db.users[c.id];
      if (!u) { u = { id: A._generateId(db.users), createdAt: Date.now(), requests: [] }; db.users[u.id] = u; }
      u.name = String(c.name || '').trim();
      u.phone = phone;
      if (c.status) u.status = c.status;
      if (typeof c.note === 'string') u.note = c.note;
      if (typeof c.assignee === 'string') u.assignee = c.assignee;
      A._store.save(db);
      return u;
    },
    clientRemove: function (id) {
      need('clients.delete');
      var db = clientsDb();
      delete db.users[id];
      if (db.session && db.session.id === id) db.session = null;
      A._store.save(db);
      var d = load(), gone = d.files.filter(function (f) { return f.clientId === id; });
      d.messages = d.messages.filter(function (m) { return m.clientId !== id; });
      d.files = d.files.filter(function (f) { return f.clientId !== id; });
      save(d);
      gone.forEach(function (f) { blobOp('readwrite', function (st) { return st.delete(f.id); }); });
    },

    /* ---------- переписка (SMS) ---------- */
    thread: function (clientId) {
      return load().messages.filter(function (m) { return m.clientId === clientId; });
    },
    send: function (clientId, text) {
      need('messages.send');
      text = String(text || '').trim();
      if (!text) fail('Пустое сообщение');
      var d = load();
      var m = { id: uid('M', 8), clientId: clientId, dir: 'out', text: text.slice(0, 1000), at: Date.now(), staffId: me().id, status: 'test' };
      d.messages.push(m);
      save(d);
      return m;
    },
    // Файл в переписке: кладётся в «Файлы» клиента и появляется сообщением в диалоге.
    sendFile: function (clientId, file) {
      try { need('messages.send'); } catch (e) { return Promise.reject(e); }
      return api.upload(clientId, file).then(function (meta) {
        var d = load();
        var m = { id: uid('M', 8), clientId: clientId, dir: 'out', kind: 'file', fileId: meta.id, text: meta.name, size: meta.size, at: Date.now(), staffId: me().id, status: 'test' };
        d.messages.push(m);
        save(d);
        return m;
      });
    },
    fileExists: function (fileId) {
      return load().files.some(function (f) { return f.id === fileId; });
    },
    // Ответ клиента: в тесте приходит из его кабинета, в боевом режиме — входящая SMS через шлюз.
    clientReply: function (clientId, text) {
      text = String(text || '').trim();
      if (!text) fail('Пустое сообщение');
      var d = load();
      var m = { id: uid('M', 8), clientId: clientId, dir: 'in', text: text.slice(0, 1000), at: Date.now() };
      d.messages.push(m);
      save(d);
      return m;
    },
    // Длина SMS: 70 символов кириллицей / 160 латиницей на сегмент, у составных — 67 / 153.
    smsParts: function (text) {
      var n = text.length;
      if (!n) return 0;
      var uni = /[^\x00-\x7F]/.test(text), one = uni ? 70 : 160, many = uni ? 67 : 153;
      return n <= one ? 1 : Math.ceil(n / many);
    },

    /* ---------- файлы ---------- */
    files: function (clientId) {
      return load().files.filter(function (f) { return f.clientId === clientId; }).sort(function (a, b) { return b.at - a.at; });
    },
    upload: function (clientId, file) {
      try { need('files.upload'); } catch (e) { return Promise.reject(e); }
      if (file.size > MAX_FILE) return Promise.reject(new Error('«' + file.name + '» больше 25 МБ'));
      var meta = { id: uid('F', 10), clientId: clientId, name: file.name, size: file.size, type: file.type || 'application/octet-stream', at: Date.now(), staffId: me().id };
      return blobOp('readwrite', function (st) { return st.put(file, meta.id); }).then(function () {
        var d = load();
        d.files.push(meta);
        save(d);
        return meta;
      });
    },
    // Скачать может сотрудник с правом files.download или сам клиент (forClientId).
    download: function (fileId, forClientId) {
      var meta = load().files.filter(function (f) { return f.id === fileId; })[0];
      if (!meta) return Promise.reject(new Error('Файл не найден'));
      if (!(can('files.download') || (forClientId && meta.clientId === forClientId))) return Promise.reject(new Error('Недостаточно прав'));
      return blobOp('readonly', function (st) { return st.get(fileId); }).then(function (blob) {
        if (!blob) throw new Error('Содержимое файла не найдено в этом браузере');
        var url = URL.createObjectURL(blob), a = document.createElement('a');
        a.href = url; a.download = meta.name;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
      });
    },
    removeFile: function (fileId) {
      try { need('files.delete'); } catch (e) { return Promise.reject(e); }
      var d = load();
      d.files = d.files.filter(function (f) { return f.id !== fileId; });
      save(d);
      return blobOp('readwrite', function (st) { return st.delete(fileId); });
    },
    fmtSize: function (b) {
      return b < 1024 ? b + ' Б' : b < 1048576 ? (b / 1024).toFixed(0) + ' КБ' : (b / 1048576).toFixed(1) + ' МБ';
    }
  };

  window.DSCRM = api;
})();
