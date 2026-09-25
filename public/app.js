const $ = selector => document.querySelector(selector);

let me = null;
let publicInfo = null;
let spinning = false;
let wheelRotation = 0;

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
    headers: {
      'content-type': 'application/json'
    },
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

  if (!element) return;

  element.textContent = text;
  element.className = success ? 'success' : 'error';
}

function setSpinResult(text, success = false) {
  const element = $('#spinResult');

  if (!element) return;

  element.textContent = text;
  element.className = 'spin-result' + (success ? ' success' : '');
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

function currentRequest() {
  if (!me?.requests?.length) return null;

  return me.requests.find(request =>
    request.status === 'pending' ||
    request.status === 'issued'
  ) || null;
}

function activeSeries() {
  if (!me?.series?.length) return null;

  return me.series.find(series =>
    series.status !== 'closed' &&
    Number(series.spins) < 2
  ) || null;
}

function renderCashiers() {
  const cashiers = Array.isArray(publicInfo?.cashiers)
    ? publicInfo.cashiers
    : [];

  const list = cashiers.length
    ? cashiers
    : [{
        name: 'Связаться с организатором',
        url: publicInfo?.contact
      }];

  $('#cashierList').innerHTML = list.map(cashier => `
    <div class="item">
      <a
        class="goldlink"
        href="${safeLink(cashier.url)}"
        target="_blank"
        rel="noopener noreferrer"
      >
        ${esc(cashier.name)} ↗
      </a>
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

function renderRequestStage(request) {
  if (!request) {
    return `
      <div class="compact-stage">
        <h2>Получи фишки</h2>

        <p>
          Создай код заявки, передай его кассиру вместе
          с игровым ID и пополни счёт.
        </p>

        <button
          type="button"
          id="newRequest"
          ${!publicInfo.contest_open ? 'disabled' : ''}
        >
          Получить новый код
        </button>
      </div>
    `;
  }

  if (request.status === 'issued') {
    return `
      <div class="compact-stage">
        <div class="eyebrow">КОД ЗАЯВКИ</div>

        <div class="request-code">
          <b class="code">${esc(request.code)}</b>

          <button
            type="button"
            class="secondary"
            id="copyCurrentCode"
            data-code="${esc(request.code)}"
          >
            Копировать
          </button>
        </div>

        <p>
          Передай кассиру ID <b>${esc(me.id)}</b>
          и этот код. После пополнения активируй его здесь.
        </p>

        <form id="activate">
          <label>Код заявки</label>

          <input
            name="code"
            maxlength="12"
            autocomplete="off"
            value="${esc(request.code || '')}"
            required
          >

          <button type="submit">
            Активировать
          </button>
        </form>
      </div>
    `;
  }

  if (request.status === 'pending') {
    return `
      <div class="compact-stage pending-stage">
        <div class="eyebrow">ЗАЯВКА ОТПРАВЛЕНА</div>

        <h2>Ожидает подтверждения</h2>

        <p>
          Код <b class="code">${esc(request.code)}</b>
        </p>

        <p>
          После подтверждения фишки автоматически
          появятся на балансе.
        </p>
      </div>
    `;
  }

  return '';
}

function renderGame(series) {
  if (!series) return '';

  const balance = Number(me.chips);
  const spins = Number(series.spins);

  return `
    <div class="game-area">
      <div class="eyebrow">РУЛЕТКА</div>

      <h2>Сделай ставку</h2>

      <div class="game-info">
        <span>
          Баланс:
          <b>${balance.toLocaleString('ru-RU')} ⊙</b>
        </span>

        <span>
          Вращение:
          <b>${spins + 1}/2</b>
        </span>
      </div>

      <form
        class="spin-form"
        data-series-id="${esc(series.id)}"
      >
        <label>Количество фишек</label>

        <input
          name="stake"
          type="number"
          min="1"
          max="${Math.max(1, balance)}"
          step="1"
          inputmode="numeric"
          placeholder="Например, 20"
          required
        >

        <div class="bet-options">
          <label>
            <input
              type="radio"
              name="choice"
              value="red"
              required
            >
            Красное ×2
          </label>

          <label>
            <input
              type="radio"
              name="choice"
              value="black"
            >
            Чёрное ×2
          </label>

          <label>
            <input
              type="radio"
              name="choice"
              value="even"
            >
            Чёт ×2
          </label>

          <label>
            <input
              type="radio"
              name="choice"
              value="odd"
            >
            Нечёт ×2
          </label>

          <label>
            <input
              type="radio"
              name="choice"
              value="zero"
            >
            Зеро ×3
          </label>
        </div>

        <button
          type="submit"
          class="spin-submit"
        >
          Крутить рулетку
        </button>
      </form>
    </div>
  `;
}

function render() {
  if (!me) {
    $('#deskContent').innerHTML = `
      <h2>Начни со своего ID</h2>

      <p>
        Он нужен для начисления фишек
        и сохранения результата.
      </p>

      <form id="register">
        <label>Игровой ID</label>

        <input
          name="id"
          pattern="[0-9]{5,20}"
          required
          placeholder="Например, 12345678"
        >

        <button type="submit">
          Продолжить →
        </button>
      </form>

      <p>
        Уже есть аккаунт?
        <a href="#" id="showLogin">
          Войти по ключу
        </a>
      </p>

      <div id="loginArea"></div>

      <p id="message" role="status"></p>
    `;

    bind();
    return;
  }

  const request = currentRequest();
  const series = activeSeries();

  let content = `
    <div class="player-head">
      <div>
        <div class="eyebrow">ТВОИ ФИШКИ</div>

        <h1 class="balance">
          ${Number(me.chips).toLocaleString('ru-RU')} ⊙
        </h1>

        <small>ID ${esc(me.id)}</small>
      </div>

      <button
        type="button"
        class="secondary"
        id="logout"
      >
        Выйти
      </button>
    </div>
  `;

  /*
    Если есть активная серия — сразу показываем игру.
    История заявок и завершённых серий не выводится.
  */
  if (series) {
    content += renderGame(series);
  } else {
    /*
      Если активной игры нет, показываем только
      актуальный этап получения фишек.
    */
    content += renderRequestStage(request);

    /*
      Если заявок в ожидании нет и активной серии нет,
      пользователь может получить новый код.
    */
    if (!request && Number(me.chips) > 0) {
      content += `
        <div class="compact-note">
          <small>
            Текущий баланс сохраняется в рейтинге.
            Новая заявка позволит получить дополнительные фишки.
          </small>
        </div>
      `;
    }
  }

  content += '<p id="message" role="status"></p>';

  $('#deskContent').innerHTML = content;

  bind();
}

function animateWheel(number) {
  const wheel = $('#wheel');

  if (!wheel) {
    return Promise.resolve();
  }

  const duration = 4200;
  const sectorAngle = 360 / 37;

  const wheelNumbers = [
    0, 32, 15, 19, 4, 21, 2, 25, 17, 34,
    6, 27, 13, 36, 11, 30, 8, 23, 10, 5,
    24, 16, 33, 1, 20, 14, 31, 9, 22, 18,
    29, 7, 28, 12, 35, 3, 26
  ];

  const index = wheelNumbers.indexOf(number);

  const targetAngle =
    (360 - index * sectorAngle) % 360;

  const currentAngle =
    ((wheelRotation % 360) + 360) % 360;

  const adjustment =
    (targetAngle - currentAngle + 360) % 360;

  wheelRotation +=
    360 * 6 + adjustment;

  wheel.style.transition =
    `transform ${duration}ms cubic-bezier(.12,.7,.12,1)`;

  wheel.style.transform =
    `rotate(${wheelRotation}deg)`;

  return new Promise(resolve => {
    window.setTimeout(resolve, duration + 100);
  });
}

async function copyCode(code) {
  try {
    await navigator.clipboard.writeText(code);
    message('Код скопирован', true);
  } catch {
    message(
      'Не удалось скопировать автоматически.'
    );
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

        alert(
          'ВАЖНО! Сохрани ключ доступа для входа с другого устройства:\n' +
          result.access_key
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

          <input
            name="id"
            required
          >

          <label>Ключ доступа</label>

          <input
            name="access_key"
            required
          >

          <button type="submit">
            Войти
          </button>
        </form>
      `;

      $('#login').onsubmit = async event => {
        event.preventDefault();

        try {
          await api(
            'login',
            Object.fromEntries(
              new FormData(event.target)
            )
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
        await api('request', {});
        await refresh();

        message(
          'Код создан. Передай его кассиру.',
          true
        );
      } catch (error) {
        message(error.message);
        newRequest.disabled = false;
      }
    };
  }

  const copy = $('#copyCurrentCode');

  if (copy) {
    copy.onclick = () =>
      copyCode(copy.dataset.code);
  }

  const activate = $('#activate');

  if (activate) {
    activate.onsubmit = async event => {
      event.preventDefault();

      try {
        const code = String(
          new FormData(activate).get('code') || ''
        ).trim().toUpperCase();

        await api('activate', { code });

        await refresh();

        message(
          'Заявка отправлена на подтверждение',
          true
        );
      } catch (error) {
        message(error.message);
      }
    };
  }

  const spinForm = $('.spin-form');

  if (spinForm) {
    spinForm.onsubmit = async event => {
      event.preventDefault();

      if (spinning) return;

      const data = new FormData(spinForm);

      const stake =
        Number(data.get('stake'));

      const choice =
        String(data.get('choice') || '');

      if (
        !Number.isSafeInteger(stake) ||
        stake < 1
      ) {
        message(
          'Введи целое количество фишек от 1'
        );
        return;
      }

      if (stake > Number(me.chips)) {
        message(
          'Недостаточно фишек для этой ставки'
        );
        return;
      }

      if (!choice) {
        message('Выбери исход ставки');
        return;
      }

      spinning = true;

      const button =
        spinForm.querySelector('.spin-submit');

      button.disabled = true;

      setSpinResult('Рулетка вращается…');

      try {
        const result = await api('spin', {
          series_id: spinForm.dataset.seriesId,
          stake,
          choice
        });

        await animateWheel(result.number);

        const won = Number(result.won);
        const balance = Number(result.chips);

        const text = won > 0
          ? `Выпало ${result.number} (${resultLabel(result.result)}). ` +
            `Ставка ${stake}. Выигрыш ${won} фишек. ` +
            `Баланс ${balance}.`
          : `Выпало ${result.number} (${resultLabel(result.result)}). ` +
            `Ставка ${stake}. Проигрыш ${stake} фишек. ` +
            `Баланс ${balance}.`;

        await refresh();

        setSpinResult(text, won > 0);
        message(text, won > 0);
      } catch (error) {
        setSpinResult('');
        message(error.message);
      } finally {
        spinning = false;

        const currentButton =
          $('.spin-submit');

        if (currentButton) {
          currentButton.disabled = false;
        }
      }
    };
  }

  const logout = $('#logout');

  if (logout) {
    logout.onclick = async () => {
      try {
        await api('logout', {});
        await refresh();
        setSpinResult('');
      } catch (error) {
        message(error.message);
      }
    };
  }
}

refresh();
