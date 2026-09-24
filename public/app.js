const $ = selector => document.querySelector(selector);

let me = null;
let publicInfo = null;
let spinning = false;
let wheelRotation = 0;
let savedAccessKey = null;

const esc = value => String(value ?? '').replace(
  /[&<>"']/g,
  char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[char]
);

async function api(path, data) {
  const response = await fetch('/api/' + path, {
    method: data === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json' },
    body: data === undefined ? undefined : JSON.stringify(data)
  });

  const result = await response.json();

  if (!response.ok) {
    throw Error(result.error || 'Ошибка');
  }

  return result;
}

function message(text, success = false) {
  const element = $('#message');

  if (element) {
    element.textContent = text;
    element.className = success ? 'success' : 'error';
  }
}

function setSpinResult(text, success = false) {
  const element = $('#spinResult');
  if (!element) return;

  element.textContent = text;
  element.className = 'spin-result' + (success ? ' success' : '');
}

function statusLabel(status) {
  return ({
    issued: 'Код выдан',
    pending: 'Ожидает подтверждения',
    approved: 'Подтверждена',
    rejected: 'Отклонена'
  })[status] || status;
}

function choiceLabel(choice) {
  return ({
    red: 'Красное',
    black: 'Чёрное',
    even: 'Чёт',
    odd: 'Нечёт',
    zero: 'Зеро'
  })[choice] || choice;
}

function resultLabel(result) {
  return ({
    red: 'красное',
    black: 'чёрное',
    zero: 'зеро'
  })[result] || result;
}

function safeLink(url) {
  try {
    const parsed = new URL(url);

    if (!['https:', 'http:'].includes(parsed.protocol)) {
      return '#';
    }

    return esc(parsed.href);
  } catch {
    return '#';
  }
}

function renderCashiers() {
  const cashiers = Array.isArray(publicInfo.cashiers)
    ? publicInfo.cashiers
    : [];

  const list = cashiers.length
    ? cashiers
    : [{
        name: 'Связаться с организатором',
        url: publicInfo.contact
      }];

  $('#cashierList').innerHTML = list.map(cashier => `
    <div class="item">
      <a
        class="goldlink"
        href="${safeLink(cashier.url)}"
        target="_blank"
        rel="noopener noreferrer"
      >${esc(cashier.name)} ↗</a>
    </div>
  `).join('');
}

async function refresh() {
  try {
    publicInfo = await api('public');
    renderCashiers();

    try {
      me = await api('me');
    } catch {
      me = null;
    }

    render();

    const ranking = await api('leaderboard');

    $('#leaders').innerHTML = ranking.leaders.length
      ? ranking.leaders.map((player, index) => `
          <div class="item row">
            <span>${index + 1}. ID ${esc(player.id)}</span>
            <b>${Number(player.chips).toLocaleString('ru-RU')} фишек</b>
          </div>
        `).join('')
      : 'Рейтинг появится после первых подтверждений.';
  } catch (error) {
    $('#deskContent').textContent = error.message;
  }
}

function requestCard(request) {
  const code = request.code
    ? `
      <div class="request-code">
        Код: <b class="code">${esc(request.code)}</b>
        <button
          type="button"
          class="secondary copy-code"
          data-code="${esc(request.code)}"
        >Копировать</button>
      </div>
    `
    : '<small>Код старой заявки не сохранён для отображения.</small>';

  return `
    <div class="item">
      ${code}
      <p>${esc(statusLabel(request.status))}</p>
      ${request.chips_awarded
        ? `<small>Начислено: +${Number(request.chips_awarded).toLocaleString('ru-RU')} фишек</small>`
        : ''}
    </div>
  `;
}

function seriesCard(series) {
  const available = series.status !== 'closed' && series.spins < 2;

  return `
    <div class="item game-series">
      <p>
        <b>Серия: ${series.spins}/2 вращений</b>
        · ${available ? 'Доступна' : 'Завершена'}
      </p>

      ${available ? `
        <form class="spin-form" data-series-id="${esc(series.id)}">
          <label>Сколько фишек поставить?</label>
          <input
            name="stake"
            type="number"
            min="1"
            max="${Math.max(1, Number(me.chips))}"
            step="1"
            inputmode="numeric"
            placeholder="Введи свою сумму"
            required
          >

          <label>Куда поставить?</label>
          <div class="bet-options">
            <label>
              <input type="radio" name="choice" value="red" required>
              Красное ×2
            </label>
            <label>
              <input type="radio" name="choice" value="black">
              Чёрное ×2
            </label>
            <label>
              <input type="radio" name="choice" value="even">
              Чёт ×2
            </label>
            <label>
              <input type="radio" name="choice" value="odd">
              Нечёт ×2
            </label>
            <label>
              <input type="radio" name="choice" value="zero">
              Зеро ×3
            </label>
          </div>

          <button type="submit" class="spin-submit">
            Крутить рулетку
          </button>
        </form>

        ${series.status === 'won' ? `
          <button
            type="button"
            class="secondary collect"
            data-id="${esc(series.id)}"
          >Завершить серию</button>
        ` : ''}
      ` : ''}
    </div>
  `;
}

function render() {
  let html = '';

  if (!me) {
    html = `
      <h2>Начни со своего ID</h2>
      <p>Он нужен для начисления фишек и сохранения результата.</p>

      <form id="register">
        <label>Игровой ID</label>
        <input
          name="id"
          pattern="[0-9]{5,20}"
          required
          placeholder="Например, 12345678"
        >
        <button type="submit">Продолжить →</button>
      </form>

      <p>
        Уже есть аккаунт?
        <a href="#" id="showLogin">Войти по ключу</a>
      </p>

      <div id="loginArea"></div>
    `;
  } else {
    html = `
      <div class="eyebrow">ТВОИ ФИШКИ</div>

      <h1 class="balance">
        ${Number(me.chips).toLocaleString('ru-RU')} ⊙
      </h1>

      <p>ID ${esc(me.id)}</p>

      <hr>

      <h2>Получи фишки</h2>

      <p>
        Создай заявку и скопируй пятисимвольный код.
        Передай кассиру свой ID и код, затем пополни счёт.
        После пополнения вернись сюда и активируй код.
        Фишки появятся после подтверждения администратором.
      </p>

      <button
        type="button"
        id="newRequest"
        ${!publicInfo.contest_open ? 'disabled' : ''}
      >Получить новый код</button>

      <form id="activate">
        <label>Код после пополнения</label>
        <input
          name="code"
          maxlength="12"
          autocomplete="off"
          required
          placeholder="Введи код заявки"
        >
        <button type="submit">Отправить на подтверждение</button>
      </form>

      <h3>Мои заявки</h3>

      ${me.requests.map(requestCard).join('') ||
        '<p>Заявок пока нет.</p>'}

      <h3>Рулетка</h3>

      <p>
        Доступно:
        <b>${Number(me.chips).toLocaleString('ru-RU')} фишек</b>.
        Перед каждым вращением сам введи сумму ставки
        и выбери исход.
      </p>

      ${me.series.map(seriesCard).join('') ||
        '<p>Серии появятся после подтверждения заявки.</p>'}

      <button type="button" class="secondary" id="logout">
        Выйти
      </button>
    `;
  }

  $('#deskContent').innerHTML =
    html + '<p id="message" role="status"></p>';

  bind();
}

function animateWheel(number) {
  const wheel = $('#wheel');

  if (!wheel) {
    return Promise.resolve();
  }

  const duration = 4200;
  const sectorAngle = 360 / 37;

  // Сектора колеса в европейском порядке, начиная с зеро.
  const wheelNumbers = [
    0, 32, 15, 19, 4, 21, 2, 25, 17, 34,
    6, 27, 13, 36, 11, 30, 8, 23, 10, 5,
    24, 16, 33, 1, 20, 14, 31, 9, 22, 18,
    29, 7, 28, 12, 35, 3, 26
  ];

  const index = wheelNumbers.indexOf(number);
  const targetAngle = (360 - index * sectorAngle) % 360;
  const currentAngle = ((wheelRotation % 360) + 360) % 360;
  const adjustment = (targetAngle - currentAngle + 360) % 360;

  wheelRotation += 360 * 6 + adjustment;

  wheel.style.transition =
    `transform ${duration}ms cubic-bezier(.12,.7,.12,1)`;
  wheel.style.transform = `rotate(${wheelRotation}deg)`;

  return new Promise(resolve => {
    window.setTimeout(resolve, duration + 100);
  });
}

async function copyCode(code) {
  try {
    await navigator.clipboard.writeText(code);
    message('Код скопирован', true);
  } catch {
    message('Не удалось скопировать автоматически. Выдели код и скопируй его.');
  }
}

function bind() {
  const register = $('#register');

  if (register) {
    register.onsubmit = async event => {
      event.preventDefault();

      try {
        const result = await api('register', {
          id: new FormData(register).get('id')
        });

        savedAccessKey = result.access_key;

        alert(
          'ВАЖНО! Сохрани ключ доступа для входа с другого устройства:\n' +
          savedAccessKey
        );

        await refresh();
      } catch (error) {
        message(error.message);
      }
    };
  }

  const showLogin = $('#showLogin');

  if (showLogin) {
    showLogin.onclick = event => {
      event.preventDefault();

      $('#loginArea').innerHTML = `
        <form id="login">
          <label>Игровой ID</label>
          <input name="id" required>

          <label>Ключ доступа</label>
          <input name="access_key" required>

          <button type="submit">Войти</button>
        </form>
      `;

      $('#login').onsubmit = async loginEvent => {
        loginEvent.preventDefault();

        try {
          await api(
            'login',
            Object.fromEntries(new FormData(loginEvent.target))
          );

          await refresh();
        } catch (error) {
          message(error.message);
        }
      };
    };
  }

  const newRequest = $('#newRequest');

  if (newRequest) {
    newRequest.onclick = async () => {
      newRequest.disabled = true;

      try {
        const result = await api('request', {});
        await refresh();

        message(
          `Код ${result.code} создан. Скопируй его в разделе «Мои заявки».`,
          true
        );
      } catch (error) {
        message(error.message);
        newRequest.disabled = false;
      }
    };
  }

  const activate = $('#activate');

  if (activate) {
    activate.onsubmit = async event => {
      event.preventDefault();

      try {
        const code = new FormData(activate)
          .get('code')
          .toString()
          .trim()
          .toUpperCase();

        await api('activate', { code });
        await refresh();

        message('Заявка отправлена на подтверждение', true);
      } catch (error) {
        message(error.message);
      }
    };
  }

  document.querySelectorAll('.copy-code').forEach(button => {
    button.onclick = () => copyCode(button.dataset.code);
  });

  document.querySelectorAll('.spin-form').forEach(form => {
    form.onsubmit = async event => {
      event.preventDefault();

      if (spinning) return;

      const data = new FormData(form);
      const stake = Number(data.get('stake'));
      const choice = String(data.get('choice') || '');

      if (!Number.isSafeInteger(stake) || stake < 1) {
        message('Введи целое количество фишек от 1');
        return;
      }

      if (stake > Number(me.chips)) {
        message('Недостаточно фишек для этой ставки');
        return;
      }

      if (!choice) {
        message('Выбери, куда поставить');
        return;
      }

      spinning = true;

      document.querySelectorAll('.spin-submit').forEach(button => {
        button.disabled = true;
      });

      setSpinResult('Рулетка вращается…');

      try {
        const result = await api('spin', {
          series_id: form.dataset.seriesId,
          stake,
          choice
        });

        await animateWheel(result.number);

        const text = result.won > 0
          ? `Выпало ${result.number} (${resultLabel(result.result)}). ` +
            `Ставка: ${stake}. Выигрыш: ${result.won} фишек. ` +
            `Баланс: ${result.chips}.`
          : `Выпало ${result.number} (${resultLabel(result.result)}). ` +
            `Ставка: ${stake}. Проигрыш: ${stake} фишек. ` +
            `Баланс: ${result.chips}.`;

        await refresh();
        setSpinResult(text, result.won > 0);
        message(text, result.won > 0);
      } catch (error) {
        setSpinResult('');
        message(error.message);
      } finally {
        spinning = false;

        document.querySelectorAll('.spin-submit').forEach(button => {
          button.disabled = false;
        });
      }
    };
  });

  document.querySelectorAll('.collect').forEach(button => {
    button.onclick = async () => {
      try {
        await api('collect', {
          series_id: button.dataset.id
        });

        await refresh();
        message('Серия завершена', true);
      } catch (error) {
        message(error.message);
      }
    };
  });

  const logout = $('#logout');

  if (logout) {
    logout.onclick = async () => {
      try {
        await api('logout', {});
        savedAccessKey = null;
        await refresh();
      } catch (error) {
        message(error.message);
      }
    };
  }
}

refresh();
