import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * Índice das fotos em um único JSON.
 *
 * Um casamento gera centenas de fotos, não milhões — um arquivo em disco dá
 * conta com folga e mantém o app sem banco de dados para instalar. Toda
 * gravação passa por uma fila (serializa concorrência) e é atômica
 * (arquivo temporário + rename), então uma queda no meio do envio nunca
 * deixa o índice pela metade.
 */
export class PhotoStore {
  #file;
  #photos = [];
  #queue = Promise.resolve();

  constructor(file) {
    this.#file = file;
  }

  async load() {
    try {
      const raw = await fs.readFile(this.#file, 'utf8');
      const parsed = JSON.parse(raw);
      this.#photos = Array.isArray(parsed?.photos) ? parsed.photos : [];
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      this.#photos = [];
      await this.#write();
    }
  }

  /** Enfileira uma mutação para que gravações concorrentes não se sobreponham. */
  #enqueue(mutate) {
    const result = this.#queue.then(async () => {
      const value = mutate();
      await this.#write();
      return value;
    });
    // A fila segue viva mesmo se esta mutação falhar.
    this.#queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  async #write() {
    const payload = JSON.stringify({ version: 1, photos: this.#photos }, null, 2);
    const tmp = path.join(path.dirname(this.#file), `.photos-${process.pid}.tmp`);
    await fs.writeFile(tmp, payload, 'utf8');
    await fs.rename(tmp, this.#file);
  }

  add(photo) {
    return this.#enqueue(() => {
      this.#photos.push(photo);
      return photo;
    });
  }

  update(id, patch) {
    return this.#enqueue(() => {
      const photo = this.#photos.find((item) => item.id === id);
      if (!photo) return null;
      Object.assign(photo, patch);
      return photo;
    });
  }

  remove(id) {
    return this.#enqueue(() => {
      const index = this.#photos.findIndex((item) => item.id === id);
      if (index === -1) return null;
      return this.#photos.splice(index, 1)[0];
    });
  }

  get(id) {
    return this.#photos.find((item) => item.id === id) ?? null;
  }

  /** Mais recentes primeiro — é como os noivos vão querer olhar. */
  list({ includeHidden = true } = {}) {
    return this.#photos
      .filter((photo) => includeHidden || !photo.hidden)
      .slice()
      .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
  }

  stats() {
    let hidden = 0;
    let bytes = 0;
    const guests = new Set();
    for (const photo of this.#photos) {
      if (photo.hidden) hidden += 1;
      bytes += photo.size ?? 0;
      if (photo.guestName) guests.add(photo.guestName.toLowerCase());
    }
    return { total: this.#photos.length, hidden, visible: this.#photos.length - hidden, bytes, guests: guests.size };
  }
}
