/* DOWNSHOT — вход клиентов по номеру телефона.
 *
 * Сейчас работает ТЕСТОВЫЙ РЕЖИМ: SMS не отправляется, войти можно только
 * по тестовому номеру с тестовым кодом, а аккаунты хранятся в localStorage
 * этого браузера. Это не защита, а макет сценария для проверки интерфейса.
 *
 * Для боевого режима заменить `provider` на реальный сервис (Firebase Phone
 * Auth, SMS-шлюз + свой сервер и т.п.): requestCode/verifyCode должны идти
 * на сервер, а ID пользователя выдавать сервер, а не браузер.
 */
(function () {
  var MODE = 'test';
  var TEST_PHONE = '+79189181188';
  var TEST_CODE = '123456';
  var STORE_KEY = 'downshot_auth_v1';

  /* ---------- хранилище (в приватном режиме localStorage может бросать исключения) ---------- */
  function load() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      var data = raw ? JSON.parse(raw) : null;
      if (data && data.users) return data;
    } catch (e) {}
    return { users: {}, session: null };
  }
  function save(data) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(data)); return true; }
    catch (e) { return false; }
  }

  /* ---------- телефон ---------- */
  // Приводит ввод к виду +7XXXXXXXXXX; null, если это не российский мобильный/городской номер.
  function normalizePhone(input) {
    var d = String(input || '').replace(/\D/g, '');
    if (d.length === 11 && (d[0] === '8' || d[0] === '7')) d = '7' + d.slice(1);
    else if (d.length === 10) d = '7' + d;
    else return null;
    return '+' + d;
  }
  // Маска для поля ввода: «+7 (918) 918-11-88», работает и на неполном номере.
  function formatPhone(input) {
    var d = String(input || '').replace(/\D/g, '');
    if (!d) return '';
    if (d[0] === '8') d = '7' + d.slice(1);
    else if (d[0] !== '7') d = '7' + d;
    d = d.slice(0, 11);
    var out = '+7';
    if (d.length > 1) out += ' (' + d.slice(1, 4);
    if (d.length >= 4) out += ')';
    if (d.length > 4) out += ' ' + d.slice(4, 7);
    if (d.length > 7) out += '-' + d.slice(7, 9);
    if (d.length > 9) out += '-' + d.slice(9, 11);
    return out;
  }

  /* ---------- ID клиента: DS-XXXXXX (без похожих символов 0/O, 1/I) ---------- */
  function generateId(existing) {
    var abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    var id;
    do {
      var bytes = new Uint8Array(6);
      (window.crypto || window.msCrypto).getRandomValues(bytes);
      id = 'DS-';
      for (var i = 0; i < 6; i++) id += abc[bytes[i] % abc.length];
    } while (existing[id]);
    return id;
  }

  /* ---------- провайдер проверки номера (тестовый) ---------- */
  var provider = {
    requestCode: function (phone) {
      return delay(500).then(function () {
        if (phone !== TEST_PHONE) {
          throw new Error('В тестовом режиме вход доступен только по номеру ' + formatPhone(TEST_PHONE));
        }
        return { sent: true };
      });
    },
    verifyCode: function (phone, code) {
      return delay(400).then(function () {
        if (phone !== TEST_PHONE || String(code).trim() !== TEST_CODE) {
          throw new Error('Неверный код');
        }
        return { verified: true };
      });
    }
  };
  function delay(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  // Номер, подтверждённый кодом, но ещё не завершивший регистрацию (живёт только в памяти страницы).
  var verifiedPhone = null;

  function findUserByPhone(data, phone) {
    for (var id in data.users) if (data.users[id].phone === phone) return data.users[id];
    return null;
  }

  var api = {
    MODE: MODE,
    TEST_PHONE: TEST_PHONE,
    TEST_CODE: TEST_CODE,
    normalizePhone: normalizePhone,
    formatPhone: formatPhone,

    requestCode: function (phone) { return provider.requestCode(phone); },

    // Подтверждает код. Если пользователь уже есть — сразу входит; иначе нужна регистрация.
    verifyCode: function (phone, code) {
      return provider.verifyCode(phone, code).then(function () {
        var data = load();
        var user = findUserByPhone(data, phone);
        if (user) {
          data.session = { id: user.id, at: Date.now() };
          save(data);
          return { user: user, needsRegistration: false };
        }
        verifiedPhone = phone;
        return { user: null, needsRegistration: true };
      });
    },

    register: function (phone, name) {
      if (verifiedPhone !== phone) return Promise.reject(new Error('Сначала подтвердите номер кодом'));
      var data = load();
      var user = findUserByPhone(data, phone);
      if (!user) {
        user = { id: generateId(data.users), phone: phone, name: String(name || '').trim(), createdAt: Date.now(), requests: [] };
        data.users[user.id] = user;
      }
      data.session = { id: user.id, at: Date.now() };
      verifiedPhone = null;
      if (!save(data)) return Promise.reject(new Error('Браузер не даёт сохранить данные (приватный режим?)'));
      return Promise.resolve(user);
    },

    currentUser: function () {
      var data = load();
      return data.session && data.users[data.session.id] || null;
    },

    updateUser: function (patch) {
      var data = load();
      var user = data.session && data.users[data.session.id];
      if (!user) return null;
      if (typeof patch.name === 'string') user.name = patch.name.trim().slice(0, 60);
      if (typeof patch.email === 'string') {
        var email = patch.email.trim().slice(0, 120);
        if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw new Error('Проверьте адрес e-mail');
        user.email = email;
      }
      if (!save(data)) throw new Error('Браузер не даёт сохранить данные (приватный режим?)');
      return user;
    },

    addRequest: function (req) {
      var data = load();
      var user = data.session && data.users[data.session.id];
      if (!user) return;
      user.requests = user.requests || [];
      user.requests.unshift({ at: Date.now(), message: String(req.message || '').slice(0, 1000), email: req.email || '' });
      user.requests = user.requests.slice(0, 50);
      save(data);
    },

    logout: function () {
      var data = load();
      data.session = null;
      save(data);
    },

    // Для CRM (assets/crm-data.js): прямой доступ к базе клиентов и генератору ID.
    _store: { load: load, save: save },
    _generateId: generateId
  };

  window.DSAuth = api;
})();
