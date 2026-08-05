import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

// Ambiente isolado: nada aqui toca nas fotos reais do casamento.
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'casamento-test-'));
process.env.DATA_DIR = path.join(sandbox, 'data');
process.env.UPLOADS_DIR = path.join(sandbox, 'uploads');
process.env.ADMIN_PASSWORD = 'senha-de-teste';
process.env.SESSION_SECRET = 'segredo-de-teste';
process.env.COUPLE_NAMES = 'Ana & Bruno';
process.env.MAX_FILE_SIZE_MB = '1';
process.env.UPLOAD_RATE_LIMIT = '200';
process.env.LOGIN_RATE_LIMIT = '20';

const { createApp } = await import('../src/app.js');
const { config, ensureDirectories } = await import('../src/config.js');
const { PhotoStore } = await import('../src/store.js');

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==',
  'base64',
);

let server;
let base;
let cookie = '';

function url(pathname) {
  return new URL(pathname, base).toString();
}

function call(pathname, options = {}) {
  const headers = { Accept: 'application/json', ...(options.headers ?? {}) };
  if (cookie) headers.Cookie = cookie;
  if (options.json) {
    headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(options.json);
  }
  return fetch(url(pathname), { ...options, headers, redirect: 'manual' });
}

function sendPhoto({ bytes = PNG, name = 'foto.png', type = 'image/png', thumb, guestName, message } = {}) {
  const form = new FormData();
  form.append('photo', new Blob([bytes], { type }), name);
  if (thumb) form.append('thumb', new Blob([thumb], { type: 'image/jpeg' }), 'thumb.jpg');
  if (guestName !== undefined) form.append('guestName', guestName);
  if (message !== undefined) form.append('message', message);
  return call('/api/fotos', { method: 'POST', body: form });
}

async function login(password = 'senha-de-teste') {
  const response = await call('/api/admin/login', { method: 'POST', json: { password } });
  const header = response.headers.getSetCookie?.()[0] ?? response.headers.get('set-cookie');
  if (response.ok && header) cookie = header.split(';')[0];
  return response;
}

async function listPhotos() {
  const response = await call('/api/admin/photos');
  assert.equal(response.status, 200);
  return response.json();
}

before(async () => {
  ensureDirectories();
  const store = new PhotoStore(config.dataFile);
  await store.load();
  server = createApp(store).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  await login(); // a maioria das verificações lê o painel
});

after(() => {
  server?.close();
  fs.rmSync(sandbox, { recursive: true, force: true });
});

describe('página do convidado', () => {
  it('entrega a página com os dados do casal já embutidos', async () => {
    const response = await fetch(url('/'));
    const html = await response.text();

    assert.equal(response.status, 200);
    assert.match(html, /Ana &amp; Bruno|Ana & Bruno/);
    assert.match(html, /id="config"/);
    assert.match(response.headers.get('content-security-policy'), /script-src 'self'/);
  });

  it('serve CSS e JS sem exigir sessão', async () => {
    // O roteador do QR Code é montado em `/`; se o guard dele virar middleware
    // global, os arquivos estáticos passam a redirecionar para o login e a
    // página do convidado abre sem estilo e sem funcionar.
    const saved = cookie;
    cookie = '';

    for (const [asset, type] of [
      ['/css/style.css', /text\/css/],
      ['/css/guest.css', /text\/css/],
      ['/js/upload.js', /javascript/],
      ['/js/admin.js', /javascript/],
    ]) {
      const response = await fetch(url(asset), { redirect: 'manual' });
      assert.equal(response.status, 200, `${asset} deveria ser público`);
      assert.match(response.headers.get('content-type'), type, asset);
    }

    cookie = saved;
  });
});

describe('envio de fotos', () => {
  it('recusa requisição sem arquivo', async () => {
    const response = await call('/api/fotos', { method: 'POST', body: new FormData() });
    assert.equal(response.status, 400);
  });

  it('recusa arquivo que não é imagem, mesmo com extensão de foto', async () => {
    const response = await sendPhoto({
      bytes: Buffer.from('<script>alert(1)</script> nao sou uma imagem de verdade'),
      name: 'ataque.jpg',
      type: 'image/jpeg',
    });
    assert.equal(response.status, 415);
  });

  it('recusa arquivo acima do limite configurado', async () => {
    const grande = Buffer.concat([PNG, Buffer.alloc(1.4 * 1024 * 1024)]);
    const response = await sendPhoto({ bytes: grande });

    assert.equal(response.status, 413);
    assert.deepEqual(fs.readdirSync(config.tmpDir), [], 'o arquivo parcial não pode ficar no disco');
  });

  it('aceita uma foto e guarda nome e recado do convidado', async () => {
    const response = await sendPhoto({
      guestName: '  Tia Marlene  ',
      message: 'Que festa linda!',
    });
    assert.equal(response.status, 201);

    const { photos, stats } = await listPhotos();
    const photo = photos.find((item) => item.guestName === 'Tia Marlene');

    assert.ok(photo, 'a foto enviada deve aparecer no painel');
    assert.equal(photo.message, 'Que festa linda!');
    assert.equal(photo.hidden, false);
    assert.equal(photo.hasThumb, false);
    assert.ok(stats.total >= 1);
  });

  it('limpa caracteres de controle e corta textos muito longos', async () => {
    await sendPhoto({
      guestName: `Primo\n\tJoão${'!'.repeat(200)}`,
      message: 'x'.repeat(600),
    });

    const { photos } = await listPhotos();
    const photo = photos.find((item) => item.guestName.startsWith('Primo João'));

    assert.ok(photo);
    assert.ok(!photo.guestName.includes('\n'));
    assert.equal(photo.guestName.length, config.maxGuestNameLength);
    assert.equal(photo.message.length, config.maxMessageLength);
  });

  it('guarda a miniatura gerada pelo navegador', async () => {
    const response = await sendPhoto({ thumb: JPEG, guestName: 'Com miniatura' });
    assert.equal(response.status, 201);
    const { id } = await response.json();

    const { photos } = await listPhotos();
    assert.equal(photos.find((item) => item.id === id).hasThumb, true);

    const thumb = await call(`/api/admin/photos/${id}/miniatura`);
    assert.equal(thumb.status, 200);
    assert.equal(thumb.headers.get('content-type'), 'image/jpeg');
  });

  it('sem miniatura, o painel recebe a foto original', async () => {
    const { id } = await (await sendPhoto()).json();
    const thumb = await call(`/api/admin/photos/${id}/miniatura`);

    assert.equal(thumb.status, 200);
    assert.equal(thumb.headers.get('content-type'), 'image/png');
  });
});

