import { chipsFor, outcome } from './logic.js';

const enc = new TextEncoder();
const uid = () => crypto.randomUUID();

const secret = () => {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
};

const hash = async value =>
  Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(value))),
    b => b.toString(16).padStart(2, '0')
  ).join('');

const json = (value, status = 200, headers = {}) =>
  new Response(JSON.stringify(value), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...headers
    }
  });

const fail = (message, status = 400) => json({ error: message }, status);

const cookie = token =>
  `session=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=2592000`;

const parseCookie = value =>
  value?.match(/(?:^|;\s*)session=([^;]+)/)?.[1];

async function player(req, env) {
  const token = parseCookie(req.headers.get('cookie'));
  if (!token) return null;

  return env.DB.prepare(`
    SELECT p.*
    FROM sessions s
    JOIN players p ON p.id = s.player_id
    WHERE s.token_hash = ? AND s.expires_at > ?
  `).bind(await hash(token), Date.now()).first();
}

async function admin(req, env) {
  const password = req.headers.get('x-admin-key');

  if (
    !password ||
    !env.ADMIN_KEY ||
    password.length !== env.ADMIN_KEY.length
  ) return false;

  const a = enc.encode(password);
  const b = enc.encode(env.ADMIN_KEY);
  let difference = 0;

  for (let i = 0; i < a.length; i++) {
    difference |= a[i] ^ b[i];
  }

  return difference === 0;
}

async function settings(db) {
  const rows = await db.prepare('SELECT key, value FROM settings').all();
  return Object.fromEntries(rows.results.map(row => [row.key, row.value]));
}

async function body(req) {
  const value = await req.json();

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw Error('Неверные данные');
  }

  return value;
}

function checkOpen(s) {
  if (s.contest_open !== 'true') throw Error('Конкурс пока закрыт');

  const now = Date.now();

  if (s.start_at && now < Date.parse(s.start_at)) {
    throw Error('Конкурс ещё не начался');
  }

  if (s.end_at && now > Date.parse(s.end_at)) {
    throw Error('Конкурс завершён');
  }
}

async function audit(db, actor, action, subject, details = {}) {
  await db.prepare(`
    INSERT INTO audit(id, actor, action, subject, details)
    VALUES (?, ?, ?, ?, ?)
  `).bind(uid(), actor, action, subject, JSON.stringify(details)).run();
}

function makeCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = new Uint8Array(5);
  crypto.getRandomValues(bytes);

  return Array.from(bytes, byte => alphabet[byte % alphabet.length]).join('');
}

function calculateChips(amount) {
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw Error('Неверная сумма');
  }

  if (amount <= 10000) {
    const chips = chipsFor(amount);

    if (!Number.isSafeInteger(chips) || chips <= 0) {
      throw Error('Для этой суммы нет тарифа начисления');
    }

    return chips;
  }

  return Math.floor(amount / 100);
}

function winningResult(number, choice, color) {
  if (choice === 'even') return number !== 0 && number % 2 === 0;
  if (choice === 'odd') return number % 2 === 1;
  if (choice === 'zero') return number === 0;
  return choice === color;
}

function randomNumber() {
  const max = 0x100000000;
  const limit = Math.floor(max / 37) * 37;
  const bytes = new Uint32Array(1);

  do {
    crypto.getRandomValues(bytes);
  } while (bytes[0] >= limit);

  return bytes[0] % 37;
}

