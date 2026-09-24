const $ = selector => document.querySelector(selector);

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

let key = '';

async function api(path, data) {
  const response = await fetch('/api/admin/' + path, {
    method: data === undefined ? 'GET' : 'POST',
    headers: {
      'content-type': 'application/json',
      'x-admin-key': key
    },
    body: data === undefined ? undefined : JSON.stringify(data)
  });

  const result = await response.json();

  if (!response.ok) {
    throw Error(result.error || 'Ошибка сервера');
  }

  return result;
}

function msg(text) {
  $('#msg').textContent = text;
}

function chipsFor(amount) {
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    return null;
  }

  if (amount > 10000) {
    return Math.floor(amount / 100);
  }

  return (
    15 +
    Math.floor(Math.max(0, Math.min(amount, 5000) - 1000) / 200) +
    3 * Math.floor(Math.max(0, amount - 5000) / 200)
  );
}

function requestStatus(status) {
  return ({
    issued: 'Код выдан',
    pending: 'Ожидает подтверждения',
    approved: 'Подтверждена',
    rejected: 'Отклонена'
  })[status] || status;
}

function renderRequest(request) {
  const code = request.code
    ? `<b class="code">${esc(request.code)}</b>`
    : '<small>Старая заявка: код не сохранён</small>';

  return `
    <div class="item">
      <div>
        <b>ID ${esc(request.player_id)}</b>
        · ${code}
      </div>

      <p>${esc(requestStatus(request.status))}</p>

      <small>
        ${esc(request.created_at)}
        ${request.amount
          ? ` · ${esc(request.amount)} ₽`
          : ''}
        ${request.chips_awarded
          ? ` · ${esc(request.chips_awarded)} фишек`
          : ''}
      </small>

      ${request.status === 'pending' ? `
        <form class="decide" data-id="${esc(request.id)}">
          <label>Фактически подтверждённая сумма, ₽</label>

          <input
            name="amount"
            type="number"
            min="1"
            step="1"
            required
            placeholder="Введите сумму пополнения"
          >

          <p class="chips-preview">
            Фишки: введите сумму для расчёта
          </p>

          <div class="actions">
            <button
              type="submit"
              name="decision"
              value="approved"
            >Подтвердить и начислить</button>

            <button
              type="submit"
              class="secondary"
              name="decision"
              value="rejected"
              formnovalidate
            >Отклонить</button>
          </div>
        </form>
      ` : ''}
    </div>
  `;
}

async function load() {
  try {
    const data = await api('overview');

    $('#content').hidden = false;

    const labels = {
      contact: 'Контакт Telegram',
      cashiers: 'Кассиры (JSON-массив объектов name,url)',
      prizes: 'Призы (JSON-массив)',
      start_at: 'Начало (ISO дата/время)',
      end_at: 'Окончание (ISO дата/время)',
      contest_open: 'Конкурс открыт (true/false)',
      final_open: 'Финал открыт (true/false)',
      over_10000: 'Примечание для сумм свыше 10 000 ₽'
    };

    $('#settings').innerHTML = Object.entries(labels)
      .map(([settingKey, label]) => `
        <form class="setting item" data-key="${settingKey}">
          <label>${label}</label>

          <textarea name="value" rows="2">${esc(
            data.settings[settingKey]
          )}</textarea>

          <button type="submit">Сохранить</button>
        </form>
      `).join('');

    document.querySelectorAll('.setting').forEach(form => {
      form.addEventListener('submit', async event => {
        event.preventDefault();

        const button = form.querySelector('button[type="submit"]');
        const field = form.querySelector('textarea[name="value"]');

        button.disabled = true;

        try {
          await api('settings', {
            key: form.dataset.key,
            value: field.value
          });

          msg('Настройка сохранена');
        } catch (error) {
          msg(error.message);
        } finally {
          button.disabled = false;
        }
      });
    });

    $('#requests').innerHTML =
      data.requests.map(renderRequest).join('') || 'Заявок нет';

    document.querySelectorAll('.decide').forEach(form => {
      const amountField = form.querySelector('input[name="amount"]');
      const preview = form.querySelector('.chips-preview');

      amountField.addEventListener('input', () => {
        const amount = Number(amountField.value);
        const chips = chipsFor(amount);

        preview.textContent = chips === null
          ? 'Фишки: введите корректную сумму'
          : `Будет начислено: ${chips.toLocaleString('ru-RU')} фишек`;
      });

      form.addEventListener('submit', async event => {
        event.preventDefault();

        const decision = event.submitter?.value;

        if (!['approved', 'rejected'].includes(decision)) {
          msg('Не удалось определить действие');
          return;
        }

        const amount = Number(amountField.value);

        if (decision === 'approved' && chipsFor(amount) === null) {
          msg('Введите корректную сумму пополнения');
          return;
        }

        if (!confirm(
          decision === 'approved'
            ? `Подтвердить пополнение ${amount} ₽ и начислить ${chipsFor(amount)} фишек?`
            : 'Отклонить заявку?'
        )) {
          return;
        }

        const buttons = form.querySelectorAll('button');
        buttons.forEach(button => {
          button.disabled = true;
        });

        try {
          await api('decide', {
            request_id: form.dataset.id,
            decision,
            ...(decision === 'approved' ? { amount } : {})
          });

          await load();

          msg(
            decision === 'approved'
              ? 'Заявка подтверждена, фишки начислены'
              : 'Заявка отклонена'
          );
        } catch (error) {
          msg(error.message);

          buttons.forEach(button => {
            button.disabled = false;
          });
        }
      });
    });

    $('#players').innerHTML =
      data.players.map(player => `
        <div class="item row">
          <span>ID ${esc(player.id)}</span>
          <b>${Number(player.chips).toLocaleString('ru-RU')} фишек</b>
        </div>
      `).join('') || 'Участников нет';

    $('#audit').innerHTML =
      data.audit.map(entry => `
        <div class="item">
          ${esc(entry.created_at)}
          · ${esc(entry.action)}
          · ${esc(entry.subject)}
        </div>
      `).join('') || 'История пуста';

    msg('');
  } catch (error) {
    msg(error.message);
  }
}

$('#enter').addEventListener('click', () => {
  key = $('#key').value;
  $('#key').value = '';
  load();
});
