
const $ = (selector) => document.querySelector(selector);

const esc = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[char]);

let key = "";

async function api(path, data) {
  const response = await fetch("/api/admin/" + path, {
    method: data === undefined ? "GET" : "POST",
    headers: {
      "content-type": "application/json",
      "x-admin-key": key,
    },
    body: data === undefined ? undefined : JSON.stringify(data),
  });

  const result = await response.json();

  if (!response.ok) {
    throw new Error(result.error || "Ошибка сервера");
  }

  return result;
}

function msg(message) {
  $("#msg").textContent = message;
}

async function load() {
  try {
    const data = await api("overview");

    $("#content").hidden = false;

    const labels = {
      contact: "Контакт Telegram",
      cashiers: "Кассиры (JSON-массив объектов name,url)",
      prizes: "Призы (JSON-массив)",
      start_at: "Начало (ISO дата/время)",
      end_at: "Окончание (ISO дата/время)",
      contest_open: "Конкурс открыт (true/false)",
      final_open: "Финал открыт (true/false)",
      over_10000: "Свыше 10 000 ₽ (manual)",
    };

    // Настройки конкурса
    $("#settings").innerHTML = Object.entries(labels)
      .map(
        ([settingKey, label]) => `
          <form class="setting item" data-key="${settingKey}">
            <label>${label}</label>
            <textarea name="value" rows="2">${esc(data.settings[settingKey])}</textarea>
            <button type="submit">Сохранить</button>
          </form>
        `
      )
      .join("");

    document.querySelectorAll(".setting").forEach((form) => {
      form.addEventListener("submit", async (event) => {
        event.preventDefault();

        const button = form.querySelector('button[type="submit"]');
        const field = form.querySelector('textarea[name="value"]');

        button.disabled = true;

        try {
          await api("settings", {
            key: form.dataset.key,
            value: field.value,
          });

          msg("Настройка сохранена");
        } catch (error) {
          msg(error.message);
        } finally {
          button.disabled = false;
        }
      });
    });

    // Заявки участников
    $("#requests").innerHTML =
      data.requests
        .map(
          (request) => `
            <div class="item">
              <b>ID ${esc(request.player_id)}</b>
              · ${esc(request.status)}
              · ${esc(request.id)}
              <br>

              <small>
                ${esc(request.created_at)}
                ${
                  request.amount
                    ? " · " + esc(request.amount) + " ₽"
                    : ""
                }
                ${
                  request.chips_awarded
                    ? " · " + esc(request.chips_awarded) + " фишек"
                    : ""
                }
              </small>

              ${
                request.status === "pending"
                  ? `
                    <form class="decide" data-id="${esc(request.id)}">
                      <label>
                        Фактически подтверждённая сумма, ₽
                      </label>

                      <input
                        name="amount"
                        type="number"
                        min="1"
                        step="1"
                        required
                      >

                      <label>
                        Фишки вручную (только свыше 10 000 ₽)
                      </label>

                      <input
                        name="manual_chips"
                        type="number"
                        min="1"
                        step="1"
                      >

                      <div class="actions">
                        <button
                          type="submit"
                          name="decision"
                          value="approved"
                        >
                          Подтвердить
                        </button>

                        <button
                          type="submit"
                          class="secondary"
                          name="decision"
                          value="rejected"
                          formnovalidate
                        >
                          Отклонить
                        </button>
                      </div>
                    </form>
                  `
                  : ""
              }
            </div>
          `
        )
        .join("") || "Заявок нет";

    document.querySelectorAll(".decide").forEach((form) => {
      form.addEventListener("submit", async (event) => {
        event.preventDefault();

        const decision = event.submitter?.value;

        if (!["approved", "rejected"].includes(decision)) {
          msg("Не удалось определить действие");
          return;
        }

        const confirmation =
          decision === "approved"
            ? "Подтвердить пополнение и начислить фишки?"
            : "Отклонить заявку?";

        if (!confirm(confirmation)) {
          return;
        }

        const buttons = form.querySelectorAll("button");
        buttons.forEach((button) => {
          button.disabled = true;
        });

        try {
          const amountField = form.querySelector(
            'input[name="amount"]'
          );

          const manualChipsField = form.querySelector(
            'input[name="manual_chips"]'
          );

          await api("decide", {
            request_id: form.dataset.id,
            decision,
            amount: Number(amountField.value),
            manual_chips: Number(manualChipsField.value),
          });

          await load();
          msg(
            decision === "approved"
              ? "Заявка подтверждена, фишки начислены"
              : "Заявка отклонена"
          );
        } catch (error) {
          msg(error.message);

          buttons.forEach((button) => {
            button.disabled = false;
          });
        }
      });
    });

    // Участники
    $("#players").innerHTML =
      data.players
        .map(
          (player) => `
            <div class="item row">
              <span>ID ${esc(player.id)}</span>
              <b>${esc(player.chips)} фишек</b>
            </div>
          `
        )
        .join("") || "Участников нет";

    // История действий
    $("#audit").innerHTML =
      data.audit
        .map(
          (entry) => `
            <div class="item">
              ${esc(entry.created_at)}
              · ${esc(entry.action)}
              · ${esc(entry.subject)}
            </div>
          `
        )
        .join("") || "История пуста";

    msg("");
  } catch (error) {
    msg(error.message);
  }
}

// Вход администратора
$("#enter").addEventListener("click", () => {
  key = $("#key").value;
  $("#key").value = "";

  load();
});