describe('painel dos noivos', () => {
  it('bloqueia o painel e as fotos sem sessão', async () => {
    const saved = cookie;
    cookie = '';

    assert.equal((await call('/api/admin/photos')).status, 401);
    assert.equal((await call('/api/admin/download')).status, 401);
    assert.equal((await call('/qr')).status, 302);

    cookie = saved;
  });

  it('recusa a senha errada e aceita a correta', async () => {
    const saved = cookie;
    cookie = '';

    assert.equal((await login('chute')).status, 401);
    assert.equal(cookie, '', 'senha errada não pode abrir sessão');

    const ok = await login();
    assert.equal(ok.status, 200);
    assert.match(cookie, /^noivos_sessao=/);

    if (saved) cookie = saved;
  });

  it('serve o arquivo original com nome de download', async () => {
    const { photos } = await listPhotos();
    const response = await call(`/api/admin/photos/${photos[0].id}/arquivo?download=1`);

    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-disposition'), /attachment/);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  });

  it('responde 404 para id inexistente', async () => {
    assert.equal((await call('/api/admin/photos/nao-existe/arquivo')).status, 404);
    assert.equal((await call('/api/admin/photos/nao-existe', { method: 'DELETE' })).status, 404);
  });

  it('oculta e mostra uma foto de novo', async () => {
    const { photos } = await listPhotos();
    const target = photos[0];

    const hide = await call(`/api/admin/photos/${target.id}`, {
      method: 'PATCH',
      json: { hidden: true },
    });
    assert.equal(hide.status, 200);
    assert.equal((await hide.json()).hidden, true);

    const afterHide = await listPhotos();
    assert.equal(afterHide.photos.find((item) => item.id === target.id).hidden, true);
    assert.ok(afterHide.stats.hidden >= 1);

    await call(`/api/admin/photos/${target.id}`, { method: 'PATCH', json: { hidden: false } });
    const afterShow = await listPhotos();
    assert.equal(afterShow.photos.find((item) => item.id === target.id).hidden, false);
  });

  it('exige hidden booleano', async () => {
    const { photos } = await listPhotos();
    const response = await call(`/api/admin/photos/${photos[0].id}`, {
      method: 'PATCH',
      json: { hidden: 'sim' },
    });
    assert.equal(response.status, 400);
  });

  it('excluir remove o registro e o arquivo do disco', async () => {
    const { id } = await (await sendPhoto({ guestName: 'Para excluir' })).json();
    const before = fs.readdirSync(config.originalsDir).length;

    const response = await call(`/api/admin/photos/${id}`, { method: 'DELETE' });
    assert.equal(response.status, 200);

    const { photos } = await listPhotos();
    assert.equal(
      photos.some((item) => item.id === id),
      false,
    );
    assert.equal(fs.readdirSync(config.originalsDir).length, before - 1);
  });

  it('baixa todas as fotos em um .zip', async () => {
    const response = await call('/api/admin/download?includeHidden=1');
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'application/zip');

    const zip = Buffer.from(await response.arrayBuffer());
    assert.equal(zip.subarray(0, 2).toString(), 'PK', 'deve ser um zip válido');
    assert.match(zip.toString('latin1'), /recados\.txt/);
  });
});

describe('QR Code das mesas', () => {
  it('gera a folha de cartões para impressão', async () => {
    const response = await call('/qr?copias=3');
    const html = await response.text();

    assert.equal(response.status, 200);
    assert.equal((html.match(/<svg/g) ?? []).length, 3);
  });

  it('ignora URL fora de http/https', async () => {
    const html = await (await call('/qr?url=javascript:alert(1)')).text();
    assert.equal(html.includes('javascript:alert'), false);
  });

  it('entrega PNG e SVG para download', async () => {
    const png = await call('/qr.png');
    assert.equal(png.status, 200);
    assert.equal(png.headers.get('content-type'), 'image/png');

    const svg = await call('/qr.svg');
    assert.equal(svg.status, 200);
    assert.match(await svg.text(), /^<svg/);
  });
});

describe('proteções', () => {
  it('apaga o cookie no logout', async () => {
    const response = await call('/api/admin/logout', { method: 'POST' });

    assert.equal(response.status, 200);
    assert.match(response.headers.get('set-cookie'), /noivos_sessao=;/);
    assert.match(response.headers.get('set-cookie'), /Max-Age=0/);
  });

  it('barra tentativas de senha em massa', async () => {
    cookie = '';
    let blocked = false;

    for (let attempt = 0; attempt < 40 && !blocked; attempt += 1) {
      const response = await call('/api/admin/login', {
        method: 'POST',
        json: { password: `chute-${attempt}` },
      });
      blocked = response.status === 429;
    }

    assert.ok(blocked, 'o login precisa ser limitado por IP');
  });
});