async function route(req, env) {
  const url = new URL(req.url);
  const path = url.pathname;
  const method = req.method;
  const db = env.DB;

  if (!db) return fail('База данных не подключена', 503);

  if (path === '/api/public' && method === 'GET') {
    const s = await settings(db);

    return json({
      contact: s.contact,
      cashiers: JSON.parse(s.cashiers),
      prizes: JSON.parse(s.prizes),
      start_at: s.start_at,
      end_at: s.end_at,
      contest_open: s.contest_open === 'true',
      final_open: s.final_open === 'true',
      over_10000: s.over_10000
    });
  }

  if (path === '/api/register' && method === 'POST') {
    const x = await body(req);
    const id = String(x.id || '').trim();

    if (!/^\d{5,20}$/.test(id)) {
      return fail('ID: от 5 до 20 цифр');
    }

    checkOpen(await settings(db));

    const existing = await db.prepare(
      'SELECT id FROM players WHERE id = ?'
    ).bind(id).first();

    if (existing) {
      return fail('Этот ID уже зарегистрирован. Войдите с ключом доступа.', 409);
    }

    const access = secret();
    const token = secret();

    await db.batch([
      db.prepare(
        'INSERT INTO players(id, access_hash) VALUES (?, ?)'
      ).bind(id, await hash(access)),

      db.prepare(`
        INSERT INTO sessions(token_hash, player_id, expires_at)
        VALUES (?, ?, ?)
      `).bind(await hash(token), id, Date.now() + 2592000000)
    ]);

    return json({
      id,
      access_key: access,
      message: 'Сохраните ключ доступа для входа с другого устройства.'
    }, 201, { 'set-cookie': cookie(token) });
  }

  if (path === '/api/login' && method === 'POST') {
    const x = await body(req);
    const id = String(x.id || '');
    const key = String(x.access_key || '');

    const p = await db.prepare(`
      SELECT id FROM players
      WHERE id = ? AND access_hash = ?
    `).bind(id, await hash(key)).first();

    if (!p) return fail('Неверный ID или ключ доступа', 401);

    const token = secret();

    await db.prepare(`
      INSERT INTO sessions(token_hash, player_id, expires_at)
      VALUES (?, ?, ?)
    `).bind(await hash(token), id, Date.now() + 2592000000).run();

    return json({ id }, 200, { 'set-cookie': cookie(token) });
  }

  if (path === '/api/logout' && method === 'POST') {
    const token = parseCookie(req.headers.get('cookie'));

    if (token) {
      await db.prepare(
        'DELETE FROM sessions WHERE token_hash = ?'
      ).bind(await hash(token)).run();
    }

    return json({ ok: true }, 200, {
      'set-cookie':
        'session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0'
    });
  }

  if (path === '/api/leaderboard' && method === 'GET') {
    const rows = await db.prepare(`
      SELECT id, chips
      FROM players
      ORDER BY chips DESC, created_at ASC, id ASC
      LIMIT 50
    `).all();

    return json({ leaders: rows.results });
  }

  if (path.startsWith('/api/admin/')) {
    if (!await admin(req, env)) return fail('Нет доступа', 401);

    if (path === '/api/admin/overview' && method === 'GET') {
      const [requests, players, history, s] = await Promise.all([
        db.prepare(`
          SELECT id, public_code AS code, player_id, status,
                 amount, chips_awarded, created_at
          FROM requests
          ORDER BY created_at DESC
          LIMIT 150
        `).all(),

        db.prepare(`
          SELECT id, chips FROM players
          ORDER BY chips DESC LIMIT 150
        `).all(),

        db.prepare(`
          SELECT * FROM audit
          ORDER BY created_at DESC LIMIT 100
        `).all(),

        settings(db)
      ]);

      return json({
        requests: requests.results,
        players: players.results,
        audit: history.results,
        settings: s
      });
    }

    if (path === '/api/admin/settings' && method === 'POST') {
      const x = await body(req);

      const allowed = [
        'contact', 'cashiers', 'prizes', 'start_at', 'end_at',
        'contest_open', 'final_open', 'over_10000'
      ];

      if (!allowed.includes(x.key)) {
        return fail('Неизвестная настройка');
      }

      let value = String(x.value ?? '');

      if (['cashiers', 'prizes'].includes(x.key)) {
        const parsed = JSON.parse(value);

        if (!Array.isArray(parsed)) {
          return fail('Ожидается JSON-массив');
        }

        value = JSON.stringify(parsed);
      }

      if (
        ['contest_open', 'final_open'].includes(x.key) &&
        !['true', 'false'].includes(value)
      ) {
        return fail('Допустимо true или false');
      }

      if (
        x.key === 'contact' &&
        !/^https:\/\/t\.me\/[a-zA-Z0-9_]{5,32}$/.test(value)
      ) {
        return fail('Укажите ссылку t.me');
      }

      await db.prepare(
        'UPDATE settings SET value = ? WHERE key = ?'
      ).bind(value, x.key).run();

      await audit(db, 'admin', 'setting', x.key, { value });

      return json({ ok: true });
    }

    if (path === '/api/admin/decide' && method === 'POST') {
      const x = await body(req);

      if (!['approved', 'rejected'].includes(x.decision)) {
        return fail('Неверное решение');
      }

      const request = await db.prepare(
        'SELECT * FROM requests WHERE id = ?'
      ).bind(String(x.request_id || '')).first();

      if (!request) return fail('Заявка не найдена', 404);

      if (request.status !== 'pending') {
        return fail('Заявка уже обработана', 409);
      }

      if (x.decision === 'rejected') {
        const updated = await db.prepare(`
          UPDATE requests
          SET status = 'rejected', decided_at = CURRENT_TIMESTAMP
          WHERE id = ? AND status = 'pending'
        `).bind(request.id).run();

        if (!updated.meta.changes) {
          return fail('Заявка уже обработана', 409);
        }

        await audit(db, 'admin', 'reject', request.id);
        return json({ ok: true });
      }

      const amount = Number(x.amount);
      const chips = calculateChips(amount);
      const seriesId = uid();

      const result = await db.batch([
        db.prepare(`
          UPDATE requests
          SET status = 'approved',
              amount = ?,
              chips_awarded = ?,
              decided_at = CURRENT_TIMESTAMP
          WHERE id = ? AND status = 'pending'
        `).bind(amount, chips, request.id),

        db.prepare(`
          UPDATE players
          SET chips = chips + ?, version = version + 1
          WHERE id = ?
        `).bind(chips, request.player_id),

        db.prepare(`
          INSERT INTO series(id, request_id, player_id, stake, current)
          VALUES (?, ?, ?, ?, ?)
        `).bind(seriesId, request.id, request.player_id, chips, chips),

        db.prepare(`
          INSERT INTO audit(id, actor, action, subject, details)
          VALUES (?, ?, ?, ?, ?)
        `).bind(
          uid(), 'admin', 'approve', request.id,
          JSON.stringify({ amount, chips })
        )
      ]);

      if (!result[0].meta.changes) {
        return fail('Заявка уже обработана', 409);
      }

      return json({ ok: true, chips });
    }

    return fail('Неизвестный адрес', 404);
  }

  const p = await player(req, env);
  if (!p) return fail('Войдите в аккаунт', 401);

  if (path === '/api/me' && method === 'GET') {
    const [requests, series] = await Promise.all([
      db.prepare(`
        SELECT id, public_code AS code, status, amount,
               chips_awarded, created_at
        FROM requests
        WHERE player_id = ?
        ORDER BY created_at DESC
        LIMIT 50
      `).bind(p.id).all(),

      db.prepare(`
        SELECT id, stake, current, spins, status
        FROM series
        WHERE player_id = ?
        ORDER BY created_at DESC
        LIMIT 50
      `).bind(p.id).all()
    ]);

    return json({
      id: p.id,
      chips: p.chips,
      requests: requests.results,
      series: series.results
    });
  }

  if (path === '/api/request' && method === 'POST') {
    checkOpen(await settings(db));

    for (let attempt = 0; attempt < 5; attempt++) {
      const code = makeCode();
      const id = uid();

      const existing = await db.prepare(
        'SELECT id FROM requests WHERE public_code = ?'
      ).bind(code).first();

      if (existing) continue;

      try {
        await db.prepare(`
          INSERT INTO requests(id, player_id, code_hash, public_code)
          VALUES (?, ?, ?, ?)
        `).bind(id, p.id, await hash(code), code).run();

        return json({
          request_id: id,
          code,
          message: 'Сохраните код и передайте его кассиру вместе с ID.'
        }, 201);
      } catch (error) {
        if (String(error.message).includes('UNIQUE')) continue;
        throw error;
      }
    }

    return fail('Не удалось создать код. Повторите попытку.', 503);
  }

  if (path === '/api/activate' && method === 'POST') {
    const x = await body(req);
    const code = String(x.code || '').trim().toUpperCase();

    const request = await db.prepare(`
      SELECT id, status
      FROM requests
      WHERE player_id = ? AND code_hash = ?
    `).bind(p.id, await hash(code)).first();

    if (!request) return fail('Код не найден', 404);

    if (request.status !== 'issued') {
      return fail('Этот код уже активирован или обработан', 409);
    }

    const updated = await db.prepare(`
      UPDATE requests
      SET status = 'pending', activated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status = 'issued'
    `).bind(request.id).run();

    if (!updated.meta.changes) {
      return fail('Код уже активирован', 409);
    }

    return json({
      ok: true,
      request_id: request.id,
      status: 'pending'
    });
  }

  if (path === '/api/spin' && method === 'POST') {
    const x = await body(req);
    const choice = String(x.choice || '');
    const seriesId = String(x.series_id || '');
    const stake = Number(x.stake);

    if (!['red', 'black', 'even', 'odd', 'zero'].includes(choice)) {
      return fail('Неверная ставка');
    }

    if (!Number.isSafeInteger(stake) || stake < 1) {
      return fail('Введите количество фишек для ставки');
    }

    checkOpen(await settings(db));

    const series = await db.prepare(`
      SELECT * FROM series
      WHERE id = ? AND player_id = ?
    `).bind(seriesId, p.id).first();

    if (
      !series ||
      series.status === 'closed' ||
      series.spins >= 2 ||
      (series.spins === 1 && series.status !== 'won')
    ) {
      return fail('Серия недоступна', 409);
    }

    const balance = await db.prepare(
      'SELECT chips FROM players WHERE id = ?'
    ).bind(p.id).first();

    if (!balance || stake > balance.chips) {
      return fail('Недостаточно фишек');
    }

    const number = randomNumber();
    const result = outcome(number);
    const win = winningResult(number, choice, result);
    const won = win ? stake * (choice === 'zero' ? 3 : 2) : 0;

    if (!Number.isSafeInteger(won)) {
      return fail('Слишком большая ставка');
    }

    const delta = won - stake;
    const nextSpins = series.spins + 1;
    const nextStatus = win && nextSpins < 2 ? 'won' : 'closed';

    /*
      Все изменения проходят в одной транзакции D1.
      Если состояние серии или баланс успели измениться,
      CHECK прерывает транзакцию без частичного списания.
    */
    const results = await db.batch([
      db.prepare(`
        UPDATE series
        SET spins = spins + 1,
            current = ?,
            status = ?
        WHERE id = ?
          AND player_id = ?
          AND spins = ?
          AND status = ?
          AND current = ?
      `).bind(
        won, nextStatus, seriesId, p.id,
        series.spins, series.status, series.current
      ),

      db.prepare(`
        SELECT CASE WHEN
          (SELECT changes()) = 1
          THEN 1
          ELSE json_extract('invalid', '$')
        END AS valid_series
      `),

      db.prepare(`
        UPDATE players
        SET chips = chips + ?,
            version = version + 1
        WHERE id = ? AND chips >= ?
      `).bind(delta, p.id, stake),

      db.prepare(`
        SELECT CASE WHEN
          (SELECT changes()) = 1
          THEN 1
          ELSE json_extract('invalid', '$')
        END AS valid_balance
      `),

      db.prepare(`
        INSERT INTO spins(
          id, series_id, player_id, choice,
          outcome, payout, stake, number
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        uid(), seriesId, p.id, choice,
        String(number), won, stake, number
      )
    ]);

    if (!results[0].meta.changes || !results[2].meta.changes) {
      return fail('Ставка не прошла. Обновите страницу.', 409);
    }

    const updatedBalance = await db.prepare(
      'SELECT chips FROM players WHERE id = ?'
    ).bind(p.id).first();

    return json({
      number,
      result,
      stake,
      choice,
      won,
      delta,
      chips: updatedBalance.chips,
      spins: nextSpins,
      status: nextStatus
    });
  }

  if (path === '/api/collect' && method === 'POST') {
    const x = await body(req);

    const updated = await db.prepare(`
      UPDATE series
      SET status = 'closed'
      WHERE id = ?
        AND player_id = ?
        AND status = 'won'
        AND spins = 1
    `).bind(String(x.series_id || ''), p.id).run();

    if (!updated.meta.changes) {
      return fail('Нечего забирать', 409);
    }

    return json({ ok: true });
  }

  return fail('Неизвестный адрес', 404);
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);

    if (!url.pathname.startsWith('/api/')) {
      return env.ASSETS.fetch(req);
    }

    try {
      return await route(req, env);
    } catch (error) {
      console.error(error);
      return fail(error.message || 'Внутренняя ошибка сервера', 500);
    }
  }
};
