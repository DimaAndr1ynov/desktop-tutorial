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
  var MODE = 'test';
  var MAX_FILE = 25 * 1024 * 1024;

  // Все права, которые можно выдать роли (порядок = порядок строк в таблице прав).
  var PERMS = [
    { id: 'dashboard.view', title: 'Аналитика: клиенты, заявки, выручка' },
    { id: 'clients.view', title: 'Видеть клиентов' },
    { id: 'clients.edit', title: 'Создавать и редактировать клиентов' },
    { id: 'clients.delete', title: 'Удалять клиентов' },
    { id: 'payments.view', title: 'Видеть оплаты' },
    { id: 'payments.edit', title: 'Вносить оплаты' },
    { id: 'projects.work', title: 'Проекты: работать над своими (начать, пауза, завершить, передать)' },
    { id: 'projects.manage', title: 'Проекты: создавать, назначать, видеть все' },
    { id: 'ops.view', title: 'Операции: видеть аренды, флот, ремонты, склад, передачи, услуги' },
    { id: 'ops.edit', title: 'Операции: добавлять и менять записи' },
    { id: 'tariffs.view', title: 'Тарифы: видеть' },
    { id: 'tariffs.edit', title: 'Тарифы: менять цены, предоплату, включать и выключать' },
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
    manager: { title: 'Менеджер', can: ['dashboard.view', 'clients.view', 'clients.edit', 'payments.view', 'payments.edit', 'projects.manage', 'ops.view', 'ops.edit', 'tariffs.view', 'tariffs.edit', 'dialogs', 'messages.send', 'files.upload', 'files.download'] },
    operator: { title: 'Оператор', can: ['projects.work', 'ops.view', 'ops.edit', 'dialogs', 'messages.send', 'files.upload', 'files.download'] },
    editor: { title: 'Монтажёр', can: ['projects.work', 'ops.view', 'dialogs', 'files.upload', 'files.download'] },
    cashier: { title: 'Кассир', can: ['clients.view', 'tariffs.view', 'payments.view', 'payments.edit', 'dialogs', 'messages.send', 'files.download'] }
  };
  var ROLE_ORDER = ['admin', 'manager', 'operator', 'editor', 'cashier'];

  // Тарифы из лендинга (цены в рублях) и способы оплаты.
  var TARIFFS = [
    { id: 'run', title: 'Спуск', price: 1000 },
    { id: 'ride', title: 'Заезд', price: 1500 },
    { id: 'day', title: 'Съёмочный день', price: 3000 },
    { id: 'other', title: 'Другое', price: 0 }
  ];
  var TARIFF_KINDS = [
    { id: 'shoot', title: 'съёмка' },
    { id: 'package', title: 'пакет' },
    { id: 'edit', title: 'монтаж' }
  ];
  var TARIFF_DEFAULTS = [
    { id: 'run', title: 'Спуск', kind: 'shoot', price: 1000, unit: '1 спуск', includes: '30 минут съёмки, 1 трасса, 15 обработанных фото', prepay: null, active: true },
    { id: 'ride', title: 'Заезд', kind: 'package', price: 1500, unit: '1 заезд', includes: '60 минут, до 2 локаций, 25 фото, вертикальный ролик 30–45 сек', prepay: null, active: true },
    { id: 'day', title: 'Съёмочный день', kind: 'package', price: 3000, unit: '1 день', includes: '2–3 часа, 40+ фото, ролик до 2 минут, FPV по запросу', prepay: null, active: true }
  ];
  var TARIFF_SETTINGS_DEFAULT = { prepay: 10, holdMin: 1440 };
  // Общий список TARIFFS (его читают оплаты и аналитика) собирается из data.tariffs; «Другое» есть всегда.
  function syncTariffs(data) {
    TARIFFS.length = 0;
    (data.tariffs || []).forEach(function (x) { TARIFFS.push({ id: x.id, title: x.title, price: x.price, active: x.active !== false }); });
    TARIFFS.push({ id: 'other', title: 'Другое', price: 0, active: true });
  }
  var METHODS = [
    { id: 'card', title: 'Карта' },
    { id: 'cash', title: 'Наличные' },
    { id: 'transfer', title: 'Перевод' }
  ];
  var DAY = 86400000;

  // Операции: разделы меню «Операции» и статусы флота / ремонта.
  var OPS_KINDS = ['rentals', 'fleet', 'repairs', 'stock', 'transfers', 'services'];
  var OPS_PREFIX = { rentals: 'R', fleet: 'E', repairs: 'X', stock: 'S', transfers: 'T', services: 'V' };
  var FLEET_STATUSES = ['free', 'rented', 'staff', 'repair', 'retired'];
  var REPAIR_FLOW = ['accepted', 'work', 'ready', 'closed'];
  function opsData(d) { d.ops = d.ops || {}; OPS_KINDS.forEach(function (k) { d.ops[k] = d.ops[k] || []; }); return d.ops; }
  function fleetItem(ops, id) { return ops.fleet.filter(function (f) { return f.id === id; })[0]; }
  function setFleet(ops, id, status, holder) { var f = fleetItem(ops, id); if (f) { f.status = status; f.holder = holder || ''; } }

  // Статусы смены. Часы считаются только в тех, где counted: true (обед и «не на смене» не идут в отработанное время).
  var STAFF_STATUSES = [
    { id: 'work', title: 'В работе', counted: true },
    { id: 'shoot', title: 'На съёмке', counted: true },
    { id: 'break', title: 'Перерыв', counted: true },
    { id: 'lunch', title: 'На обеде', counted: false },
    { id: 'off', title: 'Не на смене', counted: false },
    { id: 'vacation', title: 'В отпуске', counted: false },
    { id: 'sick', title: 'На больничном', counted: false }
  ];
  var PROJECT_STATUSES = [
    { id: 'todo', title: 'Не начат' },
    { id: 'work', title: 'В работе' },
    { id: 'pause', title: 'Пауза' },
    { id: 'done', title: 'Завершён' }
  ];
  var PROJECT_TYPES = [
    { id: 'shoot', title: 'Съёмка' },
    { id: 'edit', title: 'Монтаж' },
    { id: 'other', title: 'Другое' }
  ];
  var NORM_HOURS = 160; // месячная норма часов для расчёта выполнения и ставки в час
  var SALARY_DEFAULT = { admin: 120000, manager: 75000, operator: 55000, editor: 65000, cashier: 50000 };

  var STATUSES = [
    { id: 'new', title: 'Новый' },
    { id: 'work', title: 'В работе' },
    { id: 'shoot', title: 'Съёмка назначена' },
    { id: 'done', title: 'Завершён' },
    { id: 'lost', title: 'Отказ' }
  ];

  /* ---------- PIN-коды сотрудников ---------- */
  // PIN хранится только хэшем SHA-256. Это макет: хэш четырёх цифр подбирается мгновенно, а данные лежат в браузере.
  var PIN_SALT = 'downshot-pin-v1|';
  var PIN_TRIES = 5, PIN_LOCK_MS = 60000;
  // Тестовые учётки (и демо-сотрудники) получают заранее заданные PIN; сами коды хранятся не здесь, а в отдельном документе у владельца.
  var PIN_DEFAULTS = {
    '+79000000001': '7d70fc92316da9ab5a4082b16efccd681680ccc2b3b2113b90db68fd21f64cb0',
    '+79000000002': '6902f8f6c6815246d13bcd79e1a91df8d7458a60fc1bde4a4d338b64b7f7df28',
    '+79000000003': '18a60d60137067db5b6c7aa26270d138104f8e14cb66a22271b75b3b6b1d2afe',
    '+79000000004': '7b18ef2199c8e321eb742d57cad28cbe19f81eba2a4469afd71e96e8c88fc0f9',
    '+79000000005': '5a0417109a42c0a29af2b48870c07008861c3866afdffe078e114e10784ed070',
    '+79002000001': '00556fcd91e3f879c0ac7ec91e172c8d39dfb2885d5c51d2735661a01870efa4',
    '+79002000002': '404ae449bd2b8f352ab1ff69f4562110e7c288fdc685bc8c47478ebac794005c',
    '+79002000003': '747088e680eb0aaf3c07ff0c96d3e2110130f00d07af87c268fe2f6a22743ca9',
    '+79002000004': '9ed9536afb65f0720d79c7a63106e18640a9b14a3982321ee72b3259a4673ab4',
    '+79002000005': '04412f3c5df1257aaaea520d6421df2b0350c5f4c61143bfd838e381ac3a160b',
    '+79002000006': '7cdd6b9e47b3a6c4f873332712f564df372f2c7f3bd754abd39627b158e3900b',
    '+79002000007': 'a45744f499f1716d2a5fe41714b55533af0f5830006d3d3a9eadc91585226b33',
    '+79002000008': 'baa752d40ae7e09c3b3de0ef3533d59d1a601964c6cf5136501a0e1c1ba6bf12'
  };
  function sha256(ascii) {
    var maxWord = Math.pow(2, 32), result = '', words = [], i, j, bitLen = ascii.length * 8;
    var hash = sha256.h = sha256.h || [], k = sha256.k = sha256.k || [], primeCounter = k.length, isComposite = {};
    for (var candidate = 2; primeCounter < 64; candidate++) {
      if (!isComposite[candidate]) {
        for (i = 0; i < 313; i += candidate) isComposite[i] = candidate;
        hash[primeCounter] = (Math.pow(candidate, 0.5) * maxWord) | 0;
        k[primeCounter++] = (Math.pow(candidate, 1 / 3) * maxWord) | 0;
      }
    }
    ascii += '\x80';
    while (ascii.length % 64 - 56) ascii += '\x00';
    for (i = 0; i < ascii.length; i++) { j = ascii.charCodeAt(i); words[i >> 2] |= j << ((3 - i) % 4) * 8; }
    words[words.length] = (bitLen / maxWord) | 0;
    words[words.length] = bitLen;
    for (j = 0; j < words.length;) {
      var w = words.slice(j, j += 16), old = hash;
      hash = hash.slice(0, 8);
      for (i = 0; i < 64; i++) {
        var w15 = w[i - 15], w2 = w[i - 2], a = hash[0], e = hash[4];
        var t1 = hash[7] + (rr(e, 6) ^ rr(e, 11) ^ rr(e, 25)) + ((e & hash[5]) ^ (~e & hash[6])) + k[i] +
          (w[i] = i < 16 ? w[i] : (w[i - 16] + (rr(w15, 7) ^ rr(w15, 18) ^ (w15 >>> 3)) + w[i - 7] + (rr(w2, 17) ^ rr(w2, 19) ^ (w2 >>> 10))) | 0);
        var t2 = (rr(a, 2) ^ rr(a, 13) ^ rr(a, 22)) + ((a & hash[1]) ^ (a & hash[2]) ^ (hash[1] & hash[2]));
        hash = [(t1 + t2) | 0].concat(hash);
        hash[4] = (hash[4] + t1) | 0;
      }
      for (i = 0; i < 8; i++) hash[i] = (hash[i] + old[i]) | 0;
    }
    for (i = 0; i < 8; i++) for (j = 3; j + 1; j--) { var b = (hash[i] >> (j * 8)) & 255; result += (b < 16 ? 0 : '') + b.toString(16); }
    return result;
    function rr(v, n) { return (v >>> n) | (v << (32 - n)); }
  }
  function pinHash(pin) { return sha256(PIN_SALT + String(pin)); }
  function randomPin() {
    for (;;) {
      var p = '', arr = window.crypto && crypto.getRandomValues ? crypto.getRandomValues(new Uint32Array(1))[0] : Math.floor(Math.random() * 4294967296);
      p = String(arr % 10000); while (p.length < 4) p = '0' + p;
      if (!/^(\d)\1+$/.test(p) && ['1234', '4321', '0123', '1212'].indexOf(p) === -1) return p;
    }
  }

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
    syncTariffs(data);
    return data;
  }
  // v2: роль «Сотрудник» стала «Оператором», добавлены тестовые учётки остальных ролей.
  function migrate(data) {
    var changed = false;
    if (!(data.v >= 2)) { migrateV2(data); changed = true; }
    if (!(data.v >= 3)) {
      // v3: дашборд и оплаты. Если администратор уже менял права роли, новые права по умолчанию дописываем,
      // иначе роль осталась бы без доступа к оплатам и дашборду.
      var fresh = ['dashboard.view', 'payments.view', 'payments.edit'];
      for (var role in (data.rolePerms || {})) {
        if (!ROLES[role] || ROLES[role].locked) continue;
        fresh.forEach(function (p) {
          if (ROLES[role].can.indexOf(p) !== -1 && data.rolePerms[role].indexOf(p) === -1) data.rolePerms[role].push(p);
        });
      }
      data.payments = data.payments || [];
      data.v = 3;
      changed = true;
    }
    if (!(data.v >= 4)) {
      // v4: имена вместо общих названий, оклады, статусы смены и журнал времени
      var names = { 'ST-ADMN': ['Администратор', 'Андрей Волков'], 'ST-EMPL': ['Оператор', 'Ирина Соколова'], 'ST-EDTR': ['Монтажёр', 'Максим Орлов'], 'ST-MNGR': ['Менеджер', 'Елена Миронова'], 'ST-CASH': ['Кассир', 'Наталья Крылова'] };
      var openId = data.session && data.session.id;
      for (var id in data.staff) {
        var st = data.staff[id];
        if (names[id] && st.name === names[id][0]) st.name = names[id][1];
        if (typeof st.salary !== 'number') st.salary = SALARY_DEFAULT[st.role] || 0;
        if (!st.status) {
          st.status = id === openId ? 'work' : 'off';
          st.log = [{ s: st.status, t: Date.now() }];
        }
      }
      data.v = 4;
      changed = true;
    }
    if (!(data.v >= 5)) {
      // v5: проекты. Новые права по умолчанию дописываем в уже изменённые администратором списки.
      ['projects.work', 'projects.manage'].forEach(function (p) {
        for (var role in (data.rolePerms || {})) {
          if (!ROLES[role] || ROLES[role].locked) continue;
          if (ROLES[role].can.indexOf(p) !== -1 && data.rolePerms[role].indexOf(p) === -1) data.rolePerms[role].push(p);
        }
      });
      data.projects = data.projects || [];
      data.v = 5;
      changed = true;
    }
    if (!(data.v >= 6)) {
      // v6: операции. Новые права по умолчанию дописываем в уже изменённые администратором списки ролей.
      ['ops.view', 'ops.edit'].forEach(function (p) {
        for (var role in (data.rolePerms || {})) {
          if (!ROLES[role] || ROLES[role].locked) continue;
          if (ROLES[role].can.indexOf(p) !== -1 && data.rolePerms[role].indexOf(p) === -1) data.rolePerms[role].push(p);
        }
      });
      opsData(data);
      data.v = 6;
      changed = true;
    }
    if (!(data.v >= 7)) {
      // v7: тарифы и предоплата. Новые права по умолчанию дописываем в уже изменённые списки ролей.
      ['tariffs.view', 'tariffs.edit'].forEach(function (p) {
        for (var role in (data.rolePerms || {})) {
          if (!ROLES[role] || ROLES[role].locked) continue;
          if (ROLES[role].can.indexOf(p) !== -1 && data.rolePerms[role].indexOf(p) === -1) data.rolePerms[role].push(p);
        }
      });
      data.tariffs = JSON.parse(JSON.stringify(TARIFF_DEFAULTS));
      data.tariffSettings = JSON.parse(JSON.stringify(TARIFF_SETTINGS_DEFAULT));
      data.v = 7;
      changed = true;
    }
    if (!(data.v >= 8)) {
      // v8: PIN-коды для смены сотрудника. Тестовым учёткам — заранее заданные, остальным админ задаёт PIN в карточке.
      for (var sid in data.staff) {
        var sx = data.staff[sid];
        if (!sx.pin && PIN_DEFAULTS[sx.phone]) sx.pin = PIN_DEFAULTS[sx.phone];
      }
      data.v = 8;
      changed = true;
    }
    if (!data.projects) { data.projects = []; changed = true; }
    if (!data.payments) { data.payments = []; changed = true; }
    return changed;
  }
  function migrateV2(data) {
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
  }
  /* ---------- статусы смены и учёт часов ---------- */
  function statusDef(id) { return STAFF_STATUSES.filter(function (s) { return s.id === id; })[0]; }
  // Меняет статус и дописывает запись в журнал; false, если статус не изменился.
  function pushStatus(s, status, at) {
    if (!statusDef(status)) fail('Неизвестный статус');
    s.log = s.log || [];
    if ((s.status || 'off') === status && s.log.length) return false;
    s.log.push({ s: status, t: at || Date.now() });
    s.status = status;
    if (s.log.length > 600) s.log.splice(0, s.log.length - 600);
    return true;
  }
  function startOfDay(t) { var x = new Date(t); x.setHours(0, 0, 0, 0); return x.getTime(); }
  function startOfMonth(t) { var x = new Date(t); x.setDate(1); x.setHours(0, 0, 0, 0); return x.getTime(); }
  // Отработанное время (мс) за сегодня и за месяц: сумма интервалов в учитываемых статусах.
  function hoursOf(s, now) {
    var res = { today: 0, month: 0 }, log = s.log || [], d0 = startOfDay(now), m0 = startOfMonth(now);
    for (var i = 0; i < log.length; i++) {
      var def = statusDef(log[i].s);
      if (!def || !def.counted) continue;
      var a = log[i].t, b = log[i + 1] ? log[i + 1].t : now;
      res.today += Math.max(0, Math.min(b, now) - Math.max(a, d0));
      res.month += Math.max(0, Math.min(b, now) - Math.max(a, m0));
    }
    return res;
  }
  function since(s) { var l = s.log || []; return l.length ? l[l.length - 1].t : s.createdAt; }
  /* ---------- проекты: время, расчёт зарплаты ---------- */
  // Время (мс), потраченное на проект: по всем исполнителям или по одному (staffId), можно с даты from.
  function projSpent(p, now, staffId, from) {
    return (p.sessions || []).reduce(function (s, x) {
      if (staffId && x.staffId !== staffId) return s;
      var a = Math.max(x.from, from || 0), b = Math.min(x.to || now, now);
      return s + Math.max(0, b - a);
    }, 0);
  }
  // Отработанные часы по дням текущего месяца (мс на каждый день, индекс 0 = 1 число).
  function hoursByDay(s, now) {
    var m0 = startOfMonth(now), nd = new Date(now), total = new Date(nd.getFullYear(), nd.getMonth() + 1, 0).getDate(), out = [], i;
    for (i = 0; i < total; i++) out.push(0);
    var log = s.log || [];
    for (i = 0; i < log.length; i++) {
      var def = statusDef(log[i].s);
      if (!def || !def.counted) continue;
      var a = Math.max(log[i].t, m0), b = Math.min(log[i + 1] ? log[i + 1].t : now, now);
      while (a < b) {
        // граница суток; max(a + минута) страхует от зацикливания в день перевода часов
        var seg = Math.min(b, Math.max(a + 60000, startOfDay(a) + DAY));
        out[new Date(a).getDate() - 1] += seg - a;
        a = seg;
      }
    }
    return out;
  }
  // Расчёт зарплаты: ставка в час = оклад / норма; начислено = ставка × отработанные часы месяца.
  function payroll(salary, monthMs) {
    var rate = salary / NORM_HOURS, hours = monthMs / 3600000;
    return { salary: salary, norm: NORM_HOURS, rate: Math.round(rate), hours: hours, accrued: Math.round(rate * hours),
      left: Math.max(0, NORM_HOURS - hours), over: Math.max(0, hours - NORM_HOURS) };
  }
  // Исполнители проектов: роли с правом projects.work. Администратор проекты не ведёт, только управляет ими.
  function workerRole(d, role) { return !!ROLES[role] && !ROLES[role].locked && rolePerms(d, role).indexOf('projects.work') !== -1; }
  function enrichProject(p, d, db, now) {
    var cl = p.clientId && db.users[p.clientId], run = (p.sessions || []).filter(function (x) { return !x.to; })[0], as = d.staff[p.assigneeId];
    var nm = function (id) { return d.staff[id] ? d.staff[id].name : 'Удалённый сотрудник'; };
    return {
      id: p.id, title: p.title, type: p.type, status: p.status, note: p.note || '', deadline: p.deadline || 0, createdAt: p.createdAt,
      doneAt: p.doneAt || 0, result: p.result || '', clientId: p.clientId || '', clientName: cl ? (cl.name || cl.phone) : '',
      assigneeId: p.assigneeId, assigneeName: as ? as.name : 'Удалённый сотрудник',
      spentMs: projSpent(p, now), running: !!run, runningSince: run ? run.from : 0, demo: !!p.demo,
      transfers: (p.history || []).filter(function (h) { return h.type === 'transfer'; })
        .map(function (h) { return { at: h.t, from: h.from, to: h.to, fromName: nm(h.from), toName: nm(h.to) }; })
    };
  }
  function transferOf(p, to, by, now) {
    (p.sessions || []).forEach(function (x) { if (!x.to) x.to = now; });
    p.history = p.history || [];
    p.history.push({ t: now, type: 'transfer', from: p.assigneeId, to: to, by: by });
    p.assigneeId = to;
    p.status = (p.sessions || []).length ? 'pause' : 'todo'; // новый исполнитель начинает сам
  }
  function projCounts(d, staffId) {
    var c = { work: 0, pause: 0, todo: 0 };
    d.projects.forEach(function (p) { if (p.assigneeId === staffId && c[p.status] !== undefined) c[p.status]++; });
    return c;
  }
  // Демо-проекты для тестового режима. Исполнителей берём из тех, кто есть (операторы и монтажёры), поэтому
  // демо работает и без демо-сотрудников: на двух тестовых учётках проекты просто распределятся между ними.
  function seedDemoProjects(d, now) {
    var HOUR = 3600000, M = 60000, db = clientsDb();
    var pool = function (role) {
      return Object.keys(d.staff).map(function (k) { return d.staff[k]; })
        .filter(function (s) { return s.active && s.role === role && workerRole(d, s.role); })
        .sort(function (a, b) { return a.createdAt - b.createdAt; }).map(function (s) { return s.id; });
    };
    var ops = pool('operator'), eds = pool('editor');
    if (!ops.length && !eds.length) return 0;
    if (!ops.length) ops = eds;
    if (!eds.length) eds = ops;
    var op = function (i) { return ops[i % ops.length]; }, ed = function (i) { return eds[i % eds.length]; };
    var clients = Object.keys(db.users).filter(function (k) { return db.users[k].demo; });
    var dayEnd = function (k) { return startOfDay(now) + (k + 1) * DAY - M; };
    var ses = function (staff, daysAgo, startH, hours) { var from = startOfDay(now) - daysAgo * DAY + startH * HOUR; return { staffId: staff, from: from, to: from + hours * HOUR }; };
    var open = function (staff, minAgo) { return { staffId: staff, from: now - minAgo * M }; };
    var n = 0;
    var mk = function (o) {
      var age = o.age || 3, hist = [{ t: now - age * DAY, type: 'created', by: 'ST-ADMN' }];
      if (o.sessions && o.sessions.length) hist.push({ t: o.sessions[0].from, type: 'start', by: o.sessions[0].staffId });
      if (o.from && o.from !== o.as) hist.push({ t: now - (o.ago || 2) * DAY, type: 'transfer', from: o.from, to: o.as, by: 'ST-ADMN' });
      var p = { id: uid('PR', 6), title: o.title, clientId: o.cl >= 0 && clients[o.cl] ? clients[o.cl] : '', type: o.type, assigneeId: o.as, deadline: o.dl,
        note: o.note || '', status: o.status, createdAt: now - age * DAY, createdBy: 'ST-ADMN', sessions: o.sessions || [], history: hist, demo: true };
      if (o.status === 'done') { p.doneAt = o.doneAt; p.result = o.result; hist.push({ t: o.doneAt, type: 'done', by: o.as }); }
      d.projects.push(p); n++;
    };
    // у исполнителя одновременно идёт один проект: если операторов и монтажёров поровну нет, монтаж ставим на паузу
    var sameWorker = op(0) === ed(0);
    mk({ title: 'Заезд · Роза Хутор', type: 'shoot', as: op(0), cl: 0, status: 'work', dl: dayEnd(1), sessions: [ses(op(0), 1, 10, 2.5), open(op(0), 40)], note: 'Две локации, вертикальный ролик и фото' });
    mk({ title: 'Школа катания · 3 часа', type: 'shoot', as: op(1), cl: 1, status: 'pause', dl: dayEnd(2), sessions: [ses(op(1), 1, 11, 1.8)] });
    mk({ title: 'Фрирайд-сопровождение', type: 'shoot', as: op(2), cl: 3, status: 'todo', dl: dayEnd(3), sessions: [] });
    mk({ title: 'Соревнования клуба · репортаж', type: 'shoot', as: op(0), cl: 4, status: 'done', dl: dayEnd(-3), age: 9, sessions: [ses(op(0), 5, 9, 3.2), ses(op(0), 4, 10, 2)], doneAt: now - 3 * DAY, result: 'Отснято три заезда, 412 кадров. Материал передан монтажёру, отчёт готов.' });
    mk({ title: 'Съёмочный день · бренд экипировки', type: 'shoot', as: op(0), from: op(3), cl: 5, status: 'pause', dl: dayEnd(2), age: 6, sessions: [ses(op(3), 3, 10, 2)] });
    mk({ title: 'Спуск · 30 минут', type: 'shoot', as: op(2), cl: 2, status: 'done', dl: dayEnd(-6), age: 8, sessions: [ses(op(2), 6, 12, 1.1)], doneAt: now - 6 * DAY, result: 'Съёмка на одной трассе, отдано 15 обработанных фото.' });
    mk({ title: 'Монтаж ролика · Заезд', type: 'edit', as: ed(0), cl: 0, status: sameWorker ? 'pause' : 'work', dl: dayEnd(0), sessions: sameWorker ? [ses(ed(0), 1, 12, 3)] : [ses(ed(0), 1, 12, 3), open(ed(0), 70)] });
    mk({ title: 'Рилс 30 сек · сторис', type: 'edit', as: ed(1), cl: 6, status: 'pause', dl: dayEnd(-1), age: 7, sessions: [ses(ed(1), 2, 13, 1.2)] });
    mk({ title: 'Обработка 25 фото', type: 'edit', as: ed(0), cl: 3, status: 'done', dl: dayEnd(-1), age: 6, sessions: [ses(ed(0), 3, 14, 1.5), ses(ed(0), 2, 10, 1)], doneAt: now - 2 * DAY, result: 'Цветокоррекция и ретушь 25 кадров, выгрузка архива клиенту.' });
    mk({ title: 'Монтаж · соревнования клуба', type: 'edit', as: ed(1), from: ed(2), cl: 4, status: 'pause', dl: dayEnd(3), age: 5, ago: 3, sessions: [ses(ed(2), 4, 10, 4)] });
    return n;
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
    if (!s || !s.active) return false;
    var perms = rolePerms(d, s.role);
    // «projects.any» — не настоящее право, а «видит раздел Проекты»: либо работает над проектами, либо управляет ими
    if (action === 'projects.any') return perms.indexOf('projects.work') !== -1 || perms.indexOf('projects.manage') !== -1;
    return perms.indexOf(action) !== -1;
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
    MODE: MODE,
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
        // вошёл — значит начал смену (отпуск и больничный не трогаем: их ставит администратор)
        if ((d.staff[s.id].status || 'off') === 'off') pushStatus(d.staff[s.id], 'work');
        save(d);
        return d.staff[s.id];
      });
    },
    logout: function () {
      var d = load(), s = d.session && d.staff[d.session.id];
      if (s && ['work', 'shoot', 'break', 'lunch'].indexOf(s.status) !== -1) pushStatus(s, 'off'); // вышел — смена закончена
      d.session = null; save(d);
    },

    // Смена сотрудника по его PIN-коду (4 цифры). После 5 неверных попыток — блокировка на минуту.
    switchTo: function (staffId, pin) {
      var cur = me(); if (!cur) fail('Войдите в систему');
      var d = load(), target = d.staff[staffId], now0 = Date.now();
      if (!target || !target.active) fail('Сотрудник недоступен');
      if (target.id === cur.id) fail('Вы уже в этой учётной записи');
      if (!target.pin) fail('У сотрудника не задан PIN-код. Администратор может задать его в карточке сотрудника');
      var pf = target.pinFail || { n: 0, until: 0 };
      if (pf.until > now0) fail('Слишком много попыток. Повторите через ' + Math.ceil((pf.until - now0) / 1000) + ' с');
      if (pinHash(String(pin || '').trim()) !== target.pin) {
        pf.n = (pf.n || 0) + 1;
        if (pf.n >= PIN_TRIES) { pf.n = 0; pf.until = now0 + PIN_LOCK_MS; }
        target.pinFail = pf; save(d);
        fail(pf.until > now0 ? 'Неверный PIN-код. Вход заблокирован на 1 минуту' : 'Неверный PIN-код. Осталось попыток: ' + (PIN_TRIES - pf.n));
      }
      target.pinFail = null;
      var prev = d.staff[cur.id];
      if (prev && ['work', 'shoot', 'break', 'lunch'].indexOf(prev.status) !== -1) pushStatus(prev, 'off'); // смена прежнего закрыта
      d.session = { id: target.id, at: Date.now() };
      if ((target.status || 'off') === 'off') pushStatus(target, 'work');
      save(d);
      return d.staff[target.id];
    },
    // Список для «Сменить сотрудника»: доступен любому вошедшему, без окладов и прав.
    staffChoices: function () {
      var cur = me(); if (!cur) fail('Войдите в систему');
      var d = load();
      return Object.keys(d.staff).map(function (k) { return d.staff[k]; })
        .filter(function (s) { return s.active && s.id !== cur.id; })
        .sort(function (a, b) { return a.createdAt - b.createdAt; })
        .map(function (s) { return { id: s.id, name: s.name, role: s.role, phone: s.phone, status: s.status || 'off', hasPin: !!s.pin }; });
    },

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
      var newPin = '';
      if (!rec) { rec = { id: uid('ST-', 4), createdAt: Date.now(), active: true }; d.staff[rec.id] = rec; newPin = randomPin(); rec.pin = pinHash(newPin); }
      rec.name = st.name.trim(); rec.phone = phone; rec.role = st.role;
      if (typeof st.active === 'boolean') rec.active = st.active;
      if (st.salary !== undefined && st.salary !== '') {
        var sal = Math.round(Number(st.salary));
        if (!(sal >= 0) || sal > 10000000) fail('Оклад: число от 0 до 10 000 000 ₽');
        rec.salary = sal;
      } else if (typeof rec.salary !== 'number') rec.salary = SALARY_DEFAULT[rec.role] || 0;
      if (!rec.log) { rec.status = 'off'; rec.log = [{ s: 'off', t: Date.now() }]; }
      if (st.status && st.status !== rec.status) pushStatus(rec, st.status);
      save(d);
      var out = JSON.parse(JSON.stringify(rec)); delete out.pin;
      if (newPin) out.newPin = newPin; // показывается один раз при создании
      return out;
    },
    staffResetPin: function (id) {
      need('staff.edit');
      var d = load(), s = d.staff[id];
      if (!s) fail('Сотрудник не найден');
      var pin = randomPin();
      s.pin = pinHash(pin); s.pinFail = null;
      save(d);
      return pin; // единственный раз, когда PIN виден
    },
    staffHasPin: function (id) { var s = load().staff[id]; return !!(s && s.pin); },
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
          requests: u.requests || [], lastMessage: last || null, demo: !!u.demo,
          paid: (d.payments || []).reduce(function (s, p) { return p.clientId === u.id ? s + p.amount : s; }, 0),
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
      d.payments = (d.payments || []).filter(function (p) { return p.clientId !== id; });
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
    TARIFFS: TARIFFS,
    TARIFF_KINDS: TARIFF_KINDS,
    METHODS: METHODS,

    /* ---------- тарифы и предоплата ---------- */
    tariffsList: function () {
      need('tariffs.view');
      var d = load();
      return JSON.parse(JSON.stringify({ items: d.tariffs || [], settings: d.tariffSettings || TARIFF_SETTINGS_DEFAULT }));
    },
    tariffSave: function (p) {
      need('tariffs.edit');
      var title = String(p.title || '').trim().slice(0, 60);
      if (!title) fail('Укажите название тарифа');
      var price = Math.round(Number(p.price));
      if (!(price > 0) || price > 10000000) fail('Цена должна быть от 1 до 10 000 000 ₽');
      var kind = TARIFF_KINDS.some(function (k) { return k.id === p.kind; }) ? p.kind : 'shoot';
      var prepay = null;
      if (p.prepay !== '' && p.prepay != null) {
        prepay = Number(p.prepay);
        if (!(prepay >= 0 && prepay <= 100)) fail('Предоплата — от 0 до 100 %');
      }
      var d = load(); d.tariffs = d.tariffs || [];
      if (d.tariffs.some(function (x) { return x.id !== p.id && x.title.toLowerCase() === title.toLowerCase(); })) fail('Тариф с таким названием уже есть');
      var rec = p.id ? d.tariffs.filter(function (x) { return x.id === p.id; })[0] : null;
      if (p.id && !rec) fail('Тариф не найден');
      if (!rec) { rec = { id: uid('F', 6), active: true }; d.tariffs.push(rec); }
      rec.title = title; rec.kind = kind; rec.price = price;
      rec.unit = String(p.unit || '').trim().slice(0, 30);
      rec.includes = String(p.includes || '').trim().slice(0, 240);
      rec.prepay = prepay;
      save(d); syncTariffs(d);
      return JSON.parse(JSON.stringify(rec));
    },
    tariffToggle: function (id, on) {
      need('tariffs.edit');
      var d = load(), rec = (d.tariffs || []).filter(function (x) { return x.id === id; })[0];
      if (!rec) fail('Тариф не найден');
      rec.active = !!on;
      save(d); syncTariffs(d);
    },
    tariffDelete: function (id) {
      need('tariffs.edit');
      var d = load();
      if ((d.payments || []).some(function (p) { return p.tariff === id; })) fail('По этому тарифу уже есть оплаты. Выключите тариф, а не удаляйте: история оплат сохранится');
      d.tariffs = (d.tariffs || []).filter(function (x) { return x.id !== id; });
      save(d); syncTariffs(d);
    },
    tariffSettingsSave: function (s) {
      need('tariffs.edit');
      var prepay = Number(s.prepay), hold = Math.round(Number(s.holdMin));
      if (!(prepay >= 0 && prepay <= 100)) fail('Предоплата — от 0 до 100 %');
      if (!(hold >= 5 && hold <= 43200)) fail('Время бронирования — от 5 минут до 30 суток (43 200 мин)');
      var d = load();
      d.tariffSettings = { prepay: Math.round(prepay * 10) / 10, holdMin: hold };
      save(d);
      return JSON.parse(JSON.stringify(d.tariffSettings));
    },

    /* ---------- оплаты ---------- */
    payments: function (clientId) {
      need('payments.view');
      return (load().payments || []).filter(function (p) { return !clientId || p.clientId === clientId; })
        .sort(function (a, b) { return b.at - a.at; });
    },
    addPayment: function (p) {
      need('payments.edit');
      var amount = Math.round(Number(p.amount));
      if (!(amount > 0) || amount > 10000000) fail('Укажите сумму от 1 до 10 000 000 ₽');
      if (!clientsDb().users[p.clientId]) fail('Клиент не найден');
      if (!METHODS.some(function (m) { return m.id === p.method; })) fail('Выберите способ оплаты');
      var tariff = TARIFFS.some(function (t) { return t.id === p.tariff; }) ? p.tariff : 'other';
      var d = load();
      var rec = { id: uid('P', 8), clientId: p.clientId, amount: amount, tariff: tariff, method: p.method,
        note: String(p.note || '').trim().slice(0, 200), at: Date.now(), staffId: me().id };
      d.payments.push(rec);
      save(d);
      return rec;
    },
    removePayment: function (id) {
      need('clients.delete');
      var d = load();
      d.payments = (d.payments || []).filter(function (p) { return p.id !== id; });
      save(d);
    },

    /* ---------- дашборд ---------- */
    // period: '7' | '30' | '90' | 'all'. Все суммы в рублях.
    stats: function (period) {
      need('dashboard.view');
      var d = load(), db = clientsDb(), now = Date.now();
      var days = period === 'all' ? 0 : (parseInt(period, 10) || 30);
      var from = days ? now - days * DAY : 0, prevFrom = days ? from - days * DAY : 0;
      var users = Object.keys(db.users).map(function (k) { return db.users[k]; });
      var pays = d.payments || [];
      var inP = function (t) { return t >= from; };
      var inPrev = function (t) { return days && t >= prevFrom && t < from; };
      var sum = function (arr) { return arr.reduce(function (s, p) { return s + p.amount; }, 0); };

      var reqs = [];
      users.forEach(function (u) { (u.requests || []).forEach(function (r) { reqs.push({ at: r.at, clientId: u.id, name: u.name, message: r.message }); }); });

      var payP = pays.filter(function (p) { return inP(p.at); }), payPrev = pays.filter(function (p) { return inPrev(p.at); });
      var out = {
        period: period, days: days,
        clients: {
          total: users.length,
          added: users.filter(function (u) { return inP(u.createdAt); }).length,
          addedPrev: users.filter(function (u) { return inPrev(u.createdAt); }).length
        },
        requests: {
          total: reqs.length,
          added: reqs.filter(function (r) { return inP(r.at); }).length,
          addedPrev: reqs.filter(function (r) { return inPrev(r.at); }).length
        },
        revenue: { total: sum(pays), period: sum(payP), prev: sum(payPrev), count: payP.length,
          avg: payP.length ? Math.round(sum(payP) / payP.length) : 0 },
        statuses: {}, tariffs: {}, methods: {}
      };

      // воронка по статусам (по всем клиентам)
      STATUSES.forEach(function (s) { out.statuses[s.id] = 0; });
      users.forEach(function (u) { out.statuses[u.status || 'new'] = (out.statuses[u.status || 'new'] || 0) + 1; });
      var payers = {}; pays.forEach(function (p) { payers[p.clientId] = true; });
      out.paidClients = Object.keys(payers).filter(function (id) { return db.users[id]; }).length;

      // выручка по тарифам и способам оплаты за период
      TARIFFS.forEach(function (t) { out.tariffs[t.id] = { sum: 0, count: 0 }; });
      METHODS.forEach(function (m) { out.methods[m.id] = { sum: 0, count: 0 }; });
      payP.forEach(function (p) {
        var t = out.tariffs[p.tariff] || out.tariffs.other; t.sum += p.amount; t.count++;
        var m = out.methods[p.method]; if (m) { m.sum += p.amount; m.count++; }
      });

      // график выручки: 7 дней = 7 столбцов, 30 дней = 30, 90 дней = 13 недель, всё время = 12 месяцев
      var buckets = [], i;
      var startOfDay = function (t) { var x = new Date(t); x.setHours(0, 0, 0, 0); return x.getTime(); };
      var fmtD = function (t) { return new Date(t).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }); };
      if (period === 'all') {
        var m0 = new Date(now); m0.setDate(1); m0.setHours(0, 0, 0, 0);
        for (i = 11; i >= 0; i--) {
          var a = new Date(m0.getFullYear(), m0.getMonth() - i, 1), b = new Date(m0.getFullYear(), m0.getMonth() - i + 1, 1);
          buckets.push({ from: a.getTime(), to: b.getTime(), label: a.toLocaleDateString('ru-RU', { month: 'short' }), sum: 0, count: 0 });
        }
      } else if (days === 90) {
        for (i = 12; i >= 0; i--) {
          var e = startOfDay(now) + DAY - i * 7 * DAY;
          buckets.push({ from: e - 7 * DAY, to: e, label: fmtD(e - 7 * DAY), sum: 0, count: 0 });
        }
      } else {
        var n = days === 7 ? 7 : 30;
        for (i = n - 1; i >= 0; i--) {
          var s0 = startOfDay(now) - i * DAY;
          buckets.push({ from: s0, to: s0 + DAY, label: fmtD(s0), sum: 0, count: 0 });
        }
      }
      pays.forEach(function (p) {
        for (var k = 0; k < buckets.length; k++) if (p.at >= buckets[k].from && p.at < buckets[k].to) { buckets[k].sum += p.amount; buckets[k].count++; break; }
      });
      out.chart = buckets;

      // требует внимания
      var msgsBy = {}; d.messages.forEach(function (m) { msgsBy[m.clientId] = m; });
      var mini = function (u) { return { id: u.id, name: u.name || 'Без имени', status: u.status || 'new' }; };
      out.attention = {
        unanswered: users.filter(function (u) { return msgsBy[u.id] && msgsBy[u.id].dir === 'in'; })
          .map(function (u) { var o = mini(u); o.at = msgsBy[u.id].at; o.text = msgsBy[u.id].text; return o; })
          .sort(function (a, b) { return a.at - b.at; }),
        noAssignee: users.filter(function (u) { return (u.status || 'new') === 'new' && !u.assignee; })
          .map(function (u) { var o = mini(u); o.at = u.createdAt; return o; }).sort(function (a, b) { return a.at - b.at; }),
        unpaid: users.filter(function (u) { return (u.status === 'shoot' || u.status === 'done') && !payers[u.id]; })
          .map(function (u) { var o = mini(u); o.at = u.createdAt; return o; }).sort(function (a, b) { return a.at - b.at; })
      };

      // нагрузка: клиентов на сотрудника
      var load_ = {};
      users.forEach(function (u) { if (u.assignee) load_[u.assignee] = (load_[u.assignee] || 0) + 1; });
      out.workload = Object.keys(load_).map(function (id) { return { id: id, name: d.staff[id] ? d.staff[id].name : 'Удалённый сотрудник', count: load_[id] }; })
        .sort(function (a, b) { return b.count - a.count; });
      out.unassigned = users.filter(function (u) { return !u.assignee; }).length;

      // последние события
      var feed = [];
      users.forEach(function (u) { feed.push({ at: u.createdAt, kind: 'client', clientId: u.id, name: u.name || 'Без имени' }); });
      reqs.forEach(function (r) { feed.push({ at: r.at, kind: 'request', clientId: r.clientId, name: r.name || 'Без имени', text: r.message }); });
      pays.forEach(function (p) {
        var u = db.users[p.clientId];
        if (u) feed.push({ at: p.at, kind: 'payment', clientId: p.clientId, name: u.name || 'Без имени', amount: p.amount, tariff: p.tariff });
      });
      out.feed = feed.sort(function (a, b) { return b.at - a.at; }).slice(0, 8);
      out.hasDemo = users.some(function (u) { return u.demo; });
      return out;
    },

    /* ---------- демо-данные (только тестовый режим) ---------- */
    hasDemo: function () {
      return Object.keys(clientsDb().users).some(function (k) { return clientsDb().users[k].demo; });
    },
    seedDemo: function () {
      need('clients.edit');
      if (api.hasDemo()) return 0;
      var db = clientsDb(), d = load(), now = Date.now();
      var ago = function (days, hour) { var t = new Date(now - days * DAY); t.setHours(hour || 12, (days * 7) % 60, 0, 0); return t.getTime(); };
      var price = function (id) { var t = TARIFFS.filter(function (x) { return x.id === id; })[0] || TARIFF_DEFAULTS.filter(function (x) { return x.id === id; })[0]; return t.price; };
      var staffIds = Object.keys(d.staff).filter(function (k) { return d.staff[k].active; });
      var operator = d.staff['ST-EMPL'] ? 'ST-EMPL' : staffIds[0], manager = d.staff['ST-MNGR'] ? 'ST-MNGR' : staffIds[0];
      var demo = [
        { name: 'Алексей Смирнов', phone: '+79001000001', d: 27, status: 'done', as: operator, req: [[27, 'Хочу тариф «Заезд» на субботу, снимаем фрирайд.']], pay: [[20, 'ride', 'card'], [6, 'run', 'cash']] },
        { name: 'Марина Ковалёва', phone: '+79001000002', d: 24, status: 'done', as: manager, req: [[24, 'Нужна съёмка для школы катания, 3 часа.']], pay: [[18, 'day', 'transfer'], [4, 'ride', 'card']] },
        { name: 'Игорь Белов', phone: '+79001000003', d: 21, status: 'done', as: operator, req: [[21, 'Спуск на одной трассе, 30 минут.']], pay: [[15, 'run', 'cash']] },
        { name: 'Ольга Назарова', phone: '+79001000004', d: 17, status: 'shoot', as: manager, req: [[17, 'Заезд и ролик для соцсетей, две локации.']], pay: [[9, 'ride', 'card']] },
        { name: 'Денис Орлов', phone: '+79001000005', d: 12, status: 'work', as: '', req: [[12, 'Соревнования клуба, нужен репортаж.'], [5, 'Уточните стоимость на весь день.']], pay: [], msg: [[1, 'in', 'Подтвердите, пожалуйста, дату съёмки.']] },
        { name: 'Светлана Ли', phone: '+79001000006', d: 8, status: 'shoot', as: operator, req: [[8, 'Съёмочный день для бренда экипировки.']], pay: [[3, 'day', 'transfer']] },
        { name: 'Артём Громов', phone: '+79001000007', d: 4, status: 'new', as: '', req: [[4, 'Можно снять FPV-пролёт над склоном?']], pay: [], msg: [[1, 'in', 'Здравствуйте, жду ответа по FPV.']] },
        { name: 'Вера Тихонова', phone: '+79001000008', d: 2, status: 'new', as: '', req: [[2, 'Хочу попробовать, подскажите, какой тариф лучше.']], pay: [] },
        { name: 'Павел Руднев', phone: '+79001000009', d: 26, status: 'lost', as: manager, req: [[26, 'Спросил цены, не подошло по датам.']], pay: [] }
      ];
      demo.forEach(function (x) {
        if (phoneTaken(db.users, x.phone)) return;
        var id = A._generateId(db.users);
        db.users[id] = { id: id, phone: x.phone, name: x.name, createdAt: ago(x.d, 11), status: x.status, assignee: x.as, note: '', demo: true,
          requests: x.req.map(function (r) { return { at: ago(r[0], 14), email: '', message: r[1] }; }).sort(function (a, b) { return b.at - a.at; }) };
        x.pay.forEach(function (p) {
          d.payments.push({ id: uid('P', 8), clientId: id, amount: price(p[1]), tariff: p[1], method: p[2], note: '', at: ago(p[0], 16), staffId: manager, demo: true });
        });
        (x.msg || []).forEach(function (m) {
          d.messages.push({ id: uid('M', 8), clientId: id, dir: m[1], text: m[2], at: ago(m[0], 10), staffId: m[1] === 'out' ? operator : undefined, status: 'test', demo: true });
        });
      });
      A._store.save(db); save(d);
      return demo.length;
    },
    clearDemo: function () {
      need('clients.delete');
      var db = clientsDb(), d = load(), ids = {};
      Object.keys(db.users).forEach(function (k) { if (db.users[k].demo) { ids[k] = true; delete db.users[k]; } });
      A._store.save(db);
      d.payments = (d.payments || []).filter(function (p) { return !ids[p.clientId]; });
      d.messages = d.messages.filter(function (m) { return !ids[m.clientId]; });
      d.files = d.files.filter(function (f) { return !ids[f.clientId]; });
      save(d);
    },

    /* ---------- демо-данные личного кабинета (только тестовый режим, для самого клиента) ---------- */
    hasCabinetDemo: function (clientId) {
      var d = load();
      return d.messages.concat(d.files).some(function (x) { return x.clientId === clientId && x.demo; }) ||
        ((clientsDb().users[clientId] || {}).requests || []).some(function (r) { return r.demo; });
    },
    seedCabinetDemo: function (clientId) {
      var db = clientsDb(), u = db.users[clientId];
      if (!u || api.hasCabinetDemo(clientId)) return Promise.resolve(0);
      var d = load(), now = Date.now(), staff = Object.keys(d.staff)[0];
      var ago = function (days, hour, min) { var t = new Date(now - days * DAY); t.setHours(hour, min || 0, 0, 0); return t.getTime(); };
      var shots = [['Спуск_01.jpg', '#3b82f6', '#0f172a'], ['Спуск_02.jpg', '#8b5cf6', '#0f172a'], ['Заезд_фрирайд.jpg', '#06b6d4', '#082f49']];
      var mk = function (s) {
        return new Promise(function (res) {
          var text = 'DOWNSHOT · демо-кадр ' + s[0];
          try {
            var c = document.createElement('canvas'); c.width = 960; c.height = 600;
            var g = c.getContext('2d'), gr = g.createLinearGradient(0, 0, 960, 600);
            gr.addColorStop(0, s[1]); gr.addColorStop(1, s[2]);
            g.fillStyle = gr; g.fillRect(0, 0, 960, 600);
            g.fillStyle = 'rgba(255,255,255,.9)'; g.font = '700 54px sans-serif'; g.fillText('DOWNSHOT', 60, 300);
            g.font = '28px sans-serif'; g.fillText('демо-кадр · ' + s[0], 60, 350);
            c.toBlob(function (b) { res(b || new Blob([text], { type: 'text/plain' })); }, 'image/jpeg', 0.85);
          } catch (e) { res(new Blob([text], { type: 'text/plain' })); }
        });
      };
      var notes = new Blob(['Это демо-файл личного кабинета. Настоящие фото и видео студия загрузит после съёмки.'], { type: 'text/plain' });
      return Promise.all(shots.map(mk)).then(function (blobs) {
        blobs.push(notes);
        var names = shots.map(function (s) { return s[0]; }).concat(['Как_скачать_оригиналы.txt']);
        var when = [[3, 15, 40], [3, 15, 41], [2, 11, 5], [3, 15, 30]];
        return Promise.all(blobs.map(function (b, i) {
          var meta = { id: uid('F', 10), clientId: clientId, name: names[i], size: b.size, type: b.type || 'application/octet-stream', at: ago(when[i][0], when[i][1], when[i][2]), staffId: staff, demo: true };
          return blobOp('readwrite', function (st) { return st.put(b, meta.id); }).then(function () { return meta; });
        }));
      }).then(function (metas) {
        var d2 = load();
        metas.forEach(function (m) { d2.files.push(m); });
        var msg = function (days, h, min, dir, text) { d2.messages.push({ id: uid('M', 8), clientId: clientId, dir: dir, text: text, at: ago(days, h, min), staffId: dir === 'out' ? staff : undefined, status: 'test', demo: true }); };
        var fmsg = function (meta) { d2.messages.push({ id: uid('M', 8), clientId: clientId, dir: 'out', kind: 'file', fileId: meta.id, text: meta.name, size: meta.size, at: meta.at + 60000, staffId: staff, status: 'test', demo: true }); };
        msg(5, 12, 10, 'out', 'Здравствуйте! Это DOWNSHOT. Получили вашу заявку, на какое число планируете съёмку?');
        msg(5, 12, 26, 'in', 'Добрый день! В субботу утром, около 10:00, трасса у подъёмника.');
        msg(5, 12, 31, 'out', 'Отлично, записали. Будем на склоне в 9:45, дрон и камеры с нами.');
        msg(3, 15, 22, 'out', 'Съёмка готова! Первые кадры загрузили, остальное допишем до вечера.');
        fmsg(metas[0]); fmsg(metas[1]);
        msg(3, 16, 2, 'in', 'Класс, огромное спасибо!');
        msg(2, 11, 0, 'out', 'Добавили ещё один кадр и короткую памятку, как скачать оригиналы.');
        fmsg(metas[2]);
        d2.messages.sort(function (a, b) { return a.at - b.at; });
        save(d2);
        var db2 = clientsDb(), u2 = db2.users[clientId];
        u2.requests = (u2.requests || []).concat([
          { at: ago(6, 14, 5), email: '', message: 'Хочу тариф «Заезд» на субботу, снимаем фрирайд.', demo: true },
          { at: ago(1, 9, 30), email: '', message: 'Можно добавить второй заезд в тот же день?', demo: true }
        ]).sort(function (a, b) { return b.at - a.at; });
        A._store.save(db2);
        return metas.length;
      });
    },
    clearCabinetDemo: function (clientId) {
      var d = load(), gone = d.files.filter(function (f) { return f.clientId === clientId && f.demo; });
      d.messages = d.messages.filter(function (m) { return !(m.clientId === clientId && m.demo); });
      d.files = d.files.filter(function (f) { return !(f.clientId === clientId && f.demo); });
      save(d);
      gone.forEach(function (f) { blobOp('readwrite', function (st) { return st.delete(f.id); }); });
      var db = clientsDb(), u = db.users[clientId];
      if (u) { u.requests = (u.requests || []).filter(function (r) { return !r.demo; }); A._store.save(db); }
    },

    STAFF_STATUSES: STAFF_STATUSES,
    NORM_HOURS: NORM_HOURS,

    /* ---------- смена: статусы и часы ---------- */
    // Свой статус меняет любой сотрудник, чужой только тот, у кого staff.edit.
    setStatus: function (staffId, status) {
      var d = load(), cur = me();
      if (!cur) fail('Нужно войти');
      if (staffId !== cur.id) need('staff.edit');
      var rec = d.staff[staffId];
      if (!rec) fail('Сотрудник не найден');
      if (pushStatus(rec, status)) save(d);
      return rec.status;
    },
    myShift: function () {
      var s = me();
      if (!s) return null;
      var h = hoursOf(s, Date.now());
      return { status: s.status || 'off', since: since(s), todayMs: h.today, monthMs: h.month };
    },
    // Кто сейчас в каком статусе: видно всем, кто смотрит дашборд или управляет сотрудниками (без окладов).
    team: function () {
      if (!can('dashboard.view') && !can('staff.edit')) fail('Недостаточно прав');
      var d = load();
      return Object.keys(d.staff).map(function (k) { return d.staff[k]; })
        .filter(function (s) { return s.active; })
        .sort(function (a, b) { return ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) || a.createdAt - b.createdAt; })
        .map(function (s) { return { id: s.id, name: s.name, role: s.role, status: s.status || 'off', since: since(s) }; });
    },
    // Полная картина по команде для администратора: оклады, часы за сегодня и за месяц.
    staffOverview: function () {
      need('staff.edit');
      var d = load(), now = Date.now();
      return Object.keys(d.staff).map(function (k) {
        var s = d.staff[k], h = hoursOf(s, now);
        return { id: s.id, name: s.name, phone: s.phone, role: s.role, active: s.active, demo: !!s.demo, createdAt: s.createdAt,
          salary: s.salary || 0, status: s.status || 'off', since: since(s), todayMs: h.today, monthMs: h.month,
          worker: workerRole(d, s.role), proj: projCounts(d, s.id) };
      }).sort(function (a, b) { return a.createdAt - b.createdAt; });
    },

    /* ---------- демо-сотрудники (только тестовый режим) ---------- */
    hasDemoStaff: function () {
      var d = load();
      return Object.keys(d.staff).some(function (k) { return d.staff[k].demo; });
    },
    seedDemoStaff: function () {
      need('staff.edit');
      var d = load(), now = Date.now();
      if (api.hasDemoStaff()) return 0;
      var d0 = startOfDay(now), m0 = startOfMonth(now), HOUR = 3600000;
      var list = [
        ['Сергей Белов', 'operator', 55000, 'work'], ['Анастасия Лебедева', 'operator', 55000, 'lunch'],
        ['Павел Громов', 'editor', 65000, 'work'], ['Олеся Кузнецова', 'editor', 65000, 'vacation'],
        ['Дарья Фёдорова', 'manager', 75000, 'break'], ['Роман Зайцев', 'manager', 75000, 'shoot'],
        ['Светлана Попова', 'cashier', 50000, 'off'], ['Виктор Ильин', 'operator', 55000, 'sick']
      ];
      var used = {}; Object.keys(d.staff).forEach(function (k) { used[d.staff[k].phone] = true; });
      var n = 0;
      list.forEach(function (x, i) {
        var phone = '+7900200000' + (i + 1);
        if (used[phone]) return;
        var id = uid('ST-', 4), log = [], stat = x[3];
        // прошлые дни этого месяца: смена с 9 до 18, обед с 13 до 14; пятидневка (выходные пропускаем)
        for (var day = m0; day < d0; day += DAY) {
          var wd = new Date(day).getDay();
          if (wd === 0 || wd === 6) continue;
          if (stat === 'vacation' && day >= d0 - 5 * DAY) continue;
          if (stat === 'sick' && day >= d0 - 3 * DAY) continue;
          var j = ((i * 7 + new Date(day).getDate()) % 5) * 6 * 60000; // небольшой разброс по приходу и уходу
          log.push({ s: 'work', t: day + 9 * HOUR + j }, { s: 'lunch', t: day + 13 * HOUR + j / 2 }, { s: 'work', t: day + 14 * HOUR + j / 2 }, { s: 'off', t: day + 18 * HOUR + j });
        }
        // сегодня: смена начата недавно, чтобы текущий статус не уходил в будущее
        // начало текущей смены: с 9:00, но не раньше чем за 5,5 часа до «сейчас», чтобы вечером за сегодня не набегало 11 часов
        var start = Math.max(d0, Math.min(now - 60000, Math.max(d0 + 9 * HOUR, now - 5.5 * HOUR)));
        if (stat === 'work') log.push({ s: 'work', t: start });
        else if (stat === 'lunch') log.push({ s: 'work', t: start }, { s: 'lunch', t: Math.max(start + 60000, now - 25 * 60000) });
        else if (stat === 'break') log.push({ s: 'work', t: start }, { s: 'break', t: Math.max(start + 60000, now - 10 * 60000) });
        else if (stat === 'shoot') log.push({ s: 'work', t: start }, { s: 'shoot', t: Math.max(start + 60000, now - HOUR) });
        else if (stat === 'vacation' || stat === 'sick') log.push({ s: stat, t: d0 - (stat === 'vacation' ? 5 : 3) * DAY + 1 });
        else if (!log.length || log[log.length - 1].s !== 'off') log.push({ s: 'off', t: d0 - HOUR });
        d.staff[id] = { id: id, phone: phone, name: x[0], role: x[1], active: true, createdAt: now - (30 + i) * DAY, salary: x[2], status: stat, log: log, demo: true, pin: PIN_DEFAULTS[phone] };
        n++;
      });
      if (!d.projects.some(function (p) { return p.demo; })) seedDemoProjects(d, now);
      save(d);
      return n;
    },
    clearDemoStaff: function () {
      need('staff.edit');
      var d = load(), cur = me();
      Object.keys(d.staff).forEach(function (k) { if (d.staff[k].demo && k !== cur.id) delete d.staff[k]; });
      d.projects = (d.projects || []).filter(function (p) { return !p.demo; });
      // клиенты не должны ссылаться на удалённых сотрудников
      var db = clientsDb(), touched = false;
      Object.keys(db.users).forEach(function (k) { var u = db.users[k]; if (u.assignee && !d.staff[u.assignee]) { u.assignee = ''; touched = true; } });
      if (touched) A._store.save(db);
      save(d);
    },

    PROJECT_STATUSES: PROJECT_STATUSES,
    PROJECT_TYPES: PROJECT_TYPES,

    /* ---------- проекты ---------- */
    // Исполнители: активные сотрудники, которым можно назначать проекты (у роли есть право projects.work).
    assignable: function () {
      need('projects.any');
      var d = load();
      return Object.keys(d.staff).map(function (k) { return d.staff[k]; })
        .filter(function (s) { return s.active && workerRole(d, s.role); })
        .sort(function (a, b) { return ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) || a.createdAt - b.createdAt; })
        .map(function (s) { return { id: s.id, name: s.name, role: s.role }; });
    },
    // Руководитель видит все проекты, исполнитель только свои и те, что передал другим.
    projects: function () {
      need('projects.any');
      var d = load(), db = clientsDb(), cur = me(), now = Date.now(), all = can('projects.manage') || can('staff.edit');
      return d.projects.filter(function (p) {
        return all || p.assigneeId === cur.id || (p.history || []).some(function (h) { return h.type === 'transfer' && h.from === cur.id; });
      }).map(function (p) { var e = enrichProject(p, d, db, now); e.mineMs = projSpent(p, now, cur.id); return e; });
    },
    addProject: function (x) {
      need('projects.manage');
      var d = load(), now = Date.now(), title = String(x.title || '').trim();
      if (!title) fail('Назовите проект');
      var type = PROJECT_TYPES.some(function (t) { return t.id === x.type; }) ? x.type : 'other';
      if (!d.staff[x.assigneeId] || !d.staff[x.assigneeId].active || !workerRole(d, d.staff[x.assigneeId].role)) fail('Выберите исполнителя: оператора или монтажёра');
      if (x.clientId && !clientsDb().users[x.clientId]) fail('Клиент не найден');
      var p = { id: uid('PR', 6), title: title.slice(0, 80), clientId: x.clientId || '', type: type, assigneeId: x.assigneeId, deadline: Number(x.deadline) || 0,
        note: String(x.note || '').trim().slice(0, 300), status: 'todo', createdAt: now, createdBy: me().id, sessions: [], history: [{ t: now, type: 'created', by: me().id }] };
      d.projects.push(p); save(d);
      return p.id;
    },
    updateProject: function (id, x) {
      need('projects.manage');
      var d = load(), p = d.projects.filter(function (q) { return q.id === id; })[0], now = Date.now();
      if (!p) fail('Проект не найден');
      if (!String(x.title || '').trim()) fail('Назовите проект');
      p.title = String(x.title).trim().slice(0, 80);
      if (PROJECT_TYPES.some(function (t) { return t.id === x.type; })) p.type = x.type;
      if (x.clientId && !clientsDb().users[x.clientId]) fail('Клиент не найден');
      p.clientId = x.clientId || '';
      p.deadline = Number(x.deadline) || 0;
      p.note = String(x.note || '').trim().slice(0, 300);
      if (x.assigneeId && x.assigneeId !== p.assigneeId && p.status !== 'done') {
        if (!d.staff[x.assigneeId] || !d.staff[x.assigneeId].active || !workerRole(d, d.staff[x.assigneeId].role)) fail('Выберите исполнителя: оператора или монтажёра');
        transferOf(p, x.assigneeId, me().id, now);
      }
      save(d);
    },
    removeProject: function (id) {
      need('projects.manage');
      var d = load();
      d.projects = d.projects.filter(function (p) { return p.id !== id; });
      save(d);
    },
    // Действия над проектом: start (начать или продолжить), pause, done ({text}), transfer ({to}).
    // Выполняет исполнитель проекта или тот, у кого projects.manage / staff.edit.
    projectAction: function (id, action, payload) {
      var d = load(), cur = me(), now = Date.now();
      if (!cur) fail('Нужно войти');
      var p = d.projects.filter(function (q) { return q.id === id; })[0];
      if (!p) fail('Проект не найден');
      var manager = can('projects.manage') || can('staff.edit'), own = p.assigneeId === cur.id && can('projects.work');
      if (!manager && !own) fail('Недостаточно прав');
      if (p.status === 'done') fail('Проект уже завершён');
      p.sessions = p.sessions || []; p.history = p.history || [];
      var res = { autoPaused: '' };
      var stop = function () { p.sessions.forEach(function (x) { if (!x.to) x.to = now; }); };
      if (action === 'start') {
        if (p.status === 'work') return res;
        // у исполнителя одновременно идёт один проект: остальные ставим на паузу
        d.projects.forEach(function (o) {
          if (o.id !== p.id && o.assigneeId === p.assigneeId && o.status === 'work') {
            (o.sessions || []).forEach(function (x) { if (!x.to) x.to = now; });
            o.status = 'pause'; o.history.push({ t: now, type: 'pause', by: cur.id, auto: true }); res.autoPaused = o.title;
          }
        });
        p.history.push({ t: now, type: p.status === 'pause' ? 'resume' : 'start', by: cur.id });
        p.sessions.push({ staffId: p.assigneeId, from: now });
        p.status = 'work';
      } else if (action === 'pause') {
        if (p.status !== 'work') fail('Проект не в работе');
        stop(); p.status = 'pause'; p.history.push({ t: now, type: 'pause', by: cur.id });
      } else if (action === 'done') {
        stop(); p.status = 'done'; p.doneAt = now;
        p.result = String((payload && payload.text) || '').trim().slice(0, 500);
        p.history.push({ t: now, type: 'done', by: cur.id });
      } else if (action === 'transfer') {
        var to = payload && payload.to;
        if (!to || to === p.assigneeId) fail('Выберите другого сотрудника');
        if (!d.staff[to] || !d.staff[to].active || !workerRole(d, d.staff[to].role)) fail('Проект можно передать оператору или монтажёру');
        transferOf(p, to, cur.id, now);
      } else fail('Неизвестное действие');
      save(d);
      return res;
    },

    /* ---------- карточка сотрудника: часы, расчёт зарплаты, проекты, проделанная работа ---------- */
    staffDetail: function (id) {
      need('staff.edit');
      var d = load(), s = d.staff[id], now = Date.now(), db = clientsDb();
      if (!s) fail('Сотрудник не найден');
      var h = hoursOf(s, now), m0 = startOfMonth(now);
      var out = { id: s.id, name: s.name, phone: s.phone, role: s.role, active: s.active, demo: !!s.demo, salary: s.salary || 0, status: s.status || 'off',
        since: since(s), todayMs: h.today, monthMs: h.month, days: hoursByDay(s, now), today: new Date(now).getDate() - 1,
        payroll: payroll(s.salary || 0, h.month), worker: workerRole(d, s.role), projects: [], doneMonth: [], transferred: [], report: [], projMs: 0 };
      if (!out.worker) return out;
      var mine = d.projects.filter(function (p) { return p.assigneeId === id; });
      var en = function (p) { var e = enrichProject(p, d, db, now); e.mineMs = projSpent(p, now, id); e.mineMonthMs = projSpent(p, now, id, m0); return e; };
      out.projects = mine.filter(function (p) { return p.status !== 'done'; }).map(en);
      out.doneMonth = mine.filter(function (p) { return p.status === 'done' && p.doneAt >= m0; }).map(en);
      out.transferred = d.projects.filter(function (p) {
        return p.assigneeId !== id && (p.history || []).some(function (x) { return x.type === 'transfer' && x.from === id; });
      }).map(en);
      // отчёт: все проекты, над которыми сотрудник работал в этом месяце, и что сделано
      var touched = {};
      d.projects.forEach(function (p) {
        var ms = projSpent(p, now, id, m0);
        if (ms > 0 || (p.assigneeId === id && p.status === 'done' && p.doneAt >= m0)) touched[p.id] = p;
      });
      out.report = Object.keys(touched).map(function (k) { var e = en(touched[k]); return e; })
        .sort(function (a, b) { return (b.doneAt || b.runningSince || 0) - (a.doneAt || a.runningSince || 0); });
      out.projMs = out.report.reduce(function (a, e) { return a + e.mineMonthMs; }, 0);
      return out;
    },

    /* ---------- демо-режим проектов (только тестовый режим) ---------- */
    hasDemoProjects: function () {
      return load().projects.some(function (p) { return p.demo; });
    },
    // Добавляет демо-проекты на уже существующих операторов и монтажёров. Если исполнителей нет, а у вас есть
    // право управлять сотрудниками, сначала создаёт демо-сотрудников (вместе с ними появятся и демо-проекты).
    seedDemoProjectsOnly: function () {
      need('projects.manage');
      var d = load(), now = Date.now();
      if (d.projects.some(function (p) { return p.demo; })) return 0;
      var n = seedDemoProjects(d, now);
      if (!n) {
        if (can('staff.edit')) { api.seedDemoStaff(); return load().projects.filter(function (p) { return p.demo; }).length; }
        fail('Нет исполнителей: добавьте оператора или монтажёра');
      }
      save(d);
      return n;
    },
    clearDemoProjects: function () {
      need('projects.manage');
      var d = load();
      d.projects = d.projects.filter(function (p) { return !p.demo; });
      save(d);
    },

    /* ---------- операции: аренды, флот, ремонты, склад, передачи, услуги мастера ---------- */
    OPS_KINDS: OPS_KINDS,
    opsRefs: function () {
      need('ops.view');
      var d = load(), ops = opsData(d), db = clientsDb();
      return {
        fleet: ops.fleet.map(function (f) { return { id: f.id, name: f.name, status: f.status }; }),
        staff: Object.keys(d.staff).map(function (k) { return d.staff[k]; }).filter(function (s) { return s.active; }).map(function (s) { return { id: s.id, name: s.name, role: s.role }; }),
        clients: Object.keys(db.users).map(function (k) { return db.users[k]; }).map(function (u) { return { id: u.id, name: u.name || u.phone }; })
      };
    },
    opsList: function (kind) {
      need('ops.view');
      if (OPS_KINDS.indexOf(kind) < 0) fail('Неизвестный раздел');
      return JSON.parse(JSON.stringify(opsData(load())[kind]));
    },
    opsSave: function (kind, x) {
      need('ops.edit');
      if (OPS_KINDS.indexOf(kind) < 0) fail('Неизвестный раздел');
      var d = load(), ops = opsData(d), list = ops[kind], cur = null, now = Date.now();
      var txt = function (v, n) { return String(v || '').trim().slice(0, n || 120); };
      var num = function (v) { v = Math.round(Number(v)); return v > 0 ? v : 0; };
      if (x.id) { cur = list.filter(function (r) { return r.id === x.id; })[0]; if (!cur) fail('Запись не найдена'); }
      var r = cur || { id: uid(OPS_PREFIX[kind], 6), createdAt: now, by: me().id };
      var item = !cur && x.fleetId ? fleetItem(ops, x.fleetId) : null;
      if (kind === 'fleet') {
        if (!txt(x.name)) fail('Укажите название техники');
        r.name = txt(x.name); r.category = txt(x.category, 40) || 'Другое'; r.serial = txt(x.serial, 60); r.note = txt(x.note, 300);
        if (!cur) { r.status = 'free'; r.holder = ''; }
        else if (x.status && FLEET_STATUSES.indexOf(x.status) >= 0 && (r.status === 'free' || r.status === 'retired')) r.status = x.status;
      } else if (kind === 'rentals') {
        if (!cur) {
          if (!item) fail('Выберите технику');
          if (item.status !== 'free') fail('Эта техника сейчас занята');
          r.fleetId = item.id; r.status = 'active';
        }
        r.clientId = txt(x.clientId, 20); r.clientName = txt(x.clientName, 80);
        if (!r.clientId && !r.clientName) fail('Укажите клиента');
        r.start = Number(x.start) || now; r.end = Number(x.end) || r.start + DAY;
        if (r.end < r.start) fail('Дата возврата раньше выдачи');
        r.price = num(x.price); r.note = txt(x.note, 300);
        if (!cur) { item.status = 'rented'; item.holder = r.clientName || r.clientId; }
      } else if (kind === 'repairs') {
        if (!txt(x.problem)) fail('Опишите неисправность');
        if (!cur) {
          if (!item) fail('Выберите технику');
          if (item.status === 'repair') fail('Эта техника уже в ремонте');
          r.fleetId = item.id; r.status = 'accepted'; item.status = 'repair'; item.holder = '';
        }
        r.problem = txt(x.problem, 300); r.cost = num(x.cost); r.master = txt(x.master, 80); r.note = txt(x.note, 300);
      } else if (kind === 'stock') {
        if (!txt(x.name)) fail('Укажите название');
        r.name = txt(x.name); r.category = txt(x.category, 40); r.unit = txt(x.unit, 12) || 'шт'; r.qty = num(x.qty); r.min = num(x.min); r.note = txt(x.note, 300);
      } else if (kind === 'transfers') {
        if (!cur) {
          if (!item) fail('Выберите технику');
          if (item.status !== 'free') fail('Эта техника сейчас занята');
          if (!x.toId || !d.staff[x.toId]) fail('Выберите сотрудника');
          r.fleetId = item.id; r.toId = x.toId; r.status = 'out'; r.at = Number(x.at) || now;
          item.status = 'staff'; item.holder = x.toId;
        }
        r.note = txt(x.note, 300);
      } else if (kind === 'services') {
        if (!txt(x.title)) fail('Укажите услугу');
        if (!cur) r.status = 'planned';
        r.title = txt(x.title); r.fleetId = txt(x.fleetId, 20); r.executorId = txt(x.executorId, 20); r.price = num(x.price); r.date = Number(x.date) || now; r.note = txt(x.note, 300);
      }
      if (!cur) list.push(r);
      save(d);
      return JSON.parse(JSON.stringify(r));
    },
    // Действия: rentals/transfers — return; repairs — next (принят → в работе → готов → выдан); stock — add/sub (payload.n); services — done.
    opsAction: function (kind, id, action, payload) {
      need('ops.edit');
      var d = load(), ops = opsData(d), r = (ops[kind] || []).filter(function (q) { return q.id === id; })[0], now = Date.now();
      if (!r) fail('Запись не найдена');
      if ((kind === 'rentals' || kind === 'transfers') && action === 'return') {
        if (r.status !== 'active' && r.status !== 'out') fail('Уже возвращено');
        r.status = 'returned'; r.returnedAt = now; setFleet(ops, r.fleetId, 'free', '');
      } else if (kind === 'repairs' && action === 'next') {
        var i = REPAIR_FLOW.indexOf(r.status);
        if (i < 0 || i === REPAIR_FLOW.length - 1) fail('Ремонт уже закрыт');
        r.status = REPAIR_FLOW[i + 1];
        if (r.status === 'closed') { r.closedAt = now; setFleet(ops, r.fleetId, 'free', ''); }
      } else if (kind === 'stock' && (action === 'add' || action === 'sub')) {
        var n = Math.max(1, Math.round(Number(payload && payload.n) || 1));
        r.qty = Math.max(0, r.qty + (action === 'add' ? n : -n));
      } else if (kind === 'services' && action === 'done') {
        if (r.status === 'done') fail('Уже выполнено');
        r.status = 'done'; r.doneAt = now;
      } else fail('Неизвестное действие');
      save(d);
      return JSON.parse(JSON.stringify(r));
    },
    opsDelete: function (kind, id) {
      need('ops.edit');
      var d = load(), ops = opsData(d), r = (ops[kind] || []).filter(function (q) { return q.id === id; })[0];
      if (!r) return;
      if (kind === 'fleet' && (r.status === 'rented' || r.status === 'staff' || r.status === 'repair')) fail('Техника сейчас занята: сначала верните её или закройте ремонт');
      if (r.fleetId && ((kind === 'rentals' && r.status === 'active') || (kind === 'transfers' && r.status === 'out') || (kind === 'repairs' && r.status !== 'closed'))) setFleet(ops, r.fleetId, 'free', '');
      ops[kind] = ops[kind].filter(function (q) { return q.id !== id; });
      if (kind === 'fleet') ['rentals', 'repairs', 'transfers'].forEach(function (k) { ops[k] = ops[k].filter(function (q) { return q.fleetId !== id; }); });
      save(d);
    },

    /* ---------- демо-данные операций (только тестовый режим) ---------- */
    hasDemoOps: function () {
      var ops = opsData(load());
      return OPS_KINDS.some(function (k) { return ops[k].some(function (r) { return r.demo; }); });
    },
    seedDemoOps: function () {
      need('ops.edit');
      var d = load(), ops = opsData(d), now = Date.now();
      if (api.hasDemoOps()) return 0;
      var ago = function (days, hour) { var t = new Date(now - days * DAY); t.setHours(hour == null ? 11 : hour, 0, 0, 0); return t.getTime(); };
      var staff = Object.keys(d.staff).filter(function (k) { return d.staff[k].active; });
      var st = function (i) { return staff[i % staff.length]; };
      var mk = function (kind, o) { o.id = uid(OPS_PREFIX[kind], 6); o.createdAt = now; o.by = me().id; o.demo = true; ops[kind].push(o); return o; };
      var gear = [
        ['Sony A7 IV', 'Камера', 'SN-A7M4-0412'], ['Sony FX3', 'Камера', 'SN-FX3-1180'], ['DJI Mavic 3 Pro', 'Дрон', 'SN-M3P-2207'],
        ['DJI Mini 4 Pro', 'Дрон', 'SN-M4P-0931'], ['GoPro Hero 13 №1', 'Экшн-камера', 'SN-GP13-0101'], ['GoPro Hero 13 №2', 'Экшн-камера', 'SN-GP13-0102'],
        ['DJI Osmo Pocket 3', 'Экшн-камера', 'SN-OP3-0554'], ['DJI RS 4 Pro', 'Стабилизатор', 'SN-RS4-0720']
      ].map(function (g) { return mk('fleet', { name: g[0], category: g[1], serial: g[2], status: 'free', holder: '', note: '' }); });
      var F = function (i) { return gear[i]; };
      var users = Object.keys(clientsDb().users).map(function (k) { return clientsDb().users[k]; });
      var cn = function (i, fallback) { var u = users[i]; return u ? { clientId: u.id, clientName: u.name || u.phone } : { clientId: '', clientName: fallback }; };
      // аренды: две идут (одна просрочена), две закрыты
      var rent = function (i, who, startD, endD, price, status) {
        var o = mk('rentals', Object.assign({ fleetId: F(i).id, start: ago(startD), end: ago(endD), price: price, status: status, note: '' }, who));
        if (status === 'returned') o.returnedAt = o.end;
        else { F(i).status = 'rented'; F(i).holder = who.clientName; }
      };
      rent(4, cn(0, 'Алексей Смирнов'), 3, 1, 1200, 'active');
      rent(6, cn(1, 'Марина Ковалёва'), 1, -2, 900, 'active');
      rent(5, cn(2, 'Игорь Белов'), 14, 12, 800, 'returned');
      rent(3, cn(3, 'Ольга Назарова'), 25, 22, 2500, 'returned');
      // передачи сотрудникам
      var tr = function (i, to, daysAgo, status, note) {
        var o = mk('transfers', { fleetId: F(i).id, toId: st(to), at: ago(daysAgo), status: status, note: note });
        if (status === 'returned') o.returnedAt = ago(daysAgo - 1);
        else { F(i).status = 'staff'; F(i).holder = st(to); }
      };
      tr(0, 1, 2, 'out', 'Съёмка на трассе, утро');
      tr(2, 0, 1, 'out', 'Пролёты над склоном');
      tr(7, 2, 9, 'returned', 'Монтажёру для тестов стабилизации');
      // ремонты
      var rep = function (i, problem, status, cost, master, daysAgo) {
        var o = mk('repairs', { fleetId: F(i).id, problem: problem, status: status, cost: cost, master: master, note: '' });
        o.createdAt = ago(daysAgo);
        if (status === 'closed') o.closedAt = ago(daysAgo - 4);
        else { F(i).status = 'repair'; F(i).holder = ''; }
      };
      rep(1, 'Не включается после мороза', 'work', 6500, 'Сервис «Фокус»', 3);
      rep(7, 'Люфт мотора по оси Pan', 'accepted', 0, '', 1);
      rep(5, 'Треснуло защитное стекло', 'closed', 1200, 'Сервис «Фокус»', 16);
      // склад
      [['Карты SD 128 ГБ V60', 'Носители', 14, 5, 'шт'], ['Аккумуляторы NP-FZ100', 'Питание', 3, 4, 'шт'], ['ND-фильтры 67 мм', 'Оптика', 6, 2, 'шт'],
       ['Пропеллеры для Mavic 3', 'Дроны', 2, 4, 'пара'], ['Крепления на шлем', 'Аксессуары', 9, 3, 'шт'], ['Салфетки для оптики', 'Уход', 40, 10, 'шт']]
        .forEach(function (s) { mk('stock', { name: s[0], category: s[1], qty: s[2], min: s[3], unit: s[4], note: '' }); });
      // услуги мастера
      var sv = function (title, i, price, daysAgo, status, who) {
        var o = mk('services', { title: title, fleetId: i == null ? '' : F(i).id, executorId: st(who), price: price, date: ago(daysAgo), status: status, note: '' });
        if (status === 'done') o.doneAt = o.date;
      };
      sv('Чистка матрицы', 0, 1500, -2, 'planned', 2);
      sv('Калибровка стабилизатора', 7, 1800, 5, 'done', 2);
      sv('Замена защитных стёкол', 4, 900, 12, 'done', 1);
      sv('Обновление прошивок парка', null, 2000, -5, 'planned', 2);
      save(d);
      return gear.length;
    },
    clearDemoOps: function () {
      need('ops.edit');
      var d = load(), ops = opsData(d);
      OPS_KINDS.forEach(function (k) { ops[k] = ops[k].filter(function (r) { return !r.demo; }); });
      save(d);
    },

    fmtSize: function (b) {
      return b < 1024 ? b + ' Б' : b < 1048576 ? (b / 1024).toFixed(0) + ' КБ' : (b / 1048576).toFixed(1) + ' МБ';
    }
  };

  window.DSCRM = api;
})();
